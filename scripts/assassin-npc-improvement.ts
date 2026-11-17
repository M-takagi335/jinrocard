import assert from 'node:assert/strict'
import { STARTER, validDeck, type Role } from '../src/cards.ts'
import { Duel, type Side } from '../src/duel.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { promptRank, random } from './balance.ts'
import {
  assassinEvidence, assassinForecast, experimentalStrongNpc, experimentalView, projectNight, type Features,
} from './experimentalStrongNpc.ts'

const plans: Record<string, Features | undefined> = {
  A: undefined, base: {}, B: { assassin: true }, C: { assassin: true, assassinIntel: true },
  D: { assassin: true, assassinTiming: true },
  E: { assassin: true, assassinIntel: true, assassinTiming: true },
  F: { assassin: true, assassinIntel: true, assassinTiming: true, lookahead: true },
  G: { lookahead: true },
}
const phase = process.argv[2] ?? 'final'
assert.ok(phase === 'pilot' || phase === 'final')
const pairs = Number(process.argv[3] ?? (phase === 'pilot' ? 5 : 45))
assert.ok(Number.isSafeInteger(pairs) && pairs > 1)
const names = process.argv[4]?.split(',') ?? Object.keys(plans)
const salt = phase === 'pilot' ? 0x345fb872 : 0xd010ef86
const deckRng = random(0x3ed93a4f)
const withoutSeer = STARTER.map(r => r === 'seer' ? 'jester' : r)
const two = withoutSeer.map(r => r === 'tyrant' ? 'assassin' : r)
const decks: Record<string, Role[]> = {
  one: withoutSeer, two,
  seer: two.map(r => r === 'jester' ? 'seer' : r),
  prophet: two.map(r => r === 'jester' ? 'prophet' : r),
  both: two.map(r => r === 'jester' ? 'seer' : r === 'curse' ? 'prophet' : r),
  rush: generateDeck('rush', deckRng), defense: generateDeck('defense', deckRng),
  intel: generateDeck('intel', deckRng), combo: generateDeck('combo', deckRng), standard: STARTER,
  D343: ['wolf','wolf','wolf','dire','assassin','assassin','fox','fox','cat','hunter','knight',
    'witch','witch','trap','trap','mason','mason','mad','mad','curse'],
}
const matches = [
  ['one', 'standard'], ['two', 'two'], ['seer', 'rush'], ['prophet', 'defense'],
  ['both', 'both'], ['rush', 'combo'], ['intel', 'intel'], ['D343', 'D343'],
  ['both', 'random'], ['prophet', 'standard'],
]
for (const deck of Object.values(decks)) assert.ok(validDeck(deck))
for (const [left] of matches) assert.ok(decks[left].includes('assassin'), left)
const infoStats = () => ({ n: 0, hits: 0 })
const stats = () => ({
  wins: [0, 0], draws: 0, plays: 0, attempted: 0, hits: 0, heldAtEnd: 0, heldCopies: 0,
  seer: infoStats(), prophet: infoStats(), noEvidence: infoStats(), same: 0, different: 0, pairedWithOther: 0,
  withOneHeld: 0, winningHit: 0, pivotalHp: 0, pairedWins: [] as number[],
})
const calibration = () => Array.from({ length: 5 }, () => ({ n: 0, p: 0, actual: 0, square: 0 }))
const bins = [calibration(), calibration()]
const top = [infoStats(), infoStats()]
let fixedViews = 0
function observe(view: ReturnType<typeof experimentalView>, roles: Role[], seed: number) {
  fixedViews++
  for (const mode of [0, 1]) {
    const distribution = assassinForecast(view, random(seed), mode === 1)
    const first = distribution[0]
    if (first) {
      top[mode].n++
      top[mode].hits += Number(roles.includes(first.role))
    }
    for (const { role, probability } of distribution) {
      const bin = bins[mode][Math.min(4, Math.floor(probability * 5))]
      const actual = Number(roles.includes(role))
      bin.n++
      bin.p += probability
      bin.actual += actual
      bin.square += (probability - actual) ** 2
    }
  }
}
for (const name of names) {
  assert.ok(Object.hasOwn(plans, name), name)
  const features = plans[name]
  const rows = [], time: number[] = []
  for (const [index, [left, right]] of matches.entries()) {
    const result = stats()
    for (let pair = 0; pair < pairs; pair++) {
      const seed = (salt ^ Math.imul(pair + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x7c15b532)) >>> 0
      const subject = decks[left], foe = decks[right] ?? generateDeck('random', random(seed ^ 0xe87e1758))
      let pairWins = 0
      for (const side of [0, 1] as const) {
        const [a,b] = side === 0 ? [subject, foe] : [foe, subject]
        const duel = new Duel(a, b, { twoHumans: true, rng: random(seed) })
        let steps = 0, finalHit = false, finalPivotal = false
        while (duel.phase !== 'finished') {
          assert.ok(++steps < 250)
          if (duel.phase === 'select') {
            const views = [experimentalView(duel, 0), experimentalView(duel, 1)] as const
            const move = (actor: Side) => {
              const rng = random(seed ^ Math.imul(duel.night, 0x85ebca6b) ^ (actor ? 0xcfba248d : 0x448e55b1))
              const before = performance.now()
              const plays = actor === side && features ? experimentalStrongNpc(views[actor], rng, features) : chooseStrongNpc(views[actor], rng)
              if (actor === side) time.push(performance.now() - before)
              assert.ok(duel.canLock(actor, plays))
              return plays
            }
            assert.ok(duel.lockBoth([move(0), move(1)]))
            duel.resolve()
            const ours = duel.revealed[side], theirs = duel.revealed[1 - side]
            const own = views[side]
            if (name === 'A' && own.hand.some(c => c.role === 'assassin') && assassinEvidence(own).hand.size) {
              // Labels are read only after both moves and never feed a policy or subsequent RNG.
              observe(own, theirs.map(c=>c.role), seed ^ Math.imul(duel.night, 713))
            }
            const evidence = features?.assassinIntel ? assassinEvidence(own).hand : new Map<Role, {kind:'seer'|'prophet'}>()
            const assassins = ours.filter(c => c.role === 'assassin')
            result.plays += assassins.length
            if (assassins.length === 2) result[assassins[0].guess === assassins[1].guess ? 'same' : 'different']++
            if (assassins.length === 1 && ours.length === 2) result.pairedWithOther++
            if (assassins.length === 1 && own.hand.filter(c => c.role === 'assassin').length === 2) result.withOneHeld++
            finalHit = false
            for (const c of assassins) {
              if (c.disabled || !c.guess) continue
              result.attempted++
              const bucket = result[evidence.get(c.guess)?.kind ?? 'noEvidence']
              bucket.n++
              if (theirs.some(target => target.role === c.guess)) {
                result.hits++
                bucket.hits++
                finalHit = true
              }
            }
            finalPivotal = false
            if (finalHit) {
              const rows = [duel.revealed[0], duel.revealed[1]] as const
              const cancel = rows.flatMap(row => {
                const disabled = row.flatMap((c, i) => c.disabled ? [i] : [])
                return disabled.length ? [disabled[0], disabled[1] ?? disabled[0]] : [0, 0]
              }) as [number, number, number, number]
              const actions = (actor: Side) => rows[actor].map(c => ({
                role: c.role, guess: actor === side && c.role === 'assassin' ? undefined : c.guess,
              }))
              const hp = projectNight([actions(0), actions(1)], [views[0].hp, views[1].hp], cancel).hp
              // A local counterfactual only: without the hit would the night's winning HP condition still hold?
              finalPivotal = duel.night === duel.rules.finalNight ? hp[side] <= hp[1 - side] :
                hp[side] === 0 || hp[1 - side] > 0
            }
          } else if (duel.phase === 'choice') {
            const { side: actor, options, title } = duel.prompt!
            const p = duel.players[actor]
            const rank = (role: Role) => promptRank(role, p.hp, p.status.noHeal, p.discard.length)
            const sign = title.includes('回収') ? 1 : -1
            assert.ok(duel.answer([...options].sort((x, y) => (rank(y.role) - rank(x.role)) * sign)[0].id))
          } else assert.ok(duel.nextNight())
        }
        const held = duel.players[side].hand.filter(c => c.role === 'assassin').length
        result.heldAtEnd += Number(held > 0)
        result.heldCopies += held
        if (duel.winner === side) {
          result.wins[side]++
          pairWins++
          result.winningHit += Number(finalHit)
          result.pivotalHp += Number(finalHit && finalPivotal)
        }
        if (duel.winner === 'draw') result.draws++
      }
      result.pairedWins.push(pairWins / 2)
    }
    rows.push({ left, right, games: pairs * 2, ...result })
  }
  time.sort((a,b)=>a-b)
  console.log(JSON.stringify({ name, phase, pairs, rows, timing: { n: time.length,
    mean: time.reduce((a,b)=>a+b,0)/time.length, p95: time[Math.ceil(time.length*.95)-1], max: time.at(-1) } }))
}
if (names.includes('A')) console.log(JSON.stringify({ fixedViews, top, bins }))
