import test from 'node:test'
import assert from 'node:assert/strict'
import { STARTER } from '../src/cards.ts'
import { exportDeck, importDeck, loadSavedDecks, storeSavedDecks } from '../src/decks.ts'

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
