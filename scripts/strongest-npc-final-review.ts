import assert from 'node:assert/strict'
import { STARTER, validDeck, type Role } from '../src/cards.ts'
import { chooseNpc, Duel, type Play, type Side } from '../src/duel.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { plan, promptRank, random } from './balance.ts'
import {
  assassinEvidence, assassinForecast, experimentalStrongNpc, experimentalView, projectNight,
  type ExperimentalView, type Features,
} from './experimentalStrongNpc.ts'

const modes = { B: { assassin: true, assassinIntel: true, assassinTiming: true, lookahead: true },
  C: { lookahead: true }, D: { assassin: true, assassinIntel: true, lookahead: true } } satisfies Record<string, Features>
type Candidate = 'A' | keyof typeof modes
type Policy = Candidate | 'standard' | 'attack' | 'guard' | 'one' | 'two' | 'random'
const policies: readonly Policy[] = ['standard','attack','guard','one','two','random']
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
const mirrors = [...Object.keys(decks), 'random'].map(name=>({left:name,right:name,opponent:'A' as const}))
const mixed: [string,string][] = [['D343','D272'],['intel','rush'],['both','defense'],['prophet','standard']]
const other: [string,string][] = [['standard','balanced'],['combo','rush'],['two','defense'],['seer','D343'],
  ['rush','D272'],['intel','random'],['defense','one'],['both','combo'],['D343','standard'],
  ['prophet','intel'],['D272','balanced'],['balanced','both']]
const main: Match[] = [...mirrors, ...mixed.map(([left,right])=>({left,right,opponent:'A' as const})),
  ...other.map(([left,right],i)=>({left,right,opponent:policies[i%policies.length]}))]
const direct = [...mirrors.filter(m=>['standard','rush','defense','both','D343','D272'].includes(m.left)), ...mixed.map(([left,right])=>({left,right,opponent:'A' as const}))]

function decide(policy: Policy, view: ExperimentalView, rng: () => number): Play[] {
  if (policy === 'A') return chooseStrongNpc(view, rng)
  if (policy === 'B' || policy === 'C' || policy === 'D') return experimentalStrongNpc(view, rng, modes[policy])
  if (policy === 'standard') return chooseNpc(view, rng)
  if (policy === 'random') {
    const hand = [...view.hand]
    const count = Math.min(hand.length, 1 + Math.floor(rng() * view.max))
    return Array.from({ length: count }, () => {
      const [{ id, role }] = hand.splice(Math.floor(rng()*hand.length), 1)
      const guess = view.enemyRemaining[Math.floor(rng()*view.enemyRemaining.length)]?.role
      return role === 'assassin' && guess ? { id, guess } : { id }
    })
  }
  return plan({style:policy==='attack'?'rush':policy==='guard'?'defense':'balanced',
    policy:policy==='one'||policy==='two'?policy:policy==='guard'?'cycle':'neutral'},view,view.night,rng,new Set<Role>())
}

const info = () => ({ hits: 0, n: 0 })
const fresh = () => ({
  wins: [0,0], losses: 0, draws: 0, pairedWins: [] as number[],
  late: [0,0,0], plays: 0, tries: 0, hits: 0, heldAtEnd: 0, heldNights: 0, investigateFirst: 0,
  same: 0, different: 0, winKoByHit: 0, seer: info(), prophet: info(), noEvidence: info(),
})
const phase = process.argv[2] ?? 'main'
assert.ok(phase === 'main' || phase === 'direct' || phase === 'direct-reverse')
const pairs = Number(process.argv[3] ?? (phase==='main' ? 50 : 60))
assert.ok(Number.isInteger(pairs) && pairs > 1)
const contenders = process.argv[4]?.split(',') as Candidate[] | undefined
const plans: [Candidate, Candidate?][] = phase==='main'
  ? (contenders ?? ['A','B','C','D']).map(name=>[name])
  : [['B','C'],['B','D'],['D','C']]
const salt = phase==='main' ? 0x6bd23109 : phase==='direct' ? 0x18f7ab34 : 0xa6fb902c
const schedule = phase==='main' ? main : phase==='direct' ? direct :
  mixed.map(([right,left])=>({left,right,opponent:'A' as const}))

