import { ROLES, RULES, type Role } from './cards.ts'
import { Duel, type Play } from './duel.ts'

const playerOpening: Role[] = ['wolf', 'hunter', 'witch', 'seer', 'fox', 'knight', 'wolf', 'trap', 'cat', 'dire']
const opponentPlays: readonly Role[] = ['wolf', 'wolf', 'wolf', 'hunter', 'fox']
const guide: readonly (readonly Role[])[] = [['wolf'], ['hunter'], ['witch', 'wolf'], ['seer']]

function tutorialDeck(opening: readonly Role[]): Role[] {
  return [...opening, ...ROLES.filter(role => !opening.includes(role))].slice(0, RULES.deckSize)
}

export function createTutorialDuel() {
  // Fisher–Yates selects the current index at each step, leaving the lesson decks in draw order.
  return new Duel(tutorialDeck(playerOpening), tutorialDeck(opponentPlays), { twoHumans: true, rng: () => 0.9999 })
}

export function guidedRoles(night: number): readonly Role[] | undefined {
  return guide[night - 1]
}

export function canConfirmTutorial(duel: Duel, plays: Play[]) {
  const required = guidedRoles(duel.night)
  if (duel.phase !== 'select' || !duel.canLock(0, plays)) return false
  return !required || plays.length === required.length && required.every(role =>
    plays.some(play => duel.players[0].hand.find(card => card.id === play.id)?.role === role))
}

export function lockTutorialNight(duel: Duel, plays: Play[]) {
  if (!canConfirmTutorial(duel, plays)) return false
  const opponentCard = duel.players[1].hand.find(card => card.role === opponentPlays[duel.night - 1])
  return !!opponentCard && duel.lockBoth([plays, [{ id: opponentCard.id }]])
}
