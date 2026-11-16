import { card, NPC_DECK, ROLES, RULES, validDeck, type Role } from './cards.ts'
export type Side = 0 | 1
const sides = [0, 1] as const
const other = (side: Side): Side => side === 0 ? 1 : 0
const who = ['プレイヤー', 'NPC']
export type Instance = { id: number; role: Role }
export type Play = { id: number; guess?: Role }
type Revealed = Instance & Play & { disabled: boolean }
type Status = { noHeal: boolean; limited: boolean }
const fresh = (): Status => ({ noHeal:false, limited:false })
type Player = { hp:number; hand:Instance[]; deck:Instance[]; discard:Instance[]; status:Status; next:Status }
export type Prompt = { side:Side; title:string; options:Instance[] }
type Log = { night:number; text:string; privateTo?:Side }
type Phase = 'select' | 'reveal' | 'resolve' | 'choice' | 'end' | 'finished'
export type DeckEntry = Readonly<{ role: Role; count: number }>
export type NpcView = { hand: readonly Instance[]; hp:number; enemyHp:number; max:number; noHeal:boolean; discard:readonly Instance[]; enemyDiscard:readonly Instance[]; enemyDeck:readonly DeckEntry[] }
type Config = { hp:number; deckSize:number; opening:number; nightlyDraw:number; handRefill:number; handLimit:number; maxPlays:number; finalNight:number; finalTieBreak:'hp'|'draw' }
type Options = { rng?:()=>number; rules?:Partial<Config>; npc?: (view:NpcView)=>Play[] }
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
  const guesses = view.enemyDeck.flatMap(({role,count}) => Array<Role>(count).fill(role))
  return ranked.slice(0,amount).map(({c})=>c.role==='assassin'
    ? {id:c.id,guess:guesses[Math.floor(rng()*guesses.length)]} : {id:c.id})
}

