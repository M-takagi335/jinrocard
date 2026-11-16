import { ROLES, validDeck, type Role } from './cards.ts'
import { Duel, type Play, type Side } from './duel.ts'

export type Command =
  | { kind: 'deck'; cards: Role[] }
  | { kind: 'ready' }
  | { kind: 'lock'; night: number; plays: Play[] }
  | { kind: 'answer'; night: number; step: number; id: number }
  | { kind: 'next'; night: number }
  | { kind: 'leave' }
type Event = [Play[], Play[]] | number | 'next'
type Seats<T> = [T, T]
export type RoomState = {
  version: 1
  phase: 'lobby' | 'playing' | 'finished'
  decks: Seats<Role[] | null>
  ready: Seats<boolean>
  left: Seats<boolean>
  locks: Seats<Play[] | null>
  next: Seats<boolean>
  tape: number[]
  events: Event[]
  receipts: Seats<string[]>
  departure: Side | null
}
export class RoomError extends Error {}
function demand(test: unknown, message: string): asserts test {
  if (!test) throw new RoomError(message)
}
const seats = [0, 1] as const
export function newRoom(cards: Role[]): RoomState {
  demand(validDeck(cards), '有効な20枚のデッキを選んでください。')
  return { version: 1, phase: 'lobby', decks: [[...cards], null], ready: [false, false],
    left: [false, false], locks: [null, null], next: [false, false], tape: [], events: [],
    receipts: [[], []], departure: null }
}
const randomWord = () => crypto.getRandomValues(new Uint32Array(1))[0]
export function replay(room: RoomState, extend = false, word = randomWord): Duel {
  if (room.version !== 1 || !room.decks[0] || !room.decks[1]) throw new Error('Invalid replay')
  let index = 0
  const duel = new Duel(room.decks[0], room.decks[1], { twoHumans: true, rng: () => {
    if (index === room.tape.length && extend) room.tape.push(word())
    const value = room.tape[index++]
    if (value === undefined) throw new Error('Missing randomness')
    return value / 0x100000000
  } })
  for (const event of room.events) {
    if (Array.isArray(event)) {
      if (!duel.lockBoth(event)) throw new Error('Invalid reveal')
      duel.resolve()
    } else if (!(event === 'next' ? duel.nextNight() : duel.answer(event))) throw new Error('Invalid replay operation')
  }
  return duel
}
export function applyCommand(room: RoomState, side: Side, command: Command, joined: boolean, word = randomWord) {
  if (command.kind === 'leave') {
    if (room.left[side]) return
    room.left[side] = true
    if (room.phase === 'playing') {
      room.departure = side
      room.phase = 'finished'
    }
    return
  }
  demand(!room.left.some(Boolean), '相手が退出しました。')
  if (room.phase === 'lobby') {
    if (command.kind === 'deck') {
      demand(validDeck(command.cards), '有効な20枚のデッキを選んでください。')
      room.decks[side] = [...command.cards]
      room.ready[side] = false
      return
    }
    demand(command.kind === 'ready', '準備中のルームです。')
    demand(joined && room.decks[side], '相手の参加と自分のデッキ選択が必要です。')
    room.ready[side] = true
    if (room.ready.every(Boolean)) {
      room.phase = 'playing'
      replay(room, true, word)
    }
    return
  }
  demand(room.phase === 'playing', 'この対戦は終了しました。')
  const duel = replay(room)
  demand('night' in command && command.night === duel.night, '夜が進みました。最新の状態を確認してください。')
  if (command.kind === 'lock') {
    demand(duel.phase === 'select' && room.locks[side] === null, 'すでに確定済みか、選択できる時間ではありません。')
    demand(duel.canLock(side, command.plays), '使用できるカードと予想を確認してください。')
    room.locks[side] = command.plays
    if (room.locks[0] && room.locks[1]) {
      room.events.push([room.locks[0], room.locks[1]])
      room.locks = [null, null]
    }
  } else if (command.kind === 'answer') {
    demand(command.step === room.events.length && duel.prompt?.side === side
      && duel.prompt.options.some(card => card.id === command.id), 'このカードを選択できません。')
    room.events.push(command.id)
  } else if (command.kind === 'next') {
    demand(duel.phase === 'end' && !room.next[side], '夜の結果を更新してください。')
    room.next[side] = true
    if (room.next.every(Boolean)) {
      room.events.push('next')
      room.next = [false, false]
    }
  } else throw new RoomError('対戦開始後にデッキは変更できません。')
  if (replay(room, true, word).phase === 'finished') room.phase = 'finished'
}

