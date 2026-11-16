import test from 'node:test'
import assert from 'node:assert/strict'
import { NPC_DECK, STARTER, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { deckCardsError, exportDeck, importDeck, inspectSavedDecks, loadSavedDecks, matchDecks, storeSavedDecks } from '../src/decks.ts'

test('saved decks survive loading, and exported JSON round trips without an internal ID', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  const decks = [
    { id: 'a', name: '月夜の狩人', cards: [...STARTER] },
    { id: 'b', name: '月夜の狩人のコピー', cards: [...STARTER] },
  ]
  storeSavedDecks(storage, decks)
  const restored = loadSavedDecks(storage)
  assert.deepEqual(restored, decks)
  assert.deepEqual(importDeck(exportDeck(restored[0])), { name: decks[0].name, cards: decks[0].cards })
})

test('import rejects invalid IDs, counts, and copy limits', () => {
  const json = (cards: string[]) => JSON.stringify({ name: '月夜の狩人', cards })
  assert.throws(() => importDeck(json(['unknown', ...STARTER.slice(1)])), /カードID/)
  assert.throws(() => importDeck(json(STARTER.slice(1))), /20枚/)
  assert.throws(() => importDeck(json([...STARTER.slice(0, -1), 'wolf'])), /投入上限/)
})

test('a standalone standard deck can start even when the only draft is empty', () => {
  const options = matchDecks([], '', [])
  assert.deepEqual(options.map(deck => deck.id), ['standard', 'draft'])
  assert.equal(deckCardsError(options[1].cards), 'デッキは20枚にしてください。')
  assert.equal(deckCardsError(options[0].cards), null)
  const duel = new Duel(options[0].cards, NPC_DECK)
  assert.equal(duel.night, 1)
  assert.equal(duel.players[0].hand.length, 6)
  assert.equal(duel.phase, 'select')
})

test('a saved deck retains distinct identity and the exact cards shown in preparation', () => {
  const cards: Role[] = [...STARTER.slice(1), 'prophet']
  const options = matchDecks(STARTER, '', [{ id: 'standard', name: '手作りデッキ', cards }])
  const selected = options.find(entry => entry.id === 'saved:standard')!
  assert.equal(selected.source, '保存済み')
  assert.equal(deckCardsError(selected.cards), null)
  const duel = new Duel(selected.cards, NPC_DECK)
  assert.deepEqual(duel.deckComposition(0).find(entry => entry.role === 'prophet'), { role: 'prophet', count: 1 })
  assert.equal(duel.deckComposition(0).reduce((sum, entry) => sum + entry.count, 0), 20)
})

test('unavailable older entries have reasons and stay in storage alongside usable decks', () => {
  const old = { id: 'old', name: '以前のデッキ', cards: [...STARTER.slice(0, 19), null] }
  const good = { id: 'good', name: '保存済み', cards: [...STARTER] }
  let raw = JSON.stringify([old, good])
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
  assert.deepEqual(inspectSavedDecks(storage).decks, [good])
  assert.match(inspectSavedDecks(storage).issues[0], /以前のデッキ.*不明なカードID/)
  assert.match(deckCardsError(new Array(20))!, /空のカード/)
  storeSavedDecks(storage, [{ ...good, name: '更新後' }])
  assert.ok(JSON.parse(raw).some((entry: { id: string }) => entry.id === 'old'))
  assert.equal(inspectSavedDecks(storage).decks[0].name, '更新後')

  raw = '{壊れたデータ'
  assert.throws(() => storeSavedDecks(storage, []))
  assert.equal(raw, '{壊れたデータ')
})
