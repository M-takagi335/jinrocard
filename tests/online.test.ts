import assert from 'node:assert/strict'
import test from 'node:test'
import { STARTER, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { applyCommand, gameView, newRoom, parseCommand, replay } from '../src/onlineProtocol.ts'
import { random } from '../scripts/balance.ts'

const wordSource = (seed: number) => {
  const rng = random(seed)
  return () => Math.floor(rng() * 0x100000000)
}
function started(first: Role[] = STARTER, second: Role[] = STARTER, seed = 11) {
  const word = wordSource(seed)
  const room = newRoom(first)
  assert.throws(() => applyCommand(room, 0, { kind: 'ready' }, false, word))
  applyCommand(room, 1, { kind: 'deck', cards: second }, true, word)
  applyCommand(room, 1, { kind: 'ready' }, true, word)
  applyCommand(room, 0, { kind: 'ready' }, true, word)
  return { room, word }
}

test('online validates decks and redacts locks, IDs, private cards and entropy across reloads', () => {
  assert.throws(() => newRoom(Array(20).fill('wolf')))
  assert.throws(() => parseCommand({ kind: 'deck', cards: STARTER.slice(1) }))
  assert.throws(() => parseCommand({ kind: 'setHp', hp: 100 }))
  const { room, word } = started()
  const a = gameView(room, 0)!, b = gameView(room, 1)!
  assert.equal(a.hand.length, 6)
  assert.equal(b.hand.length, 6)
  assert.ok(a.hand.every(card => !b.hand.some(enemy => enemy.id === card.id)))
  const card = a.hand.find(card => card.role !== 'assassin')!
  assert.throws(() => applyCommand(room, 0, { kind: 'lock', night: 1, plays: [{ id: b.hand[0].id }] }, true, word))
  assert.throws(() => applyCommand(room, 0, { kind: 'lock', night: 2, plays: [{ id: card.id }] }, true, word))
  applyCommand(room, 0, { kind: 'lock', night: 1, plays: [{ id: card.id }] }, true, word)
  assert.throws(() => applyCommand(room, 0, { kind: 'lock', night: 1, plays: [{ id: card.id }] }, true, word))
  assert.deepEqual(gameView(JSON.parse(JSON.stringify(room)), 1), { ...b, locked: [true, false] })
  assert.equal(room.events.length, 0)
  const other = b.hand.find(card => card.role !== 'assassin')!
  applyCommand(room, 1, { kind: 'lock', night: 1, plays: [{ id: other.id }] }, true, word)
  assert.equal(room.events.length, 1)
  assert.equal(gameView(room, 1)!.revealed[0][0].role, card.role)
  assert.equal('id' in gameView(room, 1)!.revealed[0][0], false)
  assert.equal('hand' in gameView(room, 1)!.players[0], false)
  assert.equal('deck' in gameView(room, 1)!.players[0], false)
  assert.equal('tape' in gameView(room, 1)!, false)
  assert.throws(() => applyCommand(room, 0, { kind: 'deck', cards: STARTER }, true, word))
})

test('seer and prophet records and private log entries reach only the player that used them', () => {
  const infoDeck: Role[] = ['seer','seer','prophet','prophet','hunter','hunter','hunter','knight','knight','witch',
    'witch','trap','trap','cat','cat','mason','mason','keeper','keeper','medium']
  for (const kind of ['seer', 'prophet'] as const) {
    let seed = 0
    for (;;) {
      assert.ok(++seed < 200)
      const { room, word } = started(infoDeck, infoDeck, seed)
      const entry = gameView(room, 1)!.hand.find(card => card.role === kind)
      const passive = gameView(room, 0)!.hand.find(card => card.role === 'hunter' || card.role === 'knight')
      if (!entry || !passive) continue
      applyCommand(room, 1, { kind: 'lock', night: 1, plays: [{ id: entry.id }] }, true, word)
      applyCommand(room, 0, { kind: 'lock', night: 1, plays: [{ id: passive.id }] }, true, word)
      assert.equal(gameView(room, 1)!.investigations[0].kind, kind)
      assert.deepEqual(gameView(room, 0)!.investigations, [])
      assert.equal(gameView(room, 1)!.log.some(event => event.text.includes('が確認：')), true)
      assert.equal(gameView(room, 0)!.log.some(event => event.text.includes('が確認：')), false)
      break
    }
  }
})

test('the other seat cannot see an assassin prediction before both submissions', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { room, word } = started(STARTER, STARTER, seed)
    const assassin = gameView(room, 0)!.hand.find(card => card.role === 'assassin')
    if (!assassin) continue
    const before = gameView(room, 1)!
    const guess = before.players[1].remaining[0].role
    applyCommand(room, 0, { kind: 'lock', night: 1, plays: [{ id: assassin.id, guess }] }, true, word)
    assert.deepEqual(gameView(room, 1), { ...before, locked: [true, false] })
    return
  }
  assert.fail('No assassin among the fixed test hands')
})

