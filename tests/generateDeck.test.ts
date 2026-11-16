import assert from 'node:assert/strict'
import test from 'node:test'
import { card, validDeck } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { DECK_TYPES, PROFILES, generateDeck, generateDecks } from '../src/generateDeck.ts'

function seeded(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

test('all generator types make valid variable decks and satisfy their minimum categories', () => {
  const rng = seeded(29)
  for (const type of DECK_TYPES) {
    const profile = PROFILES[type]
    if ('preset' in profile) continue
    const signatures = new Set<string>()
    for (let trial = 0; trial < 100; trial++) {
      const deck = generateDeck(type, rng)
      assert.equal(deck.length, 20)
      assert.ok(validDeck(deck), type)
      for (const [category, minimum] of profile.minimums) {
        assert.ok(deck.filter(role => card(role).category === category).length >= minimum)
      }
      signatures.add([...deck].sort().join(','))
    }
    assert.ok(signatures.size > 1, type)
  }
})

test('batches mix selected types, avoid duplicate compositions, and skip used names', () => {
  const rng = seeded(12)
  for (const size of [3, 5, 10] as const) {
    const types = ['rush', 'defense', 'combo'] as const
    const decks = generateDecks(types, size, ['速攻型01'], [], rng)
    assert.equal(decks.length, size)
    assert.equal(decks[0].name, '速攻型02')
    assert.deepEqual(decks.map(deck => deck.type), Array.from({ length: size }, (_, index) => types[index % types.length]))
    const previous = decks.map(deck => [...deck.cards].sort().join(','))
    assert.equal(new Set(previous).size, size)
    const regenerated = generateDecks(types, size, [], decks, rng)
    assert.ok(regenerated.every(deck => validDeck(deck.cards) && !previous.includes([...deck.cards].sort().join(','))))
  }
})

test('invalid randomness or inability to produce unique decks gives a clear error', () => {
  assert.throws(() => generateDeck('balanced', () => NaN), /乱数/)
  assert.throws(() => generateDecks([], 1), /タイプ/)
  assert.throws(() => generateDecks(['random'], 3, [], [], () => 0), /異なる構成/)
})

test('the same generator supplies both sides of an NPC duel', () => {
  const rng = seeded(71)
  for (const type of DECK_TYPES) {
    const deck = generateDeck('balanced', rng)
    const enemy = generateDeck(type, rng)
    const duel = new Duel(deck, enemy, { rng })
    assert.equal(duel.phase, 'select')
    assert.equal(duel.players[0].hand.length, 6)
    const role = duel.deckComposition(1)[0].role
    const [first] = duel.players[0].hand
    assert.ok(duel.lock([{ id: first.id, guess: role }]))
    duel.resolve()
    while (duel.prompt) assert.ok(duel.answer(duel.prompt.options[0].id))
    assert.equal(duel.phase, 'end')
  }
})

test('intel uses the exact tested assassin-support recipe in both single and bulk generation', () => {
  const expected = {
    wolf: 3, assassin: 2, fox: 1, cat: 1, hunter: 1, knight: 2, witch: 2, trap: 2,
    seer: 2, prophet: 2, mad: 1, curse: 1,
  }
  const check = (roles: ReturnType<typeof generateDeck>) => {
    assert.ok(validDeck(roles))
    const counts: Record<string, number> = {}
    for (const role of roles) counts[role] = (counts[role] ?? 0) + 1
    assert.deepEqual(counts, expected)
  }
  check(generateDeck('intel', seeded(111)))
  check(generateDeck('intel', seeded(4)))
  const previous = generateDecks(['intel'], 1)
  const batch = generateDecks(['intel'], 3, ['情報戦型01'], previous)
  assert.deepEqual(batch.map(entry => entry.name), ['情報戦型02', '情報戦型03', '情報戦型04'])
  batch.forEach(entry => check(entry.cards))
  assert.notStrictEqual(batch[0].cards, batch[1].cards)
})
