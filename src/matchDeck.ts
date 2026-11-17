import type { Role } from './cards.ts'
import { DECK_TYPES, generateDeck, type DeckType } from './generateDeck.ts'

export const generatedMatchHint = '対戦開始時に20枚を抽選'

export function generatedMatchType(id: string): DeckType | undefined {
  return DECK_TYPES.find(type => id === 'quick:' + type)
}

export function cardsForMatch(cards: readonly Role[], type?: DeckType, rng = Math.random): Role[] {
  return type ? generateDeck(type, rng) : [...cards]
}