const passive: Role[] = ['hunter','hunter','hunter','knight','knight','witch','witch','trap','trap','seer',
  'seer','prophet','prophet','spy','spy','jester','jester','mason','mason','medium']
const offense: Role[] = ['wolf','wolf','wolf','dire','dire','fox','fox','cat','cat','assassin','assassin',
  'hunter','hunter','hunter','witch','witch','mason','mason','medium','keeper']

test('both human seats can resolve private prompts, finish night 15 and draw', () => {
  const { room, word } = started(passive, passive)
  let steps = 0
  let promptedSecond = false
  while (room.phase === 'playing') {
    assert.ok(++steps < 250)
    const game = replay(room)
    if (game.phase === 'choice') {
      const { side, options } = game.prompt!
      const step = room.events.length
      promptedSecond ||= side === 1
      assert.equal(gameView(room, (1 - side) as 0 | 1)!.prompt, null)
      assert.throws(() => applyCommand(room, side, { kind: 'answer', night: game.night, step: step - 1, id: options[0].id }, true, word))
      applyCommand(room, side, { kind: 'answer', night: game.night, step, id: options[0].id }, true, word)
    } else if (game.phase === 'select') {
      for (const side of [0, 1] as const) {
        const hand = game.players[side].hand
        const choice = hand.find(card => card.role === 'mason') ?? hand[0]
        applyCommand(room, side, { kind: 'lock', night: game.night, plays: choice ? [{ id: choice.id }] : [] }, true, word)
      }
    } else {
      applyCommand(room, 0, { kind: 'next', night: game.night }, true, word)
      assert.equal(gameView(room, 1)!.night, game.night)
      applyCommand(room, 1, { kind: 'next', night: game.night }, true, word)
    }
  }
  assert.equal(promptedSecond, true)
  assert.equal(gameView(room, 0)!.night, 15)
  assert.equal(gameView(room, 1)!.winner, 'draw')
})

test('online stops at HP zero and explicit departure ends a different match', () => {
  const { room, word } = started(offense, passive, 74)
  let iterations = 0
  const raids = new Set<Role>(['wolf', 'fox', 'dire'])
  while (room.phase === 'playing') {
    assert.ok(++iterations < 250)
    const duel = replay(room)
    if (duel.phase === 'select') {
      const first = duel.players[0].hand.filter(card => raids.has(card.role)).slice(0, duel.max(0))
      if (!first.length) first.push(duel.players[0].hand.find(card => card.role !== 'assassin') ?? duel.players[0].hand[0])
      const second = duel.players[1].hand.find(card => !['witch','hunter','knight','trap'].includes(card.role)) ?? duel.players[1].hand[0]
      applyCommand(room, 0, { kind: 'lock', night: duel.night, plays: first.filter(Boolean).map(card => ({
        id: card.id, guess: card.role === 'assassin' ? duel.remainingComposition(1)[0].role : undefined,
      })) }, true, word)
      applyCommand(room, 1, { kind: 'lock', night: duel.night, plays: second ? [{ id: second.id }] : [] }, true, word)
    } else if (duel.prompt) {
      applyCommand(room, duel.prompt.side, { kind: 'answer', night: duel.night, step: room.events.length, id: duel.prompt.options[0].id }, true, word)
    } else {
      applyCommand(room, 0, { kind: 'next', night: duel.night }, true, word)
      applyCommand(room, 1, { kind: 'next', night: duel.night }, true, word)
    }
  }
  assert.equal(gameView(room, 0)!.reason, 'HPが0になった')
  const other = started()
  applyCommand(other.room, 1, { kind: 'leave' }, true)
  assert.equal(gameView(other.room, 0)!.winner, 0)
  assert.equal(gameView(other.room, 0)!.phase, 'finished')
})

test('both NPC modes can finish a match without an online service', () => {
  for (const difficulty of ['standard', 'strong'] as const) {
    const game = new Duel(STARTER, STARTER, { rng: random(5), npcDifficulty: difficulty })
    let steps = 0
    while (game.phase !== 'finished') {
      assert.ok(++steps < 250)
      if (game.phase === 'select') {
        const entry = game.players[0].hand[0]
        const guess = entry?.role === 'assassin' ? game.remainingComposition(1)[0]?.role : undefined
        assert.ok(game.lock(entry ? [{ id: entry.id, guess }] : []))
        game.resolve()
      } else if (game.prompt) assert.ok(game.answer(game.prompt.options[0].id))
      else assert.ok(game.nextNight())
    }
    assert.notEqual(game.winner, null)
  }
})
