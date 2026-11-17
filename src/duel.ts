import { card, NPC_DECK, ROLES, RULES, validDeck, type Role } from './cards.ts'
import { chooseStrongNpc, type NpcDifficulty, type StrongNpcView } from './strongNpc.ts'
export type Side = 0 | 1
const sides = [0, 1] as const
const other = (side: Side): Side => side === 0 ? 1 : 0
const who = ['プレイヤー', 'NPC']
export type Instance = { id: number; role: Role }
export type Play = { id: number; guess?: Role }
type Revealed = Instance & Play & { disabled: boolean; recoveryBlocked?: true }
type Status = { noHeal: boolean; limited: boolean }
const fresh = (): Status => ({ noHeal:false, limited:false })
type Player = { hp:number; hand:Instance[]; deck:Instance[]; discard:Instance[]; status:Status; next:Status }
export type Prompt = { side:Side; title:string; options:Instance[] }
type Log = { night:number; text:string; privateTo?:Side }
export type Investigation = {
  sourceId: number
  night: number
  kind: 'seer' | 'prophet'
  cards: { role: Role; status: 'observed' | 'old' | 'used' | 'drawn' | 'unknown'; position?: number }[]
}
type InvestigatedCard = Instance & { position?: number; drawn?: boolean }
type InvestigationSnapshot = Omit<Investigation, 'cards'> & { cards: InvestigatedCard[]; revision: number }
type HpChange = { lost: number; gained: number }
type Phase = 'select' | 'reveal' | 'resolve' | 'choice' | 'end' | 'finished'
export type DeckEntry = Readonly<{ role: Role; count: number }>
function composition(roles: readonly Role[]): readonly DeckEntry[] {
  const counts = new Map<Role, number>()
  for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1)
  // The role catalog determines display order independently of the actual draw order.
  return Object.freeze(ROLES.flatMap(role => {
    const count = counts.get(role)
    return count === undefined ? [] : [Object.freeze({ role, count })]
  }))
}
export type NpcView = { hand: readonly Instance[]; hp:number; enemyHp:number; max:number; noHeal:boolean; discard:readonly Instance[]; enemyDiscard:readonly Instance[]; enemyDeck:readonly DeckEntry[]; enemyRemaining:readonly DeckEntry[] }
type Config = { hp:number; deckSize:number; opening:number; nightlyDraw:number; handRefill:number; handLimit:number; maxPlays:number; finalNight:number; finalTieBreak:'hp'|'draw' }
type IntelDraw = Readonly<Partial<Record<'seer' | 'prophet', number>>>
type Options = { rng?:()=>number; rules?:Partial<Config>; npc?: (view:NpcView)=>Play[]; intelDraw?: IntelDraw; npcDifficulty?: NpcDifficulty; twoHumans?: boolean; legacyCurse?: boolean }
export function shuffle<T>(input:readonly T[], rng:()=>number): T[] {
  const a = [...input]
  for(let i=a.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]] }
  return a
}
function value(role:Role, hp:number, noHeal=false, discardCount=1) {
  switch(role) {
    case 'dire': return hp<=4 ? -5 : 6
    case 'wolf': return 5
    case 'fox': return hp<=10 ? 6 : 4
    case 'witch': return noHeal ? -4 : hp<=16 ? 8 : hp<=18 ? 4 : 0
    case 'merchant': return hp<=2 ? -20 : 2
    case 'hunter': case 'trap': return 5
    case 'medium': case 'keeper': return discardCount ? 3 : -2
    default: return 3
  }
}
export function chooseNpc(view:NpcView, rng:()=>number): Play[] {
  const ranked = view.hand.map(c => ({c, score:value(c.role,view.hp,view.noHeal,view.discard.length)+rng()*3}))
    .sort((a,b)=>b.score-a.score)
  const amount = Math.min(view.max, ranked.length, ranked[1]?.score >= 3 && rng() < .74 ? 2 : 1)
  const guesses = view.enemyRemaining.flatMap(({ role, count }) => Array<Role>(count).fill(role))
  return ranked.slice(0,amount).map(({c})=>c.role==='assassin' && guesses.length
    ? {id:c.id,guess:guesses[Math.floor(rng()*guesses.length)]} : {id:c.id})
}

