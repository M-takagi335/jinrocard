import assert from 'node:assert/strict'
import test from 'node:test'
import { STARTER } from '../src/cards.ts'
import { Duel, chooseNpc, type Play } from '../src/duel.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { random } from '../scripts/balance.ts'

test('default and explicit standard use the original NPC decision with the same RNG', () => {
  const seed = 103
  const rng = random(seed)
  const original = new Duel(STARTER, STARTER, { rng, npc: view => chooseNpc(view, rng) })
  const automatic = new Duel(STARTER, STARTER, { rng: random(seed) })
  const explicit = new Duel(STARTER, STARTER, { rng: random(seed), npcDifficulty: 'standard' })
  assert.equal(automatic.npcDifficulty, 'standard')
  for (const game of [original, automatic, explicit]) assert.ok(game.lock([ordinaryPlay(game)]))
  assert.deepEqual(original.revealed, automatic.revealed)
  assert.deepEqual(original.revealed, explicit.revealed)
})

test('strong NPC gets identical information and chooses identically after private cards are rearranged', () => {
  const game = new Duel(STARTER, STARTER, { rng: random(3), npcDifficulty: 'strong' })
  const visible = game.strongNpcView(1)
  const move = chooseStrongNpc(visible, random(78))
  const player = game.players[0]
  const index = player.deck.findIndex(card => card.role !== player.hand[0].role)
  assert.notEqual(index, -1)
  const handCard = player.hand[0]
  player.hand[0] = player.deck[index]
  player.deck[index] = handCard
  player.deck.reverse()
  assert.deepEqual(game.strongNpcView(1), visible)
  assert.deepEqual(chooseStrongNpc(game.strongNpcView(1), random(78)), move)
  assert.deepEqual(game.strongNpcView(1), visible)
})

test('strong NPC produces legal guesses and respects the action limit and empty hands', () => {
  const game = new Duel(STARTER, STARTER, { rng: random(6), npcDifficulty: 'strong' })
  const base = game.strongNpcView(1)
  const view = { ...base, hand: [{ id: 101, role: 'assassin' as const }, { id: 102, role: 'assassin' as const }],
    max: 1, enemyRemaining: [{ role: 'wolf' as const, count: 2 }], enemyHandCount: 2 }
  assert.deepEqual(chooseStrongNpc({ ...view, hand: [] }, random(1)), [])
  for (let seed = 0; seed < 40; seed++) {
    const move = chooseStrongNpc(view, random(seed))
    assert.equal(move.length, 1)
    assert.equal(move[0].guess, 'wolf')
    assert.ok(view.hand.some(card => card.id === move[0].id))
  }
  assert.ok(game.lock([ordinaryPlay(game)]))
  assert.ok(game.revealed[1].length >= 1 && game.revealed[1].length <= game.max(1))
})

function ordinaryPlay(game: Duel): Play {
  return { id: game.players[0].hand.find(card => card.role !== 'assassin')!.id }
}
