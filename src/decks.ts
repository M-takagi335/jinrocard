import { ROLES, RULES, card, validDeck, type Role } from './cards.ts'

export type NamedDeck = { name: string; cards: Role[] }
export type SavedDeck = NamedDeck & { id: string }
const storageKey = 'jinro-saved-decks'
export const deckNameLimit = 60

function validateDeck(value: unknown): NamedDeck {
  if (!value || typeof value !== 'object' || !('name' in value) || !('cards' in value)) {
    throw new Error('デッキ名とカード一覧を含むJSONを選択してください。')
  }
  const { name, cards } = value
  if (typeof name !== 'string' || !name.trim() || name.trim().length > deckNameLimit) {
    throw new Error('デッキ名は1〜60文字で入力してください。')
  }
  if (!Array.isArray(cards) || cards.length !== RULES.deckSize) {
    throw new Error('デッキは20枚にしてください。')
  }
  if (!cards.every(role => ROLES.includes(role))) {
    throw new Error('不明なカードIDが含まれています。')
  }
  if (!validDeck(cards)) {
    const role = ROLES.find(role => cards.filter(entry => entry === role).length > card(role).limit)!
    throw new Error(card(role).name + 'の投入上限を超えています。')
  }
  return { name: name.trim(), cards: [...cards] }
}

export function importDeck(json: string): NamedDeck {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error('JSONの形式を確認してください。')
  }
  return validateDeck(value)
}

export function exportDeck(deck: NamedDeck): string {
  return JSON.stringify(validateDeck(deck), null, 2)
}

export function loadSavedDecks(storage: Pick<Storage, 'getItem'>): SavedDeck[] {
  const raw: unknown = JSON.parse(storage.getItem(storageKey) ?? '[]')
  if (!Array.isArray(raw)) return []
  const decks: SavedDeck[] = []
  for (const entry of raw) {
    if (typeof entry?.id !== 'string' || !entry.id || decks.some(deck => deck.id === entry.id)) continue
    try {
      decks.push({ ...validateDeck(entry), id: entry.id })
    } catch {
      // Skip invalid entries without dropping the rest of the library.
    }
  }
  return decks
}

export function storeSavedDecks(storage: Pick<Storage, 'setItem'>, decks: SavedDeck[]) {
  storage.setItem(storageKey, JSON.stringify(decks))
}