export class Duel {
  readonly rules: Config
  readonly npcDifficulty: NpcDifficulty
  private readonly twoHumans: boolean
  private readonly legacyCurse: boolean
  private readonly investigations: [InvestigationSnapshot[], InvestigationSnapshot[]] = [[], []]
  private readonly revisions = [0, 0]
  private hpChanges: [HpChange, HpChange] = [{ lost: 0, gained: 0 }, { lost: 0, gained: 0 }]
  private readonly lastPlayed = [new Map<number, number>(), new Map<number, number>()]
  private readonly initialDecks: readonly [readonly DeckEntry[], readonly DeckEntry[]]
  readonly players: [Player,Player]
  readonly log: Log[] = []
  revealed: [Revealed[],Revealed[]] = [[],[]]
  night=1
  phase:Phase='resolve'
  winner:Side|'draw'|null=null
  reason=''
  prompt:Prompt|null=null
  private readonly intelDraw: IntelDraw
  private rng:()=>number
  private npc:(view:NpcView)=>Play[]
  private npcPlays:Play[]=[]
  private readonly publicPlays: [Role[][], Role[][]] = [[], []]
  private cardsInPlay = false
  private work:Generator<Prompt,void,number>|null=null
  constructor(deck:Role[], enemy:Role[]=NPC_DECK, options:Options={}) {
    this.rules={...RULES,...options.rules}
    if(!validDeck(deck,this.rules.deckSize)||!validDeck(enemy,this.rules.deckSize)) throw new Error('デッキの枚数または投入上限が正しくありません。')
    this.initialDecks = [composition(deck), composition(enemy)]
    this.rng=options.rng??Math.random
    this.intelDraw = { ...options.intelDraw }
    this.npcDifficulty = options.npcDifficulty ?? 'standard'
    this.twoHumans = options.twoHumans ?? false
    this.legacyCurse = options.legacyCurse ?? false
    this.npc = options.npc ?? (this.npcDifficulty === 'strong'
      ? view => chooseStrongNpc(this.withPublicContext(1, view), this.rng)
      : view => chooseNpc(view, this.rng))
    let id=0
    const prepare=(roles:Role[]):Player=>({
      hp:this.rules.hp, hand:[], deck:shuffle(roles.map(role=>({id:++id,role})),this.rng),
      discard:[],status:fresh(),next:fresh()
    })
    this.players=[prepare(deck),prepare(enemy)]
    for(const i of sides) this.draw(i,this.rules.opening,'silent')
    this.run(this.startNight())
  }
  deckComposition(side: Side): readonly DeckEntry[] {
    return this.initialDecks[side]
  }
  remainingComposition(side: Side): readonly DeckEntry[] {
    const { deck, hand } = this.players[side]
    const unique = new Map<number, Role>()
    for (const { id, role } of [...deck, ...hand]) unique.set(id, role)
    // Revealed cards stay visible after cleanup, but only count while still in play.
    if (this.cardsInPlay) {
      for (const { id, role } of this.revealed[side]) unique.set(id, role)
    }
    return composition([...unique.values()])
  }
  private npcView(side: Side): NpcView {
    const player = this.players[side], opponent = this.players[other(side)]
    return { hand: player.hand.map(card => ({ ...card })), hp: player.hp, enemyHp: opponent.hp,
      max: this.max(side), noHeal: player.status.noHeal, discard: player.discard.map(card => ({ ...card })),
      enemyDiscard: opponent.discard.map(card => ({ ...card })), enemyDeck: this.deckComposition(other(side)),
      enemyRemaining: this.remainingComposition(other(side)) }
  }
  strongNpcView(side: Side): StrongNpcView {
    return this.withPublicContext(side, this.npcView(side))
  }
  private withPublicContext(side: Side, view: NpcView): StrongNpcView {
    const opponent = other(side)
    return { ...view, night: this.night, finalNight: this.rules.finalNight,
      maxHp: this.rules.hp, handRefill: this.rules.handRefill, deckCount: this.players[side].deck.length,
      ownRemaining: this.remainingComposition(side), enemyHandCount: this.players[opponent].hand.length,
      enemyMax: this.max(opponent), enemyNoHeal: this.players[opponent].status.noHeal,
      enemyHistory: this.publicPlays[opponent].map(turn => [...turn]) }
  }
  investigationsFor(side: Side): Investigation[] {
    const opponent = other(side)
    return this.investigations[side].map(({ sourceId, night, kind, cards, revision }) => ({
      sourceId,
      night,
      kind,
      cards: cards.map(({ id, role, position, drawn }) => {
        if ((this.lastPlayed[opponent].get(id) ?? 0) > night) return { role, status: 'used' }
        if (kind === 'seer') return { role, status: this.revisions[opponent] === revision ? 'observed' : 'old' }
        if (drawn) return { role, status: 'drawn' }
        return position === undefined ? { role, status: 'unknown' } : { role, status: 'observed', position }
      }),
    }))
  }
  nightHpChange(side: Side): Readonly<HpChange> {
    return { ...this.hpChanges[side] }
  }
  private changeHp(side: Side, amount: number): number {
    const player = this.players[side]
    const before = player.hp
    player.hp = Math.max(0, Math.min(this.rules.hp, before + amount))
    const actual = player.hp - before
    if (actual < 0) this.hpChanges[side].lost -= actual
    else this.hpChanges[side].gained += actual
    return actual
  }
  private updateProphet(side: Side, event: 'draw' | 'insert' | 'shuffle') {
    // Advance from public operations without consulting the identity of a newly drawn card.
    for (const record of this.investigations[other(side)]) {
      if (record.kind !== 'prophet') continue
      for (const entry of record.cards) {
        if (event === 'shuffle') entry.drawn = false
        if (entry.position === undefined) continue
        if (event !== 'draw' || entry.position === 1) {
          entry.position = undefined
          if (event === 'draw') entry.drawn = true
        } else {
          entry.position--
        }
      }
    }
  }
  private write(text:string, privateTo?:Side) { this.log.push({night:this.night,text,privateTo}) }
  max(side:Side) { return this.players[side].status.limited ? 1 : this.rules.maxPlays }
  private draw(side:Side,count:number,kind:'draw'|'refill'|'silent'='draw') {
    const p=this.players[side]
    let drawn=0
    for(let i=0;i<count;i++) {
      if(!p.deck.length && p.discard.length) {
        p.deck=shuffle(p.discard,this.rng); p.discard=[]
        this.updateProphet(side, 'shuffle')
        this.write(who[side]+'は捨て札をシャッフルして山札に戻した。')
      }
      const c=p.deck.shift()
      if (c) {
        p.hand.push(c)
        this.updateProphet(side, 'draw')
        drawn++
      }
    }
    if (drawn) this.revisions[side]++
    if(kind==='draw') this.write(who[side]+'は'+drawn+'枚引いた。')
    if(kind==='refill') this.write(who[side]+'は夜終了時に手札を'+drawn+'枚補充した。')
  }
  private *choose(side:Side,title:string,options:Instance[],recover=false):Generator<Prompt,number,number> {
    if(side===0 || this.twoHumans) return yield {side,title,options:[...options]}
    const p=this.players[side]
    const rank=(c:Instance)=>value(c.role,p.hp,p.status.noHeal,p.discard.length)
    return [...options].sort((a,b)=>(rank(b)-rank(a))*(recover?1:-1))[0].id
  }
  private *discardOne(side:Side,title:string):Generator<Prompt,void,number> {
    const p=this.players[side]
    if(!p.hand.length) return
    const id=yield* this.choose(side,title,p.hand)
    const c=p.hand.splice(p.hand.findIndex(x=>x.id===id),1)[0]
    p.discard.push(c)
    this.revisions[side]++
    this.write(who[side]+'は'+card(c.role).name+'を捨てた。')
  }
  private *trim(side:Side):Generator<Prompt,void,number> {
    while(this.players[side].hand.length>this.rules.handLimit)
      yield* this.discardOne(side,'手札上限：捨てるカードを選択')
  }
  private run(work:Generator<Prompt,void,number>) { this.work=work; this.step() }
  private step(id=0) {
    this.phase='resolve'
    const result=this.work!.next(id)
    this.prompt=result.done ? null : result.value
    if(!result.done) this.phase='choice'
    else this.work=null
  }
  answer(id:number) {
    if(!this.prompt?.options.some(c=>c.id===id)) return false
    this.step(id); return true
  }
  private *startNight():Generator<Prompt,void,number> {
    this.revealed=[[],[]]
    this.hpChanges = [{ lost: 0, gained: 0 }, { lost: 0, gained: 0 }]
    this.write('第'+this.night+'夜が始まった。')
    for(const i of sides) this.draw(i,this.rules.nightlyDraw)
    for(const i of sides) yield* this.trim(i)
    if (!this.twoHumans) {
      this.npcPlays=this.npc(this.npcView(1))
      if(!this.canLock(1,this.npcPlays)) throw new Error('NPCが無効なカードを選択しました。')
    }
    this.phase='select'
  }
  canLock(side:Side, plays:Play[]) {
    const hand=this.players[side].hand
    const candidates = this.remainingComposition(other(side))
    return plays.length>=Number(hand.length>0) && plays.length<=this.max(side) &&
      new Set(plays.map(p=>p.id)).size===plays.length &&
      plays.every(p=>hand.some(c=>c.id===p.id && (c.role!=='assassin' ||
        (candidates.length === 0 ? p.guess === undefined : candidates.some(entry => entry.role === p.guess)))))
  }
  lock(plays:Play[]) {
    return !this.twoHumans && this.revealPlays([plays, this.npcPlays])
  }
  lockBoth(plays: [Play[], Play[]]) {
    return this.twoHumans && this.revealPlays(plays)
  }
  private revealPlays(all: [Play[], Play[]]) {
    if(this.phase!=='select'||!sides.every(side => this.canLock(side, all[side]))) return false
    for(const i of sides) {
      const p=this.players[i]
      if (all[i].length) this.revisions[i]++
      this.revealed[i]=all[i].map(play=>{
        const c=p.hand.splice(p.hand.findIndex(x=>x.id===play.id),1)[0]
        this.lastPlayed[i].set(c.id, this.night)
        this.write(who[i]+'は'+card(c.role).name+'を使用した。')
        return {...c,guess:c.role==='assassin'?play.guess:undefined,disabled:false}
      })
      if(!all[i].length) this.write(who[i]+'は手札がないためパスした。')
      this.publicPlays[i].push(this.revealed[i].map(card => card.role))
      if (this.publicPlays[i].length > 6) this.publicPlays[i].shift()
    }
    this.cardsInPlay = true
    this.phase='reveal'; return true
  }
  resolve() { if(this.phase==='reveal') this.run(this.effects()) }
  nextNight() {
    if(this.phase!=='end')return false
    this.night++
    for(const p of this.players) { p.status=p.next; p.next=fresh() }
    this.run(this.startNight()); return true
  }
  private finish(winner:Side|'draw',reason:string) {
    this.winner=winner; this.reason=reason; this.phase='finished'
    this.write(reason+'：'+(winner==='draw'?'引き分け':who[winner]+'の勝利'))
  }
  private ko() {
    const [a,b]=this.players.map(p=>p.hp)
    if(a>0&&b>0)return false
    this.finish(a===b?'draw':a>0?0:1,'HPが0になった'); return true
  }
  private clean() {
    for (const side of sides) {
      this.players[side].discard.push(...this.revealed[side].map(({ id, role }) => ({ id, role })))
    }
    this.cardsInPlay = false
  }
  private *effects():Generator<Prompt,void,number> {
    // Choose all disruption targets together.
    const targets=[new Set<number>(),new Set<number>()]
    for(const i of sides) if(this.revealed[other(i)].length===2)
      for(const c of this.revealed[i]) if(c.role==='mad')
        targets[other(i)].add(this.revealed[other(i)][Math.floor(this.rng()*2)].id)
    // Mutual disruption is simultaneous: committed attempts still land.
    for(const i of sides) for(const c of this.revealed[i]) if(targets[i].has(c.id)) {
      c.disabled=true; this.write('狂人が'+who[i]+'の'+card(c.role).name+'を無効化した。')
    }
    const active=this.revealed.map(cs=>cs.filter(c=>!c.disabled))
    const count=(i:Side,r:Role)=>active[i].filter(c=>c.role===r).length
    for(const i of sides) {
      const p=this.players[other(i)]
      if(this.legacyCurse && count(i,'curse')) { p.next.noHeal=true; this.write(who[other(i)]+'は次の夜に回復できない。') }
      if(count(i,'tyrant')) { p.next.limited=true; this.write(who[other(i)]+'は次の夜に1枚までしか出せない。') }
    }
    const shield=sides.map(i=>count(i,'knight')*card('knight').power!)
    const dmg=[0,0], recoil=[0,0], returns=[0,0]
    const hit=(target:Side,amount:number)=>{
      const reduction=Math.min(amount,shield[target])
      shield[target]-=reduction
      if(reduction) this.write(who[target]+'の騎士が'+reduction+'ダメージ軽減した。')
      return amount-reduction
    }
    for(const i of sides) {
      const target=other(i)
      let raid=0, special=0
      for(const c of active[i]) {
        const spec=card(c.role)
        if(c.role==='wolf'||c.role==='dire') { raid+=spec.power!; recoil[i]+=spec.recoil??0 }
        if(c.role==='fox') raid+=this.players[i].hp<=spec.lowHp! ? spec.boosted! : spec.power!
        if(c.role==='assassin' && c.guess !== undefined) {
          const success=this.revealed[target].some(x=>x.role===c.guess)
          this.write(who[i]+'の暗殺者の予想「'+card(c.guess).name+'」は'+(success?'的中':'外れ')+'。')
          if(success) special+=spec.power!
        }
      }
      if(raid && count(target,'trap')) {
        returns[i]+=count(target,'trap')*card('trap').power!
        this.write(who[target]+'の罠師が襲撃を防ぎ、反撃した。'); raid=0
      } else if(raid && count(target,'hunter')) {
        this.write(who[target]+'の狩人が襲撃を防いだ。'); raid=0
      }
      dmg[target]=hit(target,raid+special)
    }
    for(const i of sides) dmg[i]+=hit(i,returns[i])
    const catReturns=sides.map(i=>dmg[i]>0 ? count(i,'cat')*card('cat').power! : 0)
    for(const i of sides) if(catReturns[i]) {
      this.write(who[i]+'の猫又が反撃した。'); returns[other(i)]=hit(other(i),catReturns[i])
    } else returns[other(i)]=0
    for(const i of sides) {
      const lost = -this.changeHp(i, -(dmg[i] + returns[i] + recoil[i]))
      if (lost) this.write(who[i]+'は'+lost+'ダメージ（HP '+this.players[i].hp+'）。')
    }
    if(this.ko()) {this.clean();return}

    for(const i of sides) if(count(i,'witch')) {
      const p=this.players[i]
      if(p.status.noHeal || (!this.legacyCurse && count(other(i),'curse'))) {
        if(p.hp < this.rules.hp) {
          for(const c of active[i]) if(c.role==='witch') c.recoveryBlocked=true
          this.write(who[i]+'の回復は呪術師に無効化された。')
        }
      }
      else {
        const gained = this.changeHp(i, count(i, 'witch') * card('witch').power!)
        this.write(who[i]+'はHPを'+gained+'回復した。')
      }
    }
    // Merchant HP loss is paid simultaneously in this phase, before its draw.
    for(const i of sides) if(count(i,'merchant')) {
      const lost = -this.changeHp(i, -(count(i, 'merchant') * card('merchant').recoil!))
      this.write(who[i]+'は商人でHPを'+lost+'失った（HP '+this.players[i].hp+'）。')
    }
    if(this.ko()) {this.clean();return}
    // Resolve information before either side changes its hand or deck in this phase.
    for(const i of sides) for(const c of active[i]) {
      const enemy=this.players[other(i)], spec=card(c.role)
      if(c.role==='seer'||c.role==='prophet') {
        const options=c.role==='seer'?shuffle(enemy.hand,this.rng):enemy.deck
        const cards = options.slice(0, spec.power).map(({ id, role }, index) => ({
          id, role, position: c.role === 'prophet' ? index + 1 : undefined,
        }))
        this.investigations[i].push({
          sourceId: c.id, night: this.night, kind: c.role, cards, revision: this.revisions[other(i)],
        })
        const names = cards.map(item => card(item.role).name)
        this.write(who[i]+'の'+spec.name+'が確認：'+(names.join(' → ')||'対象なし'),i)
      }
    }
    for(const i of sides) for(const c of active[i]) {
      const p=this.players[i], spec=card(c.role)
      const attacks=this.revealed[other(i)].some(x=>card(x.role).category==='attack')
      switch(c.role) {
        case 'seer': case 'prophet': {
          const bonus = this.intelDraw[c.role] ?? 0
          if (bonus > 0) this.draw(i, bonus)
          break
        }
        case 'spy': case 'jester':
          if(attacks===(c.role==='spy')) this.draw(i,spec.power!)
          else this.write(who[i]+'の'+spec.name+'は条件を満たさなかった。')
          break
        case 'merchant': this.draw(i,spec.power!); break
        case 'mason': this.draw(i,spec.power!); yield* this.discardOne(i,'共有者：捨てるカードを選択'); break
        case 'medium': case 'keeper': {
          if(!p.discard.length) {this.write(who[i]+'の'+spec.name+'には回収対象がなかった。');break}
          const id=yield* this.choose(i,spec.name+'：回収するカードを選択',p.discard,true)
          const recovered=p.discard.splice(p.discard.findIndex(x=>x.id===id),1)[0]
          if (c.role === 'medium') {
            p.hand.push(recovered)
          } else {
            p.deck.unshift(recovered)
            this.updateProphet(i, 'insert')
          }
          this.revisions[i]++
          this.write(who[i]+'は'+card(recovered.role).name+'を'+(c.role==='medium'?'手札':'山札の一番上')+'に戻した。')
          break
        }
      }
    }
    this.clean()
    const refillTarget = Math.min(this.rules.handRefill, this.rules.handLimit)
    for (const i of sides) {
      const shortage = refillTarget - this.players[i].hand.length
      if (shortage > 0) this.draw(i, shortage, 'refill')
    }
    for(const i of sides) yield* this.trim(i)
    if(this.night>=this.rules.finalNight) {
      const [a,b]=this.players.map(p=>p.hp)
      this.finish(this.rules.finalTieBreak==='draw'||a===b?'draw':a>b?0:1,'第'+this.night+'夜終了')
    } else {this.phase='end'}
  }
}
