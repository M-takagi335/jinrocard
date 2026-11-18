import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {card, RULES, STARTER, validDeck} from '../src/cards.ts'
import {chooseNpc, Duel as OfficialDuel} from '../src/duel.ts'
import {generateDeck} from '../src/generateDeck.ts'
import {promptRank, random} from './balance.ts'

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length,2,before)
  return source.replace(before,after)
}

const file=new URL('../src/duel.ts',import.meta.url)
let source=readFileSync(file,'utf8')
const pick=source.slice(source.indexOf('export function chooseNpc'),source.indexOf('export class Duel'))
const gentle=replaceOnce(replaceOnce(replaceOnce(pick,'chooseNpc(view:NpcView, rng:()=>number)',
  'chooseGentle(view:NpcView, rng:()=>number, soften:boolean, pairRate:number)'),
  "+ (c.role === 'spy' ? spyBonus : 0) + rng()*3", "+ (c.role === 'spy' ? spyBonus : 0) + rng()*3 - (soften ? penalty(c.role) : 0)"),
  'rng() < .74','rng() < pairRate')
source=replaceOnce(source,'shield[target]-=reduction','shield[target]-=reduction; this.observe?.("guard",target,reduction)')
source=replaceOnce(source,"      if(raid && count(target,'trap')) {","      const intended=raid\n      const readyShield=shield[target]\n      if(raid && count(target,'trap')) {")
source=replaceOnce(source,'      dmg[target]=hit(target,raid+special)',`      this.observe?.('raid',i,intended,Math.max(0,raid-readyShield))
      this.observe?.('guard',target,intended-raid)
      dmg[target]=hit(target,raid+special)`)
source=replaceOnce(source,'      if (lost) this.write(who[i]',`      this.observe?.('damage',other(i),Math.min(lost,dmg[i]+returns[i]))
      if (lost) this.write(who[i]`)
source=replaceOnce(source,"        this.write(who[i]+'はHPを'+gained+'回復した。')",
  "        this.observe?.('healing',i,gained); this.write(who[i]+'はHPを'+gained+'回復した。')")
