import assert from 'node:assert/strict'
import { STARTER, validDeck, type Role } from '../src/cards.ts'
import { Duel, type Side } from '../src/duel.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { promptRank, random } from './balance.ts'
import { assassinEvidence, experimentalStrongNpc, experimentalView, type Features } from './experimentalStrongNpc.ts'

const previous = { assassin: true, assassinIntel: true, lookahead: true }
const modes = {
  A: undefined, B: previous, C: { ...previous, accurateFuture: true }, D: { ...previous, fast: true },
  E: { ...previous, accurateFuture: true, fast: true },
} satisfies Record<string, Features | undefined>
type Candidate = keyof typeof modes
const deckRng = random(0x7b439ad6)
const one = STARTER.map(r => r === 'seer' ? 'jester' : r)
const two = one.map(r => r === 'tyrant' ? 'assassin' : r)
const decks: Record<string, Role[]> = {
  standard: STARTER, balanced: generateDeck('balanced', deckRng), rush: generateDeck('rush', deckRng),
  defense: generateDeck('defense', deckRng), intel: generateDeck('intel', deckRng), combo: generateDeck('combo', deckRng),
  one, two, seer: two.map(r=>r==='jester'?'seer':r), prophet: two.map(r=>r==='jester'?'prophet':r),
  both: two.map(r=>r==='jester'?'seer':r==='curse'?'prophet':r),
  D343: ['wolf','wolf','wolf','dire','assassin','assassin','fox','fox','cat','hunter','knight',
    'witch','witch','trap','trap','mason','mason','mad','mad','curse'],
  D272: ['wolf','assassin','assassin','cat','cat','hunter','hunter','hunter','knight','knight','witch','witch',
    'trap','trap','seer','seer','jester','medium','mason','mason'],
}
for (const deck of Object.values(decks)) assert.ok(validDeck(deck))

type Match = { left: string; right: string; opponent: Policy }
const mirrors = [...Object.keys(decks), 'random'].map(name=>({left:name,right:name}))
const mixed: [string,string][] = [['D343','D272'],['intel','rush'],['both','defense'],['prophet','standard']]
const schedule = [...mirrors, ...mixed.map(([left,right])=>({left,right}))]
const opponent = (process.argv[2] ?? 'A') as 'A' | 'B'
assert.ok(opponent === 'A' || opponent === 'B')
const repeats = Number(process.argv[3] ?? 22)
assert.ok(Number.isSafeInteger(repeats) && repeats > 1)
const candidates = (process.argv[4]?.split(',') ?? Object.keys(modes)) as Candidate[]
const salt = opponent === 'A' ? 0x9db27143 : 0x38fe2c65
for (const subject of candidates) {
  assert.ok(Object.hasOwn(modes,subject))
  const rows = [], latency: number[] = []
  let peakHeap = 0
  for (const [idx,{left,right}] of schedule.entries()) {
    const counts = { wins:0, draws:0, losses:0, paired:[] as number[], attempts:0, hits:0, uses:0, held:0,
      seer:[0,0], prophet:[0,0], unbacked:[0,0], late:[0,0,0] }
    for (let pair=0; pair<repeats; pair++) {
      const seed = (salt ^ Math.imul(pair+1,0x9e3779b1) ^ Math.imul(idx+1,0x7c15b532)) >>> 0
      const pool = generateDeck('random',random(seed^0xb024b724))
      const decksForMatch = [decks[left]??pool,decks[right]??pool]
      let pairWins=0
      for (const side of [0,1] as const) {
        const duel=new Duel(decksForMatch[side],decksForMatch[1-side],{twoHumans:true,rng:random(seed)})
        let steps=0
        while(duel.phase!=='finished'){
          assert.ok(++steps<250)
          if(duel.phase==='select'){
            const views=[experimentalView(duel,0),experimentalView(duel,1)] as const
            const choose=(actor:Side)=>{
              const policy=actor===side?subject:opponent
              const view=views[actor], rng=random(seed^Math.imul(duel.night,0x85ebca6b)^(actor?0xa5b42ef9:0xc13ad761))
              const before=performance.now(), mode=modes[policy]
              const move=mode?experimentalStrongNpc(view,rng,mode):chooseStrongNpc(view,rng)
              if(actor===side)latency.push(performance.now()-before)
              assert.ok(duel.canLock(actor,move))
              return move
            }
            assert.ok(duel.lockBoth([choose(0),choose(1)]))
            duel.resolve()
            const evidence=subject==='A'?new Map<Role,{kind:'seer'|'prophet'}>():assassinEvidence(views[side]).hand
            for(const c of duel.revealed[side]) if(c.role==='assassin'){
              counts.uses++
              if(c.disabled||!c.guess)continue
              const hit=Number(duel.revealed[1-side].some(enemy=>enemy.role===c.guess))
              counts.attempts++
              counts.hits+=hit
              const bucket=counts[evidence.get(c.guess)?.kind??'unbacked']
              bucket[0]++
              bucket[1]+=hit
            }
          }else if(duel.phase==='choice'){
            const {side:actor,options,title}=duel.prompt!, p=duel.players[actor]
            const rank=(role:Role)=>promptRank(role,p.hp,p.status.noHeal,p.discard.length)
            const sign=title.includes('回収')?1:-1
            assert.ok(duel.answer([...options].sort((a,b)=>(rank(b.role)-rank(a.role))*sign)[0].id))
          }else assert.ok(duel.nextNight())
        }
        const index=duel.winner===side?0:duel.winner==='draw'?2:1
        if(index===0){counts.wins++;pairWins++}
        else if(index===1)counts.losses++
        else counts.draws++
        if(duel.night>=14) counts.late[index]++
        counts.held+=Number(duel.players[side].hand.some(c=>c.role==='assassin'))
      }
      counts.paired.push(pairWins/2)
      peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed)
    }
    rows.push({left,right,games:repeats*2,...counts})
  }
  latency.sort((a,b)=>a-b)
  console.log(JSON.stringify({subject,opponent,repeats,rows,peakHeap,timing:{n:latency.length,
    mean:latency.reduce((a,b)=>a+b,0)/latency.length,p95:latency[Math.ceil(latency.length*.95)-1],max:latency.at(-1)}}))
}
