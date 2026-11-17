import assert from 'node:assert/strict'
import test from 'node:test'
import { STARTER, validDeck, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { cardsForMatch } from '../src/matchDeck.ts'
import { applyCommand, gameView, newRoom } from '../src/onlineProtocol.ts'
import { random } from '../scripts/balance.ts'

const raids = new Set<Role>(['wolf', 'dire', 'fox'])
const composition = (cards: Role[]) => [...cards].sort().join(',')
function assertRandomDeck(cards: Role[]) {
  assert.equal(cards.length, 20)
  assert.ok(validDeck(cards))
  assert.ok(cards.filter(role => raids.has(role)).length >= 3)
}

test('NPC home start and immediate rematch each draw separately for both random seats', () => {
  const rng = random(18)
  const start = () => {
    const player = cardsForMatch([], 'random', rng)
    const npc = cardsForMatch([], 'random', rng)
    return { player, npc, duel: new Duel(player, npc, { rng }) }
  }
  const first = start()
  const second = start()
  const decks = [first.player, first.npc, second.player, second.npc]
  decks.forEach(assertRandomDeck)
  assert.equal(new Set(decks.map(composition)).size, 4)
  for (const match of [first, second]) {
    assert.equal(match.duel.night, 1)
    const stored = match.duel.deckComposition(0)
    const choice = match.duel.players[0].hand.find(card => card.role !== 'assassin')!
    assert.ok(match.duel.lock([{ id: choice.id }]))
    match.duel.resolve()
    assert.deepEqual(match.duel.deckComposition(0), stored)
  }
})

test('fixed presets and saved or edited cards remain snapshots without a draw', () => {
  const noRandom = () => assert.fail('Non-random match deck consumed RNG')
  const copy = cardsForMatch(STARTER, undefined, noRandom)
  assert.deepEqual(copy, STARTER)
  assert.notEqual(copy, STARTER)
})

test('online rooms keep their registered random decks across ready, replay and reconnect', () => {
  const rng = random(27)
  const word = () => Math.floor(rng() * 2 ** 32)
  const create = () => newRoom(cardsForMatch([], 'random', rng))
  const room = create()
  const other = create()
  const guest = cardsForMatch([], 'random', rng)
  for (const deck of [room.decks[0]!, other.decks[0]!, guest]) assertRandomDeck(deck)
  assert.notEqual(composition(room.decks[0]!), composition(other.decks[0]!))
  applyCommand(room, 1, { kind: 'deck', cards: guest }, true, word)
  const registered = structuredClone(room.decks)
  applyCommand(room, 1, { kind: 'ready' }, true, word)
  applyCommand(room, 1, { kind: 'ready' }, true, word)
  applyCommand(room, 0, { kind: 'ready' }, true, word)
  const restored = JSON.parse(JSON.stringify(room)) as typeof room
  assert.deepEqual(restored.decks, registered)
  assert.deepEqual(gameView(restored, 1), gameView(room, 1))
  assert.throws(() => applyCommand(restored, 1, { kind: 'deck', cards: other.decks[0]! }, true, word))
})