source=(source+'\n'+gentle+`
function penalty(role:Role) {
  if(role==='hunter'||role==='trap') return 1.55
  if(role==='knight') return .65
  return card(role).category==='attack' ? 1.35 : 0
}
`).replace(/from '(\.\/[^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL(path,file).href))
const {Duel,chooseGentle}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'))

const raidRoles=new Set(['wolf','dire','fox'])
const guards=new Set(['hunter','trap','knight'])
const sideIds=[0,1]
function opponentAttack(view){
  const total=view.enemyRemaining.reduce((n,c)=>n+c.count,0)
  const attack=view.enemyRemaining.filter(c=>card(c.role).category==='attack').reduce((n,c)=>n+c.count,0)
  return total ? 1-(1-attack/total)**2 : 0
}

// A simple, bounded shortlist. Judges the card's basic use without sampling hidden hands.
function choosePractical(view,rng){
  const chance=opponentAttack(view)
  const deficit=RULES.hp-view.hp
  const points=role=>{
    const spec=card(role)
    switch(role){
      case 'wolf': return 3.55
      case 'dire': return view.hp<=4 ? -5 : 3.65
      case 'fox': return view.hp<=spec.lowHp ? 3.8 : 3.2
      case 'hunter': case 'trap': return 2.35+.75*chance
      case 'knight': return 2.55+.55*chance
      case 'witch': return view.noHeal ? -4 : deficit<2 ? -.3 : 2+Math.min(4,deficit)
      case 'merchant': return view.hp<=spec.recoil ? -12 : 2.6
      case 'medium': case 'keeper': return view.discard.length ? 2.85 : -2
      case 'spy': case 'jester': {
        const left=Math.max(0,view.hand.length-Math.min(2,view.max))
        const net=Math.min(RULES.handLimit,Math.max(RULES.handRefill,left+spec.power))
          - Math.max(RULES.handRefill,left)
        return 2.2+net*.48*(role==='spy'?chance:1-chance)
      }
      default: return 2.85
    }
  }
  const ranked=view.hand.map(c=>({c,points:points(c.role)+rng()*2.3})).sort((a,b)=>b.points-a.points)
  if(!ranked.length)return []
  const first=ranked[0]
  const compatible=({c,points})=>{
    if(points<2.55)return false
    // Prefer complementary effects, avoiding redundant all-night shields and overhealing.
    if((first.c.role==='trap'||first.c.role==='hunter')&&(c.role==='trap'||c.role==='hunter'))return false
    if(first.c.role==='witch'&&c.role==='witch'&&deficit<6)return false
    return (card(first.c.role).recoil??0)+(card(c.role).recoil??0)<view.hp
  }
  const second=view.max>1 && ranked.length>1 && rng()<.61 ? ranked.slice(1).find(compatible) : undefined
  const moves=second?[first.c,second.c]:[first.c]
  const guesses=view.enemyRemaining.flatMap(({role,count})=>Array(count).fill(role))
  return moves.map(c=>c.role==='assassin'&&guesses.length
    ? {id:c.id,guess:guesses[Math.floor(rng()*guesses.length)]}:{id:c.id})
}
const policies={
  A:chooseNpc,
  B:(view,rng)=>chooseGentle(view,rng,true,.74),
  C:(view,rng)=>chooseGentle(view,rng,false,.46),
  D:(view,rng)=>chooseGentle(view,rng,true,.46),
  E:choosePractical,
}

const metrics=['nights','attack','raider','guardUsed','one','two','damage','guard','raid','raidHit','raidPower',
  'witch','healed','healAmount','seer','prophet','assassin','assassinGuess','retaliator','dualAttack',
  'direLow','merchantLethal','witchFull','recycles','overflow','refills','limited','noTargetRecovery']
const blank=()=>Object.fromEntries(metrics.map(k=>[k,0]))
const isAttack=role=>card(role).category==='attack'
function run(first,second,leader,rival,seed,focal,Engine=Duel){
  const rivalSide=1-focal
  const line=focal===0?[first,second]:[second,first]
  const game=new Engine(...line,{twoHumans:true,rng:random(seed)})
  const stats=[blank(),blank()]
  game.observe=(kind,side,one,two)=>{
    if(kind!=='raid'){
      const m=stats[side]
      if(kind==='healing'){m.healed+=Number(one>0);m.healAmount+=one}
      else m[kind]+=one
    }else if(one){
      const m=stats[side]
      m.raid++
      m.raidHit+=Number(two>0)
      m.raidPower+=two
    }
  }
  let steps=0, cursor=0
  while(game.phase!=='finished'){
    assert.ok(++steps<300,'Duel did not finish')
    if(game.prompt){
      const {side,title,options}=game.prompt
      const player=game.players[side]
      const recover=title.includes('回収')
      const rank=c=>promptRank(c.role,player.hp,player.status.noHeal,player.discard.length)*(recover?-1:1)
      if(title.startsWith('手札上限')) stats[side].overflow++
      assert.ok(game.answer([...options].sort((a,b)=>rank(a)-rank(b))[0].id))
    }else if(game.phase==='select'){
      const pair=sideIds.map(side=>{
        const m=stats[side]
        const view=game.strongNpcView(side)
        const rng=random(seed^Math.imul(game.night,0x454dd58d)^(side===focal?0x529527ab:0x37afa453))
        const policy=side===focal?leader:rival
        const move=policies[policy](view,rng)
        assert.ok(game.canLock(side,move), policy+' chose an illegal move')
        assert.ok(move.length<=view.max)
        const submitted=move.map(({id})=>view.hand.find(c=>c.id===id).role)
        m.nights++
        m.one+=Number(move.length===1)
        m.two+=Number(move.length===2)
        m.limited+=Number(view.max===1)
        m.attack+=Number(submitted.some(isAttack))
        m.raider+=Number(submitted.some(role=>raidRoles.has(role)))
        m.guardUsed+=Number(submitted.some(role=>guards.has(role)))
        m.dualAttack+=Number(submitted.filter(isAttack).length===2)
        m.retaliator+=Number(submitted.includes('cat'))
        for(const role of ['witch','seer','prophet','assassin'])m[role]+=submitted.filter(r=>r===role).length
        m.witchFull+=Number(view.hp===20&&submitted.includes('witch'))
        m.noTargetRecovery+=Number(!view.discard.length&&submitted.some(r=>r==='medium'||r==='keeper'))
        m.direLow+=Number(view.hp<=4&&submitted.includes('dire'))
        m.merchantLethal+=Number(submitted.filter(r=>r==='merchant').length*card('merchant').recoil>=view.hp)
        for(const act of move.filter(({id})=>view.hand.find(c=>c.id===id).role==='assassin')){
          if(view.enemyRemaining.length) assert.ok(view.enemyRemaining.some(x=>x.role===act.guess))
          m.assassinGuess+=Number(act.guess!==undefined)
        }
        return move
      })
      assert.ok(game.lockBoth(pair))
      game.resolve()
    }else assert.ok(game.nextNight())
    for(;cursor<game.log.length;cursor++){
      const {text}=game.log[cursor]
      const side=text.startsWith('プレイヤー')?0:text.startsWith('NPC')?1:null
      if(side===null)continue
      if(text.includes('捨て札をシャッフルして山札に戻した'))stats[side].recycles++
      if(text.includes('夜終了時に手札を'))stats[side].refills++
    }
    if(!game.prompt && game.phase!=='resolve')assert.ok(game.players.every(p=>p.hand.length<=RULES.handLimit))
  }
  return {win:Number(game.winner===focal),draw:Number(game.winner==='draw'),night:game.night,
    hp:game.players[focal].hp, enemyHp:game.players[rivalSide].hp,
    hpDecision:Number(game.night===15&&game.players.every(p=>p.hp>0)),
    hpWin:Number(game.night===15&&game.players.every(p=>p.hp>0)&&game.winner===focal),
    player:stats[focal], enemy:stats[rivalSide]}
}

// Cross-check instrumented solves against the clean production engine under identical decisions.
for(const policy of Object.keys(policies))for(const seed of [19,317,64927]){
  const a=run(STARTER,STARTER,policy,'A',seed,0)
  const b=run(STARTER,STARTER,policy,'A',seed,0,OfficialDuel)
  for(const key of ['win','draw','night','hp','enemyHp','hpDecision'])assert.equal(a[key],b[key])
}
const privacyGame=new OfficialDuel(STARTER,STARTER,{twoHumans:true,rng:random(23)})
const originalView=privacyGame.strongNpcView(0)
const opponent=privacyGame.players[1]
const index=opponent.deck.findIndex(c=>c.role!==opponent.hand[0].role)
assert.ok(index>=0)
const hiddenCard=opponent.hand[0]
opponent.hand[0]=opponent.deck[index]
opponent.deck[index]=hiddenCard
opponent.deck.reverse()
const maskedView=privacyGame.strongNpcView(0)
assert.deepEqual(maskedView,originalView)
for(const choose of Object.values(policies))assert.deepEqual(choose(originalView,random(67)),choose(maskedView,random(67)))

const example=(roles,hp,noHeal=false)=>({...originalView,hp,noHeal,max:1,
  hand:roles.map((role,id)=>({role,id}))})
assert.deepEqual(choosePractical(example(['dire','merchant','witch'],2),()=>0),[{id:2}])
assert.deepEqual(choosePractical(example(['merchant','knight'],1),()=>0),[{id:1}])
assert.deepEqual(choosePractical(example(['witch','wolf'],12,true),()=>0),[{id:1}])
assert.equal(card('spy').power,2)

const fixtures={
  standard:()=>[STARTER,STARTER],
  random:rng=>[generateDeck('random',rng),generateDeck('random',rng)],
  rush:rng=>[STARTER,generateDeck('rush',rng)],
  defense:rng=>[STARTER,generateDeck('defense',rng)],
  intel:rng=>[STARTER,generateDeck('intel',rng)],
  'random-rush':rng=>[generateDeck('random',rng),generateDeck('rush',rng)],
  'random-defense':rng=>[generateDeck('random',rng),generateDeck('defense',rng)],
  'random-intel':rng=>[generateDeck('random',rng),generateDeck('intel',rng)],
}
const stage=process.argv[2]??'pilot'
const size=Number(process.argv[3]??(stage==='final'?160:20))
assert.ok(['pilot','final'].includes(stage)&&Number.isSafeInteger(size)&&size>0)
const base=stage==='pilot'?0x45f32131:0x98cc57d7
const add=(dest,origin)=>{for(const k in origin)dest[k]+=origin[k]}
const pairs=[...Object.keys(policies).map(id=>[id,'A'])]
if(stage==='final')for(const [i,a] of ['B','C','D','E'].entries())for(const b of ['B','C','D','E'].slice(i+1))pairs.push([a,b])
for(const [leader,rival] of pairs)for(const [name,make] of Object.entries(fixtures)){
  if(rival!=='A'&&!['standard','random'].includes(name))continue
  const seeds=rival==='A'?size:Math.floor(size/2)
  const stats={wins:0,draws:0,nights:0,hp:0,enemyHp:0,hpDecision:0,hpWin:0,player:blank(),enemy:blank(),pairWins:[]}
  const start=performance.now()
  for(let i=0;i<seeds;i++){
    const seed=(base+Math.imul(i,0x9e3779b9))>>>0
    const [first,second]=make(random(seed^0x581289cd))
    assert.ok(validDeck(first)&&validDeck(second))
    let wins=0
    for(const focal of sideIds){
      const result=run(first,second,leader,rival,seed,focal)
      wins+=result.win
      stats.draws+=result.draw
      stats.nights+=result.night
      for(const key of ['hp','enemyHp','hpDecision','hpWin'])stats[key]+=result[key]
      add(stats.player,result.player)
      add(stats.enemy,result.enemy)
    }
    stats.wins+=wins
    stats.pairWins.push(wins)
  }
  console.log(JSON.stringify({leader,rival,name,stage,games:seeds*2,ms:performance.now()-start,...stats}))
}
