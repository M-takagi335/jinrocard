import assert from 'node:assert/strict'
import test from 'node:test'
import { card, ROLES, STARTER, validDeck } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { DECK_TYPES, PROFILES, generateDeck, generateDecks } from '../src/generateDeck.ts'
import { cardsForMatch } from '../src/matchDeck.ts'

function seeded(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

test('1,500 complete-random decks meet the raid floor and exercise every role', () => {
  const rng = seeded(415)
  const seen = new Set<string>()
  const signatures = new Set<string>()
  const raids = new Set(['wolf', 'dire', 'fox'])
  const raidMixes = new Set<string>()
  for (let trial = 0; trial < 1500; trial++) {
    const deck = generateDeck('random', rng)
    assert.equal(deck.length, 20)
    assert.ok(validDeck(deck))
    const attacks = deck.filter(role => raids.has(role))
    assert.ok(attacks.length >= 3)
    raidMixes.add(attacks.sort().join(','))
    signatures.add([...deck].sort().join(','))
    deck.forEach(role => seen.add(role))
  }
  assert.ok(signatures.size >= 1490)
  assert.ok(raidMixes.size >= 5)
  assert.deepEqual([...seen].sort(), [...ROLES].sort())
})

test('1,000 samples per deck type preserve composition limits and archetype emphasis', context => {
  const rolesByCategory = (cards: readonly (typeof ROLES)[number][], category: ReturnType<typeof card>['category']) =>
    cards.filter(role => card(role).category === category).length
  const stats = new Map<string, { attack: number; guard: number; intel: number; supply: number; unique: number }>()
  for (const type of DECK_TYPES) {
    const rng = seeded(29)
    const profile = PROFILES[type]
    const signatures = new Set<string>()
    const counts = { attack: 0, guard: 0, intel: 0, supply: 0 }
    for (let trial = 0; trial < 1000; trial++) {
      const deck = generateDeck(type, rng)
      assert.equal(deck.length, 20)
      assert.ok(validDeck(deck), type)
      for (const [category, minimum] of profile.minimums) {
        assert.ok(rolesByCategory(deck, category) >= minimum)
      }
      if (type === 'intel') {
        assert.ok(deck.includes('assassin'))
        assert.ok(deck.includes('seer') || deck.includes('prophet'))
      }
      for (const category of ['attack', 'guard', 'intel', 'supply'] as const) counts[category] += rolesByCategory(deck, category)
      signatures.add([...deck].sort().join(','))
    }
    assert.ok(signatures.size >= 950, type)
    const stat = { attack: counts.attack / 1000, guard: counts.guard / 1000, intel: counts.intel / 1000,
      supply: counts.supply / 1000, unique: signatures.size }
    stats.set(type, stat)
    context.diagnostic(type + ': ' + JSON.stringify(stat))
  }
  const neutral = stats.get('random')!
  assert.ok(stats.get('rush')!.attack > neutral.attack)
  assert.ok(stats.get('defense')!.guard > neutral.guard)
  assert.ok(stats.get('intel')!.intel > neutral.intel)
  assert.ok(stats.get('combo')!.supply > neutral.supply)
  for (let trial = 0; trial < 1000; trial++) assert.deepEqual(cardsForMatch(STARTER), STARTER)
  context.diagnostic('standard: 1 fixed composition')
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
