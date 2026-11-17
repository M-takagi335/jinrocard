import assert from 'node:assert/strict'
import test from 'node:test'
import { CARDS, ROLES, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { reviewEngine } from '../scripts/card-review-engine.ts'

const deck = (prefix: Role[]) => [...prefix, ...ROLES.filter(role => !prefix.includes(role))].slice(0, 20)
const pick = (duel: Duel, side: 0 | 1, role: Role) => ({
  id: duel.players[side].hand.find(entry => entry.role === role)!.id,
})

test('review instrumentation preserves the current engine’s result and random consumption', async () => {
  const review = await reviewEngine('current')
  const run = (Engine: typeof Duel) => {
    let draws = 0
    const duel = new Engine(deck(['curse', 'wolf', 'merchant']), deck(['witch', 'hunter', 'knight']),
      { twoHumans: true, rng: () => { draws++; return .9999 } })
    assert.ok(duel.lockBoth([[pick(duel, 0, 'wolf'), pick(duel, 0, 'curse')], [pick(duel, 1, 'witch')]]))
    duel.resolve()
    assert.ok(duel.nextNight())
    assert.ok(duel.lockBoth([[pick(duel, 0, 'merchant')], [pick(duel, 1, 'hunter')]]))
    duel.resolve()
    while (duel.prompt) assert.ok(duel.answer(duel.prompt.options[0].id))
    return { players: duel.players, reveals: duel.revealed, draws, phase: duel.phase,
      log: duel.log.filter(entry => !entry.text.startsWith('@')) }
  }
  assert.deepEqual(run(review.Duel), run(Duel))
})

test('Merchant scenarios change only their experimental payment or draw count', async () => {
  for (const [variant, cost, draws] of [['current', 2, 3], ['merchant-hp1', 1, 3], ['merchant-draw4', 2, 4]] as const) {
    const kit = await reviewEngine(variant)
    const duel = new kit.Duel(deck(['merchant']), deck(['hunter']), { twoHumans: true, rng: () => .9999 })
    const play = pick(duel, 0, 'merchant')
    assert.ok(duel.lockBoth([[play], [pick(duel, 1, 'hunter')]]))
    duel.resolve()
    assert.equal(duel.players[0].hp, 20 - cost)
    assert.ok(duel.log.some(entry => entry.text === '@effect:' + play.id + ':' + draws))
    assert.equal(CARDS.merchant.recoil, 2)
    assert.equal(CARDS.merchant.power, 3)
  }
})

test('Keeper scenarios move the selected instance exactly once and preserve its identity', async () => {
  for (const variant of ['current', 'keeper-hand', 'keeper-top-draw'] as const) {
    const kit = await reviewEngine(variant)
    const duel = new kit.Duel(deck(['wolf','keeper']), deck(['hunter','hunter']), { twoHumans: true, rng: () => .9999 })
    const wolf = pick(duel, 0, 'wolf')
    assert.ok(duel.lockBoth([[wolf], [pick(duel, 1, 'hunter')]]))
    duel.resolve()
    assert.ok(duel.nextNight())
    assert.ok(duel.lockBoth([[pick(duel, 0, 'keeper')], [pick(duel, 1, 'hunter')]]))
    duel.resolve()
    assert.ok(duel.answer(wolf.id))
    const player = duel.players[0]
    assert.equal(player.discard.some(entry => entry.id === wolf.id), false)
    assert.equal(player.hand.some(entry => entry.id === wolf.id), variant !== 'current')
    if (variant === 'current') assert.equal(player.deck[0].id, wolf.id)
    assert.equal(new Set([...player.deck, ...player.hand, ...player.discard].map(entry => entry.id)).size, 20)
  }
})
