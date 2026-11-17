import assert from 'node:assert/strict'
import { test } from 'node:test'
import { card, ROLES, STARTER, validDeck, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { random } from '../scripts/balance.ts'
import { experimentalStrongNpc, experimentalView, handEvidence, projectNight } from '../scripts/experimentalStrongNpc.ts'

const deckWith = (first: Role[]) => {
  const deck = [...first]
  for (const role of ROLES) {
    while (deck.length < 20 && deck.filter(r => r === role).length < card(role).limit) deck.push(role)
  }
  assert.ok(validDeck(deck))
  return deck
}

test('experimental projection matches real engine HP with all roles and combat interactions', () => {
  const rng = random(0x08b51c06)
  const pick = () => ROLES[Math.floor(rng() * ROLES.length)]
  const curated: [Role[], Role[]][] = [
    [['dire', 'merchant'], ['witch', 'curse']], [['merchant', 'merchant'], ['knight', 'witch']],
    [['wolf', 'cat'], ['trap', 'knight']], [['fox', 'cat'], ['cat', 'dire']],
    [['assassin', 'mad'], ['mad', 'witch']], [['mad', 'mad'], ['assassin', 'knight']],
  ]
  for (let trial = 0; trial < 1200; trial++) {
    const roles = curated[trial % 3 === 0 && trial < 180 ? Math.floor(trial / 3) % curated.length : -1] ??
      [Array.from({ length: trial % 2 + 1 }, pick), Array.from({ length: Math.floor(rng() * 2) + 1 }, pick)]
    for (const entries of roles) if (entries[0] === 'tyrant' && entries[1] === 'tyrant') entries[1] = 'seer'
    const hp: [number, number] = [1 + Math.floor(rng() * 20), 1 + Math.floor(rng() * 20)]
    const [left, right] = roles.map(deckWith)
    const cancel: [number, number, number, number] = [0, 0, 0, 0].map(() => Math.floor(rng() * 2)) as typeof cancel
    const moves = roles.map((entries, side) => entries.map((role, i) => ({ role,
      guess: role === 'assassin' ? roles[1 - side][i % roles[1 - side].length] : undefined })))
    const draws = roles.flatMap((entries, side) => roles[1 - side].length === 2 ?
      entries.filter(r => r === 'mad').map((_, i) => (cancel[(1 - side) * 2 + i] + .1) / 2) : [])
    let resolving = false
    const duel = new Duel(left, right, { twoHumans: true, rng: () => resolving ? draws.shift() ?? .9 : .999999 })
    duel.players[0].hp = hp[0]
    duel.players[1].hp = hp[1]
    const plays = ([0, 1] as const).map(side => moves[side].map((a, i) => ({ id: duel.players[side].hand[i].id, guess: a.guess })))
    assert.ok(duel.lockBoth([plays[0], plays[1]]))
    resolving = true
    duel.resolve()
    const expected = projectNight([moves[0], moves[1]], hp, cancel)
    assert.deepEqual(duel.players.map(p => p.hp), expected.hp, JSON.stringify({ trial, moves, hp, cancel }))
    assert.deepEqual(duel.revealed.map(row => row.filter(c => !c.disabled).map(c => c.role)),
      expected.active.map(row => row.map(c => c.role)))
  }
})

test('only permitted observations reach the experimental NPC and private permutations do not affect play', () => {
  const duel = new Duel(deckWith(['seer','prophet','assassin']), deckWith(['seer','prophet','assassin']),
    { twoHumans: true, rng: () => .999999 })
  assert.ok(duel.lockBoth([
    duel.players[0].hand.slice(0, 2).map(c => ({ id: c.id })),
    duel.players[1].hand.slice(0, 2).map(c => ({ id: c.id })),
  ]))
  duel.resolve()
  assert.ok(duel.nextNight())
  const before = experimentalView(duel, 0)
  assert.deepEqual(before.investigations, duel.investigationsFor(0))
  assert.ok(before.investigations.length === 2 && duel.investigationsFor(1).length === 2)
  const foe = duel.players[1]
  ;[foe.hand[0], foe.deck[0]] = [foe.deck[0], foe.hand[0]]
  foe.deck.reverse()
  duel.players[0].deck.reverse()
  // Inject only private state unavailable through the adapter.
  Reflect.set(duel, 'npcPlays', [{ id: foe.hand[0].id, guess: 'merchant' }])
  Reflect.get(duel, 'investigations')[1] = []
  const after = experimentalView(duel, 0)
  assert.deepEqual(before, after)
  assert.ok(!JSON.stringify(after).includes('npcPlays'))
  const a = experimentalStrongNpc(before, random(57))
  assert.deepEqual(a, experimentalStrongNpc(after, random(57)))
  assert.ok(duel.canLock(0, a))
})

test('experimental evidence ignores used cards and positions still in the deck, and decays drawn evidence', () => {
  const base = experimentalView(new Duel(STARTER, STARTER, { twoHumans: true, rng: random(5) }), 0)
  const view = { ...base, night: 5, investigations: [
    { sourceId: 1, night: 4, kind: 'seer', cards: [{ role: 'hunter', status: 'old' }] },
    { sourceId: 2, night: 4, kind: 'prophet', cards: [{ role: 'wolf', status: 'drawn' },
      { role: 'witch', status: 'observed', position: 1 }, { role: 'seer', status: 'used' }] },
  ] } as const
  const evidence = handEvidence(view)
  assert.deepEqual([...evidence.keys()], ['hunter','wolf'])
  assert.ok(evidence.get('wolf')! < 1)
  assert.equal(handEvidence({ ...view, night: 15 }).size, 0)
})