export class Duel {
  readonly rules: Config
  private readonly initialDecks: readonly [readonly DeckEntry[], readonly DeckEntry[]]
  readonly players: [Player,Player]
  readonly log: Log[] = []
  revealed: [Revealed[],Revealed[]] = [[],[]]
  night=1
  phase:Phase='resolve'
  winner:Side|'draw'|null=null
  reason=''
  prompt:Prompt|null=null
  private rng:()=>number
  private npc:(view:NpcView)=>Play[]
  private npcPlays:Play[]=[]
  private work:Generator<Prompt,void,number>|null=null
  constructor(deck:Role[], enemy:Role[]=NPC_DECK, options:Options={}) {
    this.rules={...RULES,...options.rules}
    if(!validDeck(deck,this.rules.deckSize)||!validDeck(enemy,this.rules.deckSize)) throw new Error('デッキの枚数または投入上限が正しくありません。')
    const composition = (roles: Role[]) => Object.freeze(ROLES.flatMap(role => {
      const count = roles.filter(entry => entry === role).length
      return count ? [Object.freeze({ role, count })] : []
    }))
    this.initialDecks = [composition(deck), composition(enemy)]
    this.rng=options.rng??Math.random
    this.npc=options.npc??(view=>chooseNpc(view,this.rng))
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
  private write(text:string, privateTo?:Side) { this.log.push({night:this.night,text,privateTo}) }
  max(side:Side) { return this.players[side].status.limited ? 1 : this.rules.maxPlays }
  private draw(side:Side,count:number,kind:'draw'|'refill'|'silent'='draw') {
    const p=this.players[side]
    let drawn=0
    for(let i=0;i<count;i++) {
      if(!p.deck.length && p.discard.length) {
        p.deck=shuffle(p.discard,this.rng); p.discard=[]
        this.write(who[side]+'は捨て札をシャッフルして山札に戻した。')
      }
      const c=p.deck.shift()
      if(c) { p.hand.push(c); drawn++ }
    }
    if(kind==='draw') this.write(who[side]+'は'+drawn+'枚引いた。')
    if(kind==='refill') this.write(who[side]+'は夜終了時に手札を'+drawn+'枚補充した。')
  }
  private *choose(side:Side,title:string,options:Instance[],recover=false):Generator<Prompt,number,number> {
    if(side===0) return yield {side,title,options:[...options]}
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
    this.write('第'+this.night+'夜が始まった。')
    for(const i of sides) this.draw(i,this.rules.nightlyDraw)
    for(const i of sides) yield* this.trim(i)
    const p=this.players[1], enemy=this.players[0]
    this.npcPlays=this.npc({hand:p.hand.map(c=>({...c})), hp:p.hp, enemyHp:enemy.hp, max:this.max(1),
      noHeal:p.status.noHeal,discard:p.discard.map(c=>({...c})),enemyDiscard:enemy.discard.map(c=>({...c})),enemyDeck:this.deckComposition(0)})
    if(!this.accepts(1,this.npcPlays)) throw new Error('NPCが無効なカードを選択しました。')
    this.phase='select'
  }
  private accepts(side:Side, plays:Play[]) {
    const hand=this.players[side].hand
    return plays.length>=Number(hand.length>0) && plays.length<=this.max(side) &&
      new Set(plays.map(p=>p.id)).size===plays.length &&
      plays.every(p=>hand.some(c=>c.id===p.id && (c.role!=='assassin' ||
        (p.guess!==undefined && this.deckComposition(other(side)).some(entry=>entry.role===p.guess)))))
  }
  lock(plays:Play[]) {
    if(this.phase!=='select'||!this.accepts(0,plays)) return false
    const all=[plays,this.npcPlays]
    for(const i of sides) {
      const p=this.players[i]
      this.revealed[i]=all[i].map(play=>{
        const c=p.hand.splice(p.hand.findIndex(x=>x.id===play.id),1)[0]
        this.write(who[i]+'は'+card(c.role).name+'を使用した。')
        return {...c,guess:c.role==='assassin'?play.guess:undefined,disabled:false}
      })
      if(!all[i].length) this.write(who[i]+'は手札がないためパスした。')
    }
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
  private clean() { for(const i of sides) this.players[i].discard.push(...this.revealed[i].map(({id,role})=>({id,role}))) }
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
      if(count(i,'curse')) { p.next.noHeal=true; this.write(who[other(i)]+'は次の夜に回復できない。') }
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
        if(c.role==='assassin') {
          const success=this.revealed[target].some(x=>x.role===c.guess)
          this.write(who[i]+'の暗殺者の予想「'+card(c.guess!).name+'」は'+(success?'的中':'外れ')+'。')
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
      const p=this.players[i], total=dmg[i]+returns[i]+recoil[i]
      p.hp=Math.max(0,p.hp-total)
      if(total) this.write(who[i]+'は'+total+'ダメージ（HP '+p.hp+'）。')
    }
    if(this.ko()) {this.clean();return}

    for(const i of sides) if(count(i,'witch')) {
      const p=this.players[i]
      if(p.status.noHeal) this.write(who[i]+'の回復は呪術師に無効化された。')
      else {
        const before=p.hp
        p.hp=Math.min(this.rules.hp,p.hp+count(i,'witch')*card('witch').power!)
        this.write(who[i]+'はHPを'+(p.hp-before)+'回復した。')
      }
    }
    // Merchant HP loss is paid simultaneously in this phase, before its draw.
    for(const i of sides) if(count(i,'merchant')) {
      const p=this.players[i], loss=count(i,'merchant')*card('merchant').recoil!
      p.hp=Math.max(0,p.hp-loss)
      this.write(who[i]+'は商人でHPを'+loss+'失った（HP '+p.hp+'）。')
    }
    if(this.ko()) {this.clean();return}
    // Resolve information before either side changes its hand or deck in this phase.
    for(const i of sides) for(const c of active[i]) {
      const enemy=this.players[other(i)], spec=card(c.role)
      if(c.role==='seer'||c.role==='prophet') {
        const options=c.role==='seer'?shuffle(enemy.hand,this.rng):enemy.deck
        const names=options.slice(0,spec.power).map(item=>card(item.role).name)
        this.write(who[i]+'の'+spec.name+'が確認：'+(names.join(' → ')||'対象なし'),i)
      }
    }
    for(const i of sides) for(const c of active[i]) {
      const p=this.players[i], spec=card(c.role)
      const attacks=this.revealed[other(i)].some(x=>card(x.role).category==='attack')
      switch(c.role) {
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
          if(c.role==='medium')p.hand.push(recovered);else p.deck.unshift(recovered)
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
