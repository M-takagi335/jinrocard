import assert from 'node:assert/strict'
import { STARTER, type Role } from '../src/cards.ts'
import { Duel, chooseNpc } from '../src/duel.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { promptRank, random } from './balance.ts'

const randomDeck = random(0x84c3491a)
const lineup: Record<string, Role[]> = {
  standard: STARTER,
  rush: generateDeck('rush', randomDeck),
  defense: generateDeck('defense', randomDeck),
  intel: generateDeck('intel', randomDeck),
  D343: ['wolf','wolf','wolf','dire','assassin','assassin','fox','fox','cat','hunter','knight',
    'witch','witch','trap','trap','mason','mason','mad','mad','curse'],
}
const pairs = Number(process.argv[2] ?? 500)
assert.ok(Number.isSafeInteger(pairs) && pairs > 0)
const timings: number[] = []
for (const [name, deck] of Object.entries(lineup)) {
  const wins = [0, 0]
  const draws = [0, 0]
  for (let seed = 0; seed < pairs; seed++) for (const side of [0, 1] as const) {
    const rng = random((Math.imul(seed + 1, 0x9e3779b1) ^ 0x58926301) >>> 0)
    const game = new Duel(deck, deck, { rng, npcDifficulty: side === 1 ? 'strong' : 'standard' })
    let steps = 0
    while (game.phase !== 'finished') {
      assert.ok(++steps < 250)
      if (game.phase === 'select') {
        const view = game.strongNpcView(0)
        const before = performance.now()
        const move = side === 0 ? chooseStrongNpc(view, rng) : chooseNpc(view, rng)
        if (side === 0) timings.push(performance.now() - before)
        assert.ok(game.lock(move))
        game.resolve()
      } else if (game.phase === 'choice') {
        const { side: actor, options, title } = game.prompt!
        const self = game.players[actor]
        const rank = (role: Role) => promptRank(role, self.hp, self.status.noHeal, self.discard.length)
        const sign = title.includes('回収') ? 1 : -1
        assert.ok(game.answer([...options].sort((a, b) => (rank(b.role) - rank(a.role)) * sign)[0].id))
      } else assert.ok(game.nextNight())
    }
    wins[side] += Number(game.winner === side)
    draws[side] += Number(game.winner === 'draw')
  }
  console.log(JSON.stringify({ deck: name, games: pairs * 2, wins, draws }))
}
timings.sort((a, b) => a - b)
console.log(JSON.stringify({ decisions: timings.length, meanMs: timings.reduce((sum, ms) => sum + ms, 0) / timings.length,
  p95Ms: timings[Math.floor(timings.length * .95)], maxMs: timings.at(-1) }))
