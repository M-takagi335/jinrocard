import { ROLES, RULES, STARTER, card, type Role } from './cards.ts'

export type NamedDeck = { name: string; cards: Role[] }
export type SavedDeck = NamedDeck & { id: string }
const storageKey = 'jinro-saved-decks'
export const deckNameLimit = 60

export function deckCardsError(cards: unknown): string | null {
  if (!Array.isArray(cards) || cards.length !== RULES.deckSize) return 'デッキは20枚にしてください。'
  const counts = new Map<Role, number>()
  for (let index = 0; index < cards.length; index++) {
    const role: unknown = cards[index]
    if (!Object.hasOwn(cards, index) || !ROLES.includes(role as Role)) {
      return '不明なカードIDまたは空のカードが含まれています。'
    }
    const id = role as Role
    const count = (counts.get(id) ?? 0) + 1
    if (count > card(id).limit) return card(id).name + 'の投入上限を超えています。'
    counts.set(id, count)
  }
  return null
}

export type MatchDeck = NamedDeck & { id: string; source: '標準' | '編集中' | '保存済み' }

export function matchDecks(draft: Role[], draftName: string, saved: SavedDeck[]): MatchDeck[] {
  return [
    { id: 'standard', source: '標準', name: '標準デッキ', cards: [...STARTER] },
    { id: 'draft', source: '編集中', name: draftName.trim() || '編集中のデッキ', cards: draft },
    ...saved.map(entry => ({ ...entry, source: '保存済み' as const, id: 'saved:' + entry.id })),
  ]
}

function validateDeck(value: unknown): NamedDeck {
  if (!value || typeof value !== 'object' || !('name' in value) || !('cards' in value)) {
    throw new Error('デッキ名とカード一覧を含むJSONを選択してください。')
  }
  const { name, cards } = value
  if (typeof name !== 'string' || !name.trim() || name.trim().length > deckNameLimit) {
    throw new Error('デッキ名は1〜60文字で入力してください。')
  }
  const error = deckCardsError(cards)
  if (error) throw new Error(error)
  return { name: name.trim(), cards: [...cards as Role[]] }
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

function readSavedEntries(storage: Pick<Storage, 'getItem'>): unknown[] {
  const raw: unknown = JSON.parse(storage.getItem(storageKey) ?? '[]')
  if (!Array.isArray(raw)) throw new Error('保存デッキの形式を読み取れませんでした。')
  return raw
}

function readSavedEntry(entry: unknown): SavedDeck {
  if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !entry.id) {
    throw new Error('保存デッキのIDがありません。')
  }
  return { ...validateDeck(entry), id: entry.id }
}

export function inspectSavedDecks(storage: Pick<Storage, 'getItem'>) {
  const decks: SavedDeck[] = []
  const issues: string[] = []
  for (const entry of readSavedEntries(storage)) {
    try {
      const saved = readSavedEntry(entry)
      if (decks.some(deck => deck.id === saved.id)) throw new Error('保存デッキのIDが重複しています。')
      decks.push(saved)
    } catch (failure) {
      const name = entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string'
        ? entry.name.slice(0, deckNameLimit) : '読み込めないデッキ'
      issues.push(name + '：' + (failure instanceof Error ? failure.message : '保存データを読み取れませんでした。'))
    }
  }
  return { decks, issues }
}

export function loadSavedDecks(storage: Pick<Storage, 'getItem'>): SavedDeck[] {
  return inspectSavedDecks(storage).decks
}

export function storeSavedDecks(storage: Pick<Storage, 'getItem' | 'setItem'>, decks: SavedDeck[]) {
  const unreadable = readSavedEntries(storage).filter(entry => {
    try {
      readSavedEntry(entry)
      return false
    } catch {
      return true
    }
  })
  storage.setItem(storageKey, JSON.stringify([...decks, ...unreadable]))
}
