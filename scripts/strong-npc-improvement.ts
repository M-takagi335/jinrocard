import assert from 'node:assert/strict'
import { STARTER, validDeck, type Role } from '../src/cards.ts'
import { Duel, type Side } from '../src/duel.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { promptRank, random } from './balance.ts'
import { experimentalStrongNpc, experimentalView, type Features } from './experimentalStrongNpc.ts'

const plans: Record<string, Features | undefined> = {
  control: undefined, core: {}, prediction: { prediction: true }, lookahead: { lookahead: true },
  intel: { intel: true }, all: { prediction: true, lookahead: true, intel: true },
}
const phase = process.argv[2] ?? 'final'
assert.ok(phase === 'pilot' || phase === 'final')
const pairs = Number(process.argv[3] ?? (phase === 'pilot' ? 10 : 50))
assert.ok(Number.isSafeInteger(pairs) && pairs > 1)
const choices = process.argv[4]?.split(',') ?? Object.keys(plans)
const mix = phase === 'pilot' ? 0x1c29ca70 : 0xc5400ed1
const deckRng = random(0x78f59cea)
const decks: Record<string, Role[]> = {
  standard: STARTER, balance: generateDeck('balanced', deckRng), rush: generateDeck('rush', deckRng),
  defense: generateDeck('defense', deckRng), intel: generateDeck('intel', deckRng), combo: generateDeck('combo', deckRng),
  D343: ['wolf','wolf','wolf','dire','assassin','assassin','fox','fox','cat','hunter','knight',
    'witch','witch','trap','trap','mason','mason','mad','mad','curse'],
  D272: ['wolf','assassin','assassin','cat','cat','hunter','hunter','hunter','knight','knight','witch','witch',
    'trap','trap','seer','seer','jester','medium','mason','mason'],
}
const matches = [...Object.keys(decks).map(d => [d, d]), ['random', 'random'], ['D343', 'D272'], ['intel', 'rush']]
for (const deck of Object.values(decks)) assert.ok(validDeck(deck))
function sample(values: number[]) {
  values.sort((a, b) => a - b)
  return values.length ? {
    n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: values[Math.ceil(values.length * .95) - 1], max: values.at(-1),
  } : null
}
for (const name of choices) {
  assert.ok(Object.hasOwn(plans, name), name)
  const features = plans[name]
  const rows = []
  const timings: number[] = [], full: number[] = [], end: number[] = [], heavy: number[] = []
  let peakHeap = process.memoryUsage().heapUsed
  for (const [match, [left, right]] of matches.entries()) {
    const counts = { wins: [0, 0], draws: 0, pairedWins: [] as number[], hit: [0, 0], attempts: [0, 0] }
    for (let pair = 0; pair < pairs; pair++) {
      const seed = (mix ^ Math.imul(pair + 1, 0x9e3779b1) ^ Math.imul(match + 1, 0x7c15b532)) >>> 0
      const generated = generateDeck('random', random(seed ^ 0x9fb613c7))
      const subject = decks[left] ?? generated, opponent = decks[right] ?? generated
      let pairWins = 0
      for (const side of [0, 1] as const) {
        const lineup = side === 0 ? [subject, opponent] : [opponent, subject]
        const duel = new Duel(lineup[0], lineup[1], { twoHumans: true, rng: random(seed) })
        let steps = 0
        while (duel.phase !== 'finished') {
          assert.ok(++steps < 250)
          if (duel.phase === 'select') {
            const move = (actor: Side) => {
              // AI draws never shift game RNG, and each policy starts at the same seed each night.
              const rng = random(seed ^ Math.imul(duel.night, 0x85ebca6b) ^ (actor ? 0x9ec5f90d : 0x315cb28a))
              const view = experimentalView(duel, actor)
              const time = performance.now()
              const result = actor === side && features ? experimentalStrongNpc(view, rng, features) : chooseStrongNpc(view, rng)
              if (actor === side) {
                const ms = performance.now() - time
                timings.push(ms)
                if (view.hand.length === 7) full.push(ms)
                if (view.night >= 14) end.push(ms)
                if (left === 'D343' || left === 'D272') heavy.push(ms)
              }
              assert.ok(duel.canLock(actor, result))
              return result
            }
            assert.ok(duel.lockBoth([move(0), move(1)]))
            duel.resolve()
            for (const actor of [0, 1] as const) for (const play of duel.revealed[actor]) {
              if (play.role !== 'assassin' || play.disabled || !play.guess) continue
              const index = Number(actor !== side)
              counts.attempts[index]++
              if (duel.revealed[1 - actor].some(c => c.role === play.guess)) counts.hit[index]++
            }
          } else if (duel.phase === 'choice') {
            const { side: actor, options, title } = duel.prompt!
            const p = duel.players[actor]
            const rank = (role: Role) => promptRank(role, p.hp, p.status.noHeal, p.discard.length)
            const sign = title.includes('回収') ? 1 : -1
            assert.ok(duel.answer([...options].sort((a, b) => (rank(b.role) - rank(a.role)) * sign)[0].id))
          } else assert.ok(duel.nextNight())
        }
        if (duel.winner === side) { counts.wins[side]++; pairWins++ }
        if (duel.winner === 'draw') counts.draws++
      }
      counts.pairedWins.push(pairWins / 2)
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
    }
    rows.push({ left, right, games: pairs * 2, ...counts })
  }
  console.log(JSON.stringify({ name, phase, pairs, seed: mix, rows, timings: sample(timings),
    full: sample(full), end: sample(end), heavy: sample(heavy), peakHeap }))
}
