import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { STARTER, validDeck } from '../src/cards.ts'
import { Duel, chooseNpc, chooseEasyNpc } from '../src/duel.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { chooseStrongestNpc } from '../src/strongestNpc.ts'
import { generateDeck } from '../src/generateDeck.ts'

const fixed = {"D343":["wolf","wolf","wolf","dire","assassin","assassin","fox","fox","cat","hunter","knight","witch","witch","trap","trap","mason","mason","mad","mad","curse"],"D272":["wolf","assassin","assassin","cat","cat","hunter","hunter","hunter","knight","knight","witch","witch","trap","trap","seer","seer","jester","medium","mason","mason"]}
const types=['standard','rush','defense','intel','combo','random','D343','D272']
const algorithms={easy:chooseEasyNpc,standard:chooseNpc,strong:chooseStrongNpc,strongest:chooseStrongestNpc}
const levels=Object.keys(algorithms)
const random=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
const mix=(...xs)=>xs.reduce((s,x)=>Math.imul(s^(x+1),0x45d9f3b)>>>0,0x1718c)
const rows=[]
const reps=Number(process.env.TRAP_RELEASE_PAIRS??16)
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child)}return value}
let games=0
for(let a=0;a<levels.length;a++)for(let b=a+1;b<levels.length;b++){
 const left=levels[a],right=levels[b]
 for(const [index,type] of types.entries()){
  const outcomes=[];let nights=0
  for(let pair=0;pair<reps;pair++){
   const seed=mix(a,b,index,pair,0x20b6)
   const cards=type==='standard'?[...STARTER]:fixed[type]??generateDeck(type,random(mix(seed,1)))
   assert.ok(validDeck(cards))
   for(const swapped of [false,true]){
    const names=swapped?[right,left]:[left,right]
    const rngs=names.map(name=>random(mix(seed,levels.indexOf(name),3)))
    const game=new Duel(cards,cards,{twoHumans:true,rng:random(mix(seed,2))})
    let steps=0
    while(game.phase!=='finished'){
     assert.ok(++steps<250)
     if(game.phase==='select'){
      const plays=names.map((name,side)=>{
       const view=freeze(structuredClone({...game.strongNpcView(side),investigations:game.investigationsFor(side)}))
       const result=algorithms[name](view,rngs[side]);assert.ok(game.canLock(side,result));return result
      })
      assert.ok(game.lockBoth(plays));game.resolve()
     }else if(game.prompt)assert.ok(game.answer(game.prompt.options[0].id))
     else assert.ok(game.nextNight())
     assert.ok(game.players.every(p=>p.hp>=0&&p.hp<=20))
    }
    outcomes.push(game.winner==='draw'?'draw':game.winner===(swapped?1:0)?'win':'loss')
    nights+=game.night;games++
   }
  }
  const wins=outcomes.filter(x=>x==='win').length,losses=outcomes.filter(x=>x==='loss').length
  const clusters=Array.from({length:reps},(_,i)=>(Number(outcomes[i*2]==='win')+Number(outcomes[i*2+1]==='win'))/2)
  const mean=wins/outcomes.length,se=Math.sqrt(clusters.reduce((s,v)=>s+(v-mean)**2,0)/(reps-1)/reps)
  rows.push({left,right,type,games:outcomes.length,wins,losses,draws:outcomes.length-wins-losses,winRate:mean,ci95:[Math.max(0,mean-1.96*se),Math.min(1,mean+1.96*se)],averageNight:nights/outcomes.length})
 }
 console.log(JSON.stringify({left,right,games}))
 await writeFile('reports/trap-release-npc-summary.json',JSON.stringify({games,seed:'0x20b6; mix 0x1718c',pairsPerDeck:reps,rows},null,2)+'\n')
}