for (const [subject, rival] of plans) {
  const rows = [], times: number[] = [], heavy: number[] = []
  let heap = 0
  const fixed = { count:0, top:[0,0], square:[0,0], roles:0 }
  for (const [index, match] of schedule.entries()) {
    const opponent = rival ?? match.opponent
    const {left,right} = match
    const stats = fresh()
    for (let pair=0; pair<pairs; pair++) {
      const seed = (salt ^ Math.imul(pair+1,0x9e3779b1) ^ Math.imul(index+1,0x7c15b532)) >>> 0
      const randomDeck = generateDeck('random', random(seed ^ 0xf197ea3b))
      const ours = decks[left] ?? randomDeck, theirs = decks[right] ?? randomDeck
      let winsThisPair = 0
      for (const side of [0,1] as const) {
        const line = side===0?[ours,theirs]:[theirs,ours]
        const duel = new Duel(line[0],line[1],{twoHumans:true,rng:random(seed)})
        let steps=0, pivotal=false
        while (duel.phase!=='finished') {
          assert.ok(++steps<250)
          if (duel.phase==='select') {
            const views=[experimentalView(duel,0),experimentalView(duel,1)] as const
            const move=(actor:Side)=>{
              const rng=random(seed ^ Math.imul(duel.night,0x85ebca6b) ^ (actor?0x44b38423:0xab11c091))
              const t=performance.now()
              const result=decide(actor===side?subject:opponent,views[actor],rng)
              if(actor===side){
                const elapsed=performance.now()-t
                times.push(elapsed)
                if(views[actor].hand.length===7 && views[actor].hand.filter(c=>c.role==='assassin').length===2) heavy.push(elapsed)
              }
              assert.ok(duel.canLock(actor,result))
              return result
            }
            assert.ok(duel.lockBoth([move(0),move(1)]))
            duel.resolve()
            const own=views[side], ownCards=duel.revealed[side], enemyCards=duel.revealed[1-side]
            const assassins=ownCards.filter(c=>c.role==='assassin')
            const held=own.hand.filter(c=>c.role==='assassin').length
            stats.heldNights += Number(held>0)
            stats.investigateFirst += Number(held>assassins.length && ownCards.some(c=>!c.disabled && (c.role==='seer'||c.role==='prophet')))
            stats.plays+=assassins.length
            if(assassins.length===2) stats[assassins[0].guess===assassins[1].guess?'same':'different']++
            const evidence=subject==='B'||subject==='D'?assassinEvidence(own).hand:new Map()
            let hit=false
            for (const c of assassins) if (!c.disabled && c.guess) {
              const success=enemyCards.some(a=>a.role===c.guess)
              stats.tries++; stats.hits+=Number(success)
              const category: 'seer' | 'prophet' | 'noEvidence' = evidence.get(c.guess)?.kind ?? 'noEvidence'
              stats[category].n++; stats[category].hits+=Number(success)
              hit ||= success
            }
            pivotal=false
            if(hit && duel.phase==='finished' && duel.winner===side && duel.players[1-side].hp===0) {
              const cancel=duel.revealed.flatMap(cards=>{
                const targets=cards.flatMap((c,i)=>c.disabled?[i]:[])
                return [targets[0]??0,targets[1]??targets[0]??0]
              }) as [number,number,number,number]
              const stripped=([0,1] as const).map(actor=>duel.revealed[actor].map(c=>({role:c.role,
                guess:actor===side && c.role==='assassin'?undefined:c.guess})))
              const hp=projectNight([stripped[0],stripped[1]],[views[0].hp,views[1].hp],cancel).hp
              pivotal=hp[1-side]>0||hp[side]===0
            }
            if(subject==='A' && phase==='main' && held && assassinEvidence(own).hand.size) {
              fixed.count++
              for (const i of [0,1] as const) {
                const guesses=assassinForecast(own,random(seed ^ Math.imul(duel.night, 1193)),!!i)
                if(i===0) fixed.roles+=guesses.length
                fixed.top[i]+=Number(enemyCards.some(c=>c.role===guesses[0]?.role))
                for (const {role,probability} of guesses) fixed.square[i]+=(probability-Number(enemyCards.some(c=>c.role===role)))**2
              }
            }
          } else if (duel.phase==='choice') {
            const {side:actor,options,title}=duel.prompt!
            const p=duel.players[actor], score=(role:Role)=>promptRank(role,p.hp,p.status.noHeal,p.discard.length)
            const sign=title.includes('回収')?1:-1
            assert.ok(duel.answer([...options].sort((a,b)=>(score(b.role)-score(a.role))*sign)[0].id))
          } else assert.ok(duel.nextNight())
        }
        const won=duel.winner===side, drawn=duel.winner==='draw'
        if(won){stats.wins[side]++;winsThisPair++}
        else if(drawn) stats.draws++
        else stats.losses++
        if(duel.night>=14) stats.late[won?0:drawn?2:1]++
        stats.winKoByHit+=Number(won&&pivotal)
        stats.heldAtEnd+=Number(duel.players[side].hand.some(c=>c.role==='assassin'))
      }
      stats.pairedWins.push(winsThisPair/2)
      heap=Math.max(heap,process.memoryUsage().heapUsed)
    }
    rows.push({...match,opponent,games:pairs*2,...stats})
  }
  const sample=(latency:number[])=>{
    latency.sort((a,b)=>a-b)
    return {n:latency.length,mean:latency.reduce((a,b)=>a+b,0)/latency.length,
      p95:latency[Math.ceil(latency.length*.95)-1],max:latency.at(-1)}
  }
  console.log(JSON.stringify({phase,subject,rival,pairs,salt,rows,timing:sample(times),heavy:sample(heavy),heap,fixed}))
}
