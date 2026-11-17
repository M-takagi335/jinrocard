import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { card, RULES, STARTER, validDeck } from '../src/cards.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { chooseStrongestNpc } from '../src/strongestNpc.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { decks, promptRank, random } from './balance.ts'

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, before)
  return source.replace(before, after)
}

async function load(name, edit) {
  const url = new URL('../src/' + name + '.ts', import.meta.url)
  const source = edit(readFileSync(url, 'utf8')).replace(/from '(\.\/[^']+)'/g,
    (_, path) => 'from ' + JSON.stringify(new URL(path, url).href))
  return import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
}

const { Duel, chooseNpc, chooseAdjustedNpc } = await load('duel', source => {
  const observed = replaceOnce(source, "if(attacks===(c.role==='spy')) this.draw(i,spec.power!)",
    `if(attacks===(c.role==='spy')) {
      const before=p.hand.length
      this.draw(i,c.role==='spy' && i===this.spySide ? this.spyPower : spec.power!)
      this.intelSample?.(i,c.role,true,p.hand.length-before)
    }`)
  const monitored = replaceOnce(observed, "else this.write(who[i]+'の'+spec.name+'は条件を満たさなかった。')",
    `else {
      this.intelSample?.(i,c.role,false,0)
      this.write(who[i]+'の'+spec.name+'は条件を満たさなかった。')
    }`)
  const withRefill = replaceOnce(monitored, 'const shortage = refillTarget - this.players[i].hand.length',
    'this.beforeRefill?.(i); const shortage = refillTarget - this.players[i].hand.length')
  const withRecycle = replaceOnce(withRefill, "this.updateProphet(side, 'shuffle')",
    "this.updateProphet(side, 'shuffle'); this.onRecycle?.(side)")
  const impl = withRecycle.slice(withRecycle.indexOf('export function chooseNpc'), withRecycle.indexOf('export class Duel'))
  return withRecycle + '\n' + replaceOnce(impl.replace('chooseNpc','chooseAdjustedNpc'), '+rng()*3',
    "+(c.role==='spy' ? .5*Math.min(1,view.enemyRemaining.filter(x=>card(x.role).category==='attack').reduce((n,x)=>n+x.count,0)/4) : 0)+rng()*3")
})
const adjustedCard = "const card = (role: Role) => role === 'spy' ? { ...baseCard(role), power: 2 } : baseCard(role)"
const adjust = source => source.replace(/(import \{[^\n]*\b)card,/, '$'+'1card as baseCard,') + '\n' + adjustedCard
const strongAdjusted = (await load('strongNpc', adjust)).chooseStrongNpc
const strongestAdjusted = (await load('strongestNpc', adjust)).chooseStrongestNpc

const baseDecks = {
  標準寄り: [...STARTER.filter(r=>!['spy','seer','medium','mason'].includes(r)), 'seer','prophet','medium','mason'],
  耐久寄り: [...decks.defense.filter(r=>!['jester','seer','mason','medium'].includes(r)), 'seer','prophet','medium','mason'],
}
const builds = { '0': [], S1:['spy'], S2:['spy','spy'], J1:['jester'], J2:['jester','jester'],
  S1J1:['spy','jester'], S2J2:['spy','spy','jester','jester'] }
const fixed = {
  D343:'wolf wolf wolf dire assassin assassin fox fox cat hunter knight witch witch trap trap mason mason mad mad curse',
  D272:'wolf assassin assassin cat cat hunter hunter hunter knight knight witch witch trap trap seer seer jester medium mason mason',
}
const rivals = {
  標準:()=>STARTER, 速攻:r=>generateDeck('rush',r), 耐久:r=>generateDeck('defense',r),
  情報:r=>generateDeck('intel',r), コンボ:r=>generateDeck('combo',r),
  ...Object.fromEntries(Object.entries(fixed).map(([name, roles])=>[name,()=>roles.split(' ')])),
}
const units = ['used','checked','hit','drawn','refill','ends','net','offset','overflow','recycle','windows','hitWindows','hitEnds','missWindows','missEnds']
const roles = ['spy','jester']
const seats = [0,1]
const policies = { standard:chooseNpc, strong:chooseStrongNpc, strongest:chooseStrongestNpc }
const adjusted = { standard:chooseAdjustedNpc, strong:strongAdjusted, strongest:strongestAdjusted }
const bucket = n => Math.min(4,n)
const record = () => Object.fromEntries(roles.map(role=>[role,Array.from({length:5},()=>Array(units.length).fill(0))]))

// Check only the card and automatic refill at a controlled hand size.
for (const power of [1,2]) for (const attack of [false,true]) for (let remaining=0;remaining<=6;remaining++){
  const game=new Duel(STARTER,STARTER,{twoHumans:true,rng:random(0x143aa123)})
  game.spyPower=power
  game.spySide=0
  const place=(side,role,size)=>{
    const player=game.players[side]
    const pool=[...player.hand,...player.deck]
    const chosen=pool.splice(pool.findIndex(c=>c.role===role),1)[0]
    player.hand=[chosen,...pool.splice(0,size-1)]
    player.deck=pool
    return [{id:chosen.id}]
  }
  assert.ok(game.lockBoth([place(0,'spy',remaining+1),place(1,attack?'wolf':'hunter',6)]))
  game.resolve()
  while(game.prompt) assert.ok(game.answer(game.prompt.options[0].id))
  assert.equal(game.players[0].hand.length, Math.min(7,Math.max(2,remaining+(attack?power:0))))
}

function run(deck, enemy, mode, variant, seed, focal) {
  const sides = focal===0 ? [deck,enemy] : [enemy,deck]
  const game = new Duel(...sides, { twoHumans:true, rng:random(seed) })
  game.spySide = focal
  game.spyPower = ({ A:1, B:2, adjusted:2 })[variant]
  const rows = record()
  const p = game.players[focal]
  let night = null
  let steps = 0
  let attacks = 0
  let rounds = 0
  game.intelSample = (side, role, hit, drawn) => {
    if(side===focal) {
      const row=night[role]
      row[1]++; row[2]+=Number(hit); row[3]+=drawn
    }
  }
  game.beforeRefill = side => {
    if(side===focal) night.pre = [p.hand.length,p.deck.length+p.discard.length]
  }
  game.onRecycle = side => {
    if(side===focal && night) night.recycle++
  }
  while(game.phase!=='finished'){
    assert.ok(++steps<300)
    if(game.prompt){
      const prompt=game.prompt
      const player=game.players[prompt.side]
      const recover=prompt.title.includes('回収')
      if(night && prompt.side===focal && prompt.title.startsWith('手札上限')) night.overflow++
      const rank=role=>promptRank(role,player.hp,player.status.noHeal,player.discard.length)*(recover?-1:1)
      assert.ok(game.answer([...prompt.options].sort((a,b)=>rank(a.role)-rank(b.role))[0].id))
    }else if(game.phase==='select'){
      const plays=seats.map(side=>{
        const rng=random(seed ^ Math.imul(game.night,0x9e3779b9) ^ (side===focal?0x529527ab:0x37afa453))
        const view=game.strongNpcView(side)
        const policy=side===focal && variant==='adjusted' ? adjusted[mode] : policies[mode]
        return policy(mode==='strongest'?{...view,investigations:game.investigationsFor(side)}:view,rng)
      })
      const selected=plays[focal].map(move=>p.hand.find(c=>c.id===move.id).role)
      night={size:bucket(p.hand.length-selected.length),spy:Array(units.length).fill(0),jester:Array(units.length).fill(0),
        overflow:0,pre:null,recycle:0}
      for(const role of roles) night[role][0]=selected.filter(r=>r===role).length
      const other=1-focal
      attacks+=Number(plays[other].some(move=>card(game.players[other].hand.find(c=>c.id===move.id).role).category==='attack'))
      rounds++
      assert.ok(game.lockBoth(plays))
      game.resolve()
    }else assert.ok(game.nextNight())
    if(night && (game.phase==='end'||game.phase==='finished')){
      for(const role of roles){
        const row=night[role]
        if(!row[0])continue
        const [hand,stock]=night.pre ?? [p.hand.length,0]
        const final=p.hand.length
        const refill=night.pre ? Math.min(Math.max(0,RULES.handRefill-hand),stock) : 0
        const without=hand-row[3]
        // Hold other effects fixed; put this role's draws back into available stock.
        const refillWithout=night.pre ? Math.min(Math.max(0,RULES.handRefill-without),stock+row[3]) : 0
        row[4]=refill
        row[5]=final
        row[6]=final-Math.min(RULES.handLimit,without+refillWithout)
        row[7]=refillWithout-refill
        row[8]=night.overflow
        row[9]=night.recycle
        row[10]=1
        if(row[2]){row[11]=1;row[12]=final}
        else if(row[1]){row[13]=1;row[14]=final}
        if(night.pre) assert.equal(final,Math.min(RULES.handLimit,hand+refill))
        row.forEach((n,i)=>rows[role][night.size][i]+=n)
      }
      night=null
    }
  }
  return {win:Number(game.winner===focal),draw:Number(game.winner==='draw'),rows,attacks,rounds}
}

const stage=process.argv[2] ?? 'final'
assert.ok(['pilot','final','strongest'].includes(stage))
const count=Number(process.argv[3] ?? (stage==='final'?48:stage==='strongest'?5:2))
assert.ok(Number.isSafeInteger(count) && count>0)
const start={pilot:0x153da915,final:0xc34b1259,strongest:0x6f21a812}[stage]
const modes=stage==='strongest'?['strongest']:['standard','strong']
for(const mode of modes) for(const [baseName,base] of Object.entries(baseDecks)){
  for(const [opponent,make] of Object.entries(rivals)){
    for(const [build,slots] of Object.entries(builds)){
      const deck=[...base]
      slots.forEach((role,i)=>{deck[deck.length-4+i]=role})
      assert.ok(validDeck(deck),build)
      const variants=slots.includes('spy')?['A','B','adjusted']:['A']
      const totals=Object.fromEntries(variants.map(v=>[v,{wins:0,draws:0,rows:record(),pairWins:[],attacks:0,rounds:0}]))
      for(let i=0;i<count;i++){
        const seed=(start+Math.imul(i,0x9e3779b9))>>>0
        const enemy=make(random(seed^0x254afb19))
        assert.ok(validDeck(enemy),opponent)
        for(const v of variants){
          const total=totals[v]
          let pair=0
          for(const side of seats){
            const result=run(deck,enemy,mode,v,seed,side)
            pair+=result.win
            total.draws+=result.draw
            total.attacks+=result.attacks
            total.rounds+=result.rounds
            for(const role of roles) result.rows[role].forEach((row,b)=>row.forEach((n,j)=>total.rows[role][b][j]+=n))
          }
          total.wins+=pair
          total.pairWins.push(pair)
        }
      }
      console.log(JSON.stringify({mode,baseName,opponent,build,games:count*2,units,totals}))
    }
  }
}
