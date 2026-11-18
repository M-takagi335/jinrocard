import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads'
import {card, RULES, STARTER, validDeck} from '../src/cards.ts'
import {Duel as OfficialDuel, chooseEasyNpc, chooseNpc} from '../src/duel.ts'
import {generateDeck} from '../src/generateDeck.ts'
import {chooseStrongNpc} from '../src/strongNpc.ts'
import {chooseStrongestNpc, strongestRandom} from '../src/strongestNpc.ts'
import {random} from './balance.ts'

const pairs=[['easy','standard'],['easy','strong'],['easy','strongest'],
  ['standard','strong'],['standard','strongest'],['strong','strongest']]
const profile=(type,rng)=>generateDeck(type,rng)
const mirror=type=>rng=>{const deck=profile(type,rng);return [deck,deck]}
const cross=(a,b)=>rng=>[profile(a,rng),profile(b,rng)]
const fixtures=[
  ['standard',false,()=>[STARTER,STARTER]],
  ['random-mirror',false,mirror('random')],
  ['random-independent',true,cross('random','random')],
  ['rush',false,mirror('rush')],['defense',false,mirror('defense')],['intel',false,mirror('intel')],
  ['rush-defense',true,cross('rush','defense')],['rush-intel',true,cross('rush','intel')],
  ['defense-intel',true,cross('defense','intel')],
]
const modes={easy:chooseEasyNpc,standard:chooseNpc,strong:chooseStrongNpc,strongest:chooseStrongestNpc}