export function gameView(room: RoomState, side: Side) {
  if (room.phase === 'lobby') return null
  const duel = replay(room)
  const opponent = (1 - side) as Side
  // Never return the engine or player objects. Only map permitted fields.
  return {
    night: duel.night, max: duel.max(side), hand: duel.players[side].hand.map(({ id, role }) => ({ id, role })),
    players: seats.map(index => ({
      hp: duel.players[index].hp, handCount: duel.players[index].hand.length, deckCount: duel.players[index].deck.length,
      discard: duel.players[index].discard.map(({ role }) => role), initial: duel.deckComposition(index),
      remaining: duel.remainingComposition(index), hpChange: duel.nightHpChange(index),
    })),
    phase: room.phase === 'finished' ? 'finished' : duel.phase,
    winner: room.departure === null ? duel.winner : (1 - room.departure) as Side,
    reason: room.departure === null ? duel.reason : '対戦相手が退出しました。',
    revealed: duel.revealed.map(cards => cards.map(({ role, disabled, guess }) => ({ role, disabled, guess }))),
    investigations: duel.investigationsFor(side),
    log: duel.log.filter(event => event.privateTo === undefined || event.privateTo === side)
      .map(({ night, text }) => ({ night, text: text.replace(/プレイヤー|NPC/g, name => name === 'NPC' ? 'プレイヤーB' : 'プレイヤーA') })),
    locked: room.locks.map(value => value !== null), next: room.next,
    prompt: duel.prompt?.side === side ? { step: room.events.length, title: duel.prompt.title,
      options: duel.prompt.options.map(({ id, role }) => ({ id, role })) } : null,
    opponentChoosing: duel.prompt?.side === opponent,
  }
}

export function parseCommand(input: unknown): Command {
  demand(input && typeof input === 'object', '操作が無効です。')
  const value = input as Record<string, unknown>
  switch (value.kind) {
    case 'deck': demand(Array.isArray(value.cards) && validDeck(value.cards), '有効な20枚のデッキを選んでください。')
      return { kind: 'deck', cards: value.cards as Role[] }
    case 'ready': case 'leave': return { kind: value.kind }
    case 'next': case 'answer': case 'lock': {
      demand(Number.isSafeInteger(value.night), '夜番号が無効です。')
      const night = value.night as number
      if (value.kind === 'next') return { kind: 'next', night }
      if (value.kind === 'answer') {
        demand(Number.isSafeInteger(value.id) && Number.isSafeInteger(value.step), '選択対象が無効です。')
        return { kind: 'answer', night, id: value.id as number, step: value.step as number }
      }
      demand(Array.isArray(value.plays) && value.plays.length <= 2, '最大2枚まで選択できます。')
      const plays = value.plays.map((entry: unknown) => {
        demand(entry && typeof entry === 'object', 'カードが無効です。')
        const { id, guess } = entry as Record<string, unknown>
        demand(Number.isSafeInteger(id) && (guess === undefined || ROLES.includes(guess as Role)), 'カードまたは予想が無効です。')
        return guess === undefined ? { id: id as number } : { id: id as number, guess: guess as Role }
      })
      return { kind: 'lock', night, plays }
    }
    default: throw new RoomError('操作が無効です。')
  }
}

export type OnlineView = {
  id: string; code: string; revision: number; side: Side; joined: boolean
  phase: RoomState['phase']; ready: Seats<boolean>; left: Seats<boolean>; connected: Seats<boolean>
  ownDeck: Role[] | null
  game: ReturnType<typeof gameView>
}