async function instrument() {
  const file=new URL('../src/duel.ts',import.meta.url)
  let source=readFileSync(file,'utf8')
  function once(before,after){
    assert.equal(source.split(before).length,2,before)
    source=source.replace(before,after)
  }
  // Expose the production NPC's prompt rank and observe existing phases without changing them.
  source+='\nexport { value }\n'
  once('const reduction=Math.min(amount,shield[target])',
    'const reduction=Math.min(amount,shield[target]); this.observe?.("prevent",target,reduction)')
  once('    const shield=sides.map',`    for(const side of sides){
      this.observe?.('defense',side,Number(active[side].some(c=>['hunter','trap','knight'].includes(c.role))))
    }
    const shield=sides.map`)
  once("          this.write(who[i]+'の暗殺者の予想",`          this.observe?.('guess',i,Number(success))
          this.write(who[i]+'の暗殺者の予想`)
  once("      if(raid && count(target,'trap')) {",`      const plannedRaid=raid
      if(raid && count(target,'trap')) {`)
  once('      dmg[target]=hit(target,raid+special)',`      this.observe?.('raid',i,plannedRaid,Math.max(0,raid-shield[target]))
      this.observe?.('prevent',target,plannedRaid-raid)
      dmg[target]=hit(target,raid+special)`)
  once('      if (lost) this.write(who[i]',`      this.observe?.('damage',other(i),Math.min(lost,dmg[i]+returns[i]))
      if (lost) this.write(who[i]`)
  once("        this.write(who[i]+'はHPを'+gained+'回復した。')",
    "        this.observe?.('heal',i,gained); this.write(who[i]+'はHPを'+gained+'回復した。')")
  source=source.replace(/from '(\.\/[^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL(path,file).href))
  return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
}
const fields=['night','damage','raid','raidHit','defense','defended','prevented','guess','correct',
  'heal','witch','one','two','decisions','ms','win','loss','draw','hp']
const empty=()=>Object.fromEntries(fields.map(key=>[key,0]))
const add=(a,b)=>{for(const k of fields)a[k]+=b[k]}
const seats=[0,1]
function swap(pair){return [pair[1],pair[0]]}

function match(Engine,rank,policies,decks,seed,flipped){
  const roles=flipped?swap(policies):policies
  const line=flipped?swap(decks):decks
  const g=new Engine(...line,{twoHumans:true,rng:random(seed^0x7509ff23)})
  const totals=[empty(),empty()]
  const prevented=[0,0]
  g.observe=(kind,i,n,passed)=>{
    const t=totals[i]
    switch(kind){
      case 'raid': if(n){t.raid++;t.raidHit+=Number(passed>0)} break
      case 'prevent': prevented[i]+=n;t.prevented+=n;break
      case 'guess': t.guess++;t.correct+=n;break
      default:t[kind]+=n
    }
  }
  for(let steps=0;g.phase!=='finished';steps++){
    assert.ok(steps<300,'match failed to terminate')
    if(g.prompt){
      const {side,title,options}=g.prompt
      const p=g.players[side]
      const recover=title.includes('回収')
      const score=c=>rank(c.role,p.hp,p.status.noHeal,p.discard.length)
      const id=[...options].sort((a,b)=>(score(b)-score(a))*(recover?1:-1))[0].id
      assert.ok(g.answer(id))
    }else if(g.phase==='select'){
      prevented.fill(0)
      const plays=seats.map(i=>{
        const level=roles[i]
        const own=flipped?1-i:i
        const rngSeed=(seed^Math.imul(g.night,0x9e3779b9)^(own===0?0x529527ab:0x37afa453))>>>0
        const view=g.strongNpcView(i)
        const info=level==='strongest'?{...view,investigations:g.investigationsFor(i)}:view
        const rng=level==='strongest'?strongestRandom(rngSeed):random(rngSeed)
        const t=totals[i]
        const start=performance.now()
        const play=modes[level](info,rng)
        t.ms+=performance.now()-start
        t.decisions++
        assert.ok(g.canLock(i,play),level+' illegal move')
        t.one+=Number(play.length===1)
        t.two+=Number(play.length===2)
        t.witch+=play.filter(p=>view.hand.find(c=>c.id===p.id).role==='witch').length
        return play
      })
      assert.ok(g.lockBoth(plays))
      g.resolve()
      for(const i of seats)totals[i].defended+=Number(prevented[i]>0)
    }else assert.ok(g.nextNight())
    if(!g.prompt)assert.ok(g.players.every(p=>p.hand.length<=RULES.handLimit))
  }
  for(const i of seats){
    const t=totals[i]
    t.night=g.night
    t.hp=g.players[i].hp
    t.win=Number(g.winner===i)
    t.loss=Number(g.winner===1-i)
    t.draw=Number(g.winner==='draw')
  }
  return flipped?swap(totals):totals
}

async function run({pair,count}){
  const {Duel,value}=await instrument()
  const privacy=new OfficialDuel(STARTER,STARTER,{twoHumans:true,rng:random(23)})
  const allowed=()=>({...privacy.strongNpcView(0),investigations:privacy.investigationsFor(0)})
  const before=allowed()
  const opponent=privacy.players[1]
  const index=opponent.deck.findIndex(c=>c.role!==opponent.hand[0].role)
  assert.ok(index>=0)
  const hidden=opponent.hand[0]
  opponent.hand[0]=opponent.deck[index]
  opponent.deck[index]=hidden
  opponent.deck.reverse()
  const after=allowed()
  assert.deepEqual(after,before)
  for(const level of pair){
    const rng=level==='strongest'?strongestRandom:random
    assert.deepEqual(modes[level](before,rng(76)),modes[level](after,rng(76)))
  }
  // Spot-check the measured engine against the pristine one with the same legal move and RNG inputs.
  for(const seed of [91,313,512]){
    const trace=match(Duel,value,pair,[STARTER,STARTER],seed,false)
    const control=match(OfficialDuel,value,pair,[STARTER,STARTER],seed,false)
    for(const i of seats)for(const field of ['night','hp','win','draw','one','two'])assert.equal(trace[i][field],control[i][field])
  }
  for(const [name,rotate,create] of fixtures){
    const totals=[empty(),empty()]
    const samples=[]
    const start=performance.now()
    for(let index=0;index<count;index++){
      const a=(0x193260a3+Math.imul(index,0x9e3779b9))>>>0
      const b=(a^0x43bea521)>>>0
      const first=create(random(a^0xc8123651))
      const second=rotate?swap(first):create(random(b^0xc8123651))
      for(const decks of [first,second]) assert.ok(decks.every(deck=>validDeck(deck)))
      const clusters=[empty(),empty()]
      for(const [seed,decks] of [[a,first],[rotate?a:b,second]]) for(const flipped of [false,true]){
        const values=match(Duel,value,pair,decks,seed,flipped)
        for(const i of seats)add(clusters[i],values[i])
      }
      for(const i of seats)add(totals[i],clusters[i])
      samples.push(clusters.map(({win,draw})=>[win,draw]))
    }
    parentPort.postMessage({pair,name,games:count*4,wallMs:performance.now()-start,totals,samples})
  }
}

if(!isMainThread){
  await run(workerData)
}else{
  const count=Number(process.argv[2]??144)
  assert.ok(Number.isInteger(count)&&count>1)
  const selected=process.argv[3]===undefined?pairs:[pairs[Number(process.argv[3])]]
  assert.ok(selected.every(Boolean))
  await Promise.all(selected.map(pair=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{pair,count}})
    worker.on('message',row=>console.log(JSON.stringify(row)))
    worker.on('error',reject)
    worker.on('exit',code=>code===0?resolve():reject(new Error(pair+' exit '+code)))
  })))
}
