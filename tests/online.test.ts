import assert from 'node:assert/strict'
import test from 'node:test'
import { ROLES, STARTER, type Role } from '../src/cards.ts'
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

test('online nightly max follows the active Tyrant and survives rehydration only for the affected seat', () => {
  const word = () => 0xffffffff
  const front = (...roles: Role[]) => {
    const deck = [...STARTER]
    for (const role of roles) deck.splice(deck.indexOf(role), 1)
    return [...roles, ...deck]
  }
  for (const disabled of [false, true]) {
    const room = newRoom(front('hunter', 'tyrant', 'witch'))
    const command = (side: 0 | 1, value: Parameters<typeof applyCommand>[2]) => applyCommand(room, side, value, true, word)
    command(1, { kind: 'deck', cards: front('mad', 'hunter', 'witch') })
    command(0, { kind: 'ready' })
    command(1, { kind: 'ready' })
    const play = (side: 0 | 1, ...roles: Role[]) => {
      const view = gameView(room, side)!
      command(side, { kind: 'lock', night: view.night, plays: roles.map(role => ({ id: view.hand.find(c => c.role === role)!.id })) })
    }
    assert.equal(gameView(room, 1)!.max, 2)
    play(0, 'hunter', 'tyrant')
    play(1, disabled ? 'mad' : 'witch')
    assert.equal(gameView(room, 1)!.revealed[0][1].disabled, disabled)
    assert.equal(gameView(room, 1)!.max, 2)
    for (const side of [0, 1] as const) command(side, { kind: 'next', night: 1 })
    const resumed = structuredClone(room)
    assert.equal(gameView(resumed, 0)!.max, 2)
    assert.equal(gameView(resumed, 1)!.max, disabled ? 2 : 1)
    if (!disabled) assert.throws(() => play(1, 'hunter', 'mad'))
    play(0, 'witch')
    play(1, 'hunter')
    for (const side of [0, 1] as const) command(side, { kind: 'next', night: 2 })
    assert.equal(gameView(room, 1)!.max, 2)
  }
})

test('new Curse rules and in-flight legacy rooms both replay with their original timing', () => {
  const deck = (prefix: Role[]) => [...prefix, ...ROLES.filter(role => !prefix.includes(role))].slice(0, 20)
  const first = deck(['curse', 'wolf', 'wolf'])
  const second = deck(['witch', 'witch', 'hunter'])
  const word = () => 0xffffffff
  const room = newRoom(first)
  assert.equal(room.version, 4)
  // A room created earlier but not yet started adopts the current version.
  room.version = 1
  applyCommand(room, 1, { kind: 'deck', cards: second }, true, word)
  applyCommand(room, 0, { kind: 'ready' }, true, word)
  applyCommand(room, 1, { kind: 'ready' }, true, word)
  assert.equal(room.version, 4)
  for (const version of [1, 2, 3, 4] as const) {
    const live = { ...structuredClone(room), version }
    const play = (side: 0 | 1, ...roles: Role[]) => {
      const view = gameView(live, side)!
      const plays = roles.map(role => ({ id: view.hand.find(entry => entry.role === role)!.id }))
      applyCommand(live, side, { kind: 'lock', night: view.night, plays }, true, word)
    }
    const before = gameView(live, 1)!
    play(0, 'curse', 'wolf')
    assert.deepEqual(gameView(live, 1), { ...before, locked: [true, false] })
    play(1, 'witch')
    const firstView = gameView(live, 1)!
    assert.deepEqual(firstView.players[1].hpChange, { lost: 3, gained: version === 1 ? 3 : 0 })
    assert.equal(firstView.revealed[1][0].recoveryBlocked, version === 1 ? undefined : true)
    assert.equal(firstView.revealed[1][0].disabled, false)
    assert.deepEqual(gameView(JSON.parse(JSON.stringify(live)), 1), firstView)
    for (const side of [0, 1] as const) applyCommand(live, side, { kind: 'next', night: 1 }, true, word)
    play(0, 'wolf')
    play(1, 'witch')
    const secondView = gameView(live, 1)!
    assert.deepEqual(secondView.players[1].hpChange, { lost: 3, gained: version === 1 ? 0 : 4 })
    assert.deepEqual(gameView(JSON.parse(JSON.stringify(live)), 1), secondView)
  }
})

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

test('Mason draws two before a private discard, preserves instance IDs on resume and discards exactly once', () => {
  for (const side of [0, 1] as const) {
    const enemy = (1 - side) as 0 | 1
    for (let seed = 1; ; seed++) {
      assert.ok(seed <= 100, 'Expected a fixed hand with a Mason and duplicate roles')
      const { room, word } = started(passive, passive, seed)
      const initial = gameView(room, side)!, opponent = gameView(room, enemy)!
      const mason = initial.hand.find(card => card.role === 'mason')
      const quiet = opponent.hand.find(card => card.role === 'hunter')
      if (!mason || !quiet) continue
      applyCommand(room, side, { kind: 'lock', night: 1, plays: [{ id: mason.id }] }, true, word)
      applyCommand(room, enemy, { kind: 'lock', night: 1, plays: [{ id: quiet.id }] }, true, word)
      const pending = gameView(room, side)!
      assert.equal(pending.phase, 'choice')
      assert.match(pending.prompt!.title, /共有者/)
      assert.equal(pending.hand.length, initial.hand.length + 1)
      assert.equal(pending.hand.filter(card => !initial.hand.some(original => original.id === card.id)).length, 2)
      assert.deepEqual(pending.prompt!.options, pending.hand)
      const option = pending.hand.find((card, i) => pending.hand.some((other, j) => j !== i && other.role === card.role))
      if (!option) continue
      const resumed = JSON.parse(JSON.stringify(room)) as typeof room
      assert.deepEqual(gameView(resumed, side), pending)
      const waiting = gameView(resumed, enemy)!
      assert.equal(waiting.prompt, null)
      assert.equal(waiting.opponentChoosing, true)
      const answer = { kind: 'answer', night: 1, step: pending.prompt!.step, id: option.id } as const
      assert.throws(() => applyCommand(resumed, enemy, answer, true, word))
      assert.throws(() => applyCommand(resumed, side, { ...answer, id: waiting.hand[0].id }, true, word))
      assert.throws(() => applyCommand(resumed, side, { kind: 'next', night: 1 }, true, word))
      applyCommand(resumed, side, answer, true, word)
      const after = gameView(resumed, side)!
      assert.equal(after.phase, 'end')
      assert.deepEqual(after.hand, pending.hand.filter(card => card.id !== option.id))
      assert.equal(replay(resumed).players[side].discard.filter(card => card.id === option.id).length, 1)
      assert.throws(() => applyCommand(resumed, side, answer, true, word))
      applyCommand(resumed, 0, { kind: 'next', night: 1 }, true, word)
      applyCommand(resumed, 1, { kind: 'next', night: 1 }, true, word)
      assert.equal(gameView(resumed, enemy)!.night, 2)
      break
    }
  }
})

test('Medium and Keeper select a discarded instance and move it to the correct zone', () => {
  for (const role of ['medium', 'keeper'] as const) {
    for (let seed = 1; ; seed++) {
      assert.ok(seed <= 100, 'Expected a fixed hand with recovery')
      const { room, word } = started(passive, offense, seed)
      const original = gameView(room, 1)!.hand.find(card => card.role === 'hunter')
      const first = gameView(room, 0)!.hand.find(card => card.role === 'hunter')
      if (!original || !first) continue
      applyCommand(room, 0, { kind: 'lock', night: 1, plays: [{ id: first.id }] }, true, word)
      applyCommand(room, 1, { kind: 'lock', night: 1, plays: [{ id: original.id }] }, true, word)
      applyCommand(room, 0, { kind: 'next', night: 1 }, true, word)
      applyCommand(room, 1, { kind: 'next', night: 1 }, true, word)
      const recovery = gameView(room, 1)!.hand.find(card => card.role === role)
      const second = gameView(room, 0)!.hand.find(card => card.role === 'hunter' || card.role === 'knight')
      if (!recovery || !second) continue
      applyCommand(room, 0, { kind: 'lock', night: 2, plays: [{ id: second.id }] }, true, word)
      applyCommand(room, 1, { kind: 'lock', night: 2, plays: [{ id: recovery.id }] }, true, word)
      const pending = gameView(room, 1)!.prompt!
      assert.deepEqual(pending.options, [original])
      assert.equal(gameView(room, 0)!.prompt, null)
      applyCommand(room, 1, { kind: 'answer', night: 2, step: pending.step, id: original.id }, true, word)
      const player = replay(room).players[1]
      assert.equal(player.discard.some(card => card.id === original.id), false)
      if (role === 'keeper') assert.equal(player.deck[0].id, original.id)
      else assert.ok(player.hand.some(card => card.id === original.id))
      break
    }
  }
})

test('both human seats can resolve private prompts, finish night 15 and draw', () => {
  const { room, word } = started(passive, passive)
  const reported: NonNullable<ReturnType<typeof applyCommand>>[] = []
  const apply = (...args: Parameters<typeof applyCommand>) => {
    const winner = applyCommand(...args)
    if (winner != null) reported.push(winner)
  }
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
      apply(room, side, { kind: 'answer', night: game.night, step, id: options[0].id }, true, word)
    } else if (game.phase === 'select') {
      for (const side of [0, 1] as const) {
        const hand = game.players[side].hand
        const choice = hand.find(card => card.role === 'mason') ?? hand[0]
        apply(room, side, { kind: 'lock', night: game.night, plays: choice ? [{ id: choice.id }] : [] }, true, word)
      }
    } else {
      apply(room, 0, { kind: 'next', night: game.night }, true, word)
      assert.equal(gameView(room, 1)!.night, game.night)
      apply(room, 1, { kind: 'next', night: game.night }, true, word)
    }
  }
  assert.equal(promptedSecond, true)
  assert.equal(gameView(room, 0)!.night, 15)
  assert.equal(gameView(room, 1)!.winner, 'draw')
  assert.deepEqual(reported, ['draw'])
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
  assert.equal(applyCommand(other.room, 1, { kind: 'leave' }, true), undefined)
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

for (const role of ROLES) {
  test(`online replay resolves ${role} consistently for both viewers`, () => {
    // Same production rules and entropy; compare the command replay to a direct engine resolution.
    for (let seed = 1; seed <= 200; seed++) {
      const deck = [...ROLES]
      const { room, word } = started(deck, deck, seed)
      const initial = gameView(room, 0)!
      const enemy = gameView(room, 1)!
      const selected = initial.hand.find(card => card.role === role)
      const reply = enemy.hand.find(card => card.role === (role === 'jester' ? 'seer' : 'wolf'))
      const replyExtra = enemy.hand.find(card => card.role === 'witch')
      if (!selected || !reply || (role === 'mad' && !replyExtra)) continue
      const first = [{ id: selected.id, guess: role === 'assassin' ? reply.role : undefined }]
      const second = [{ id: reply.id }, ...(role === 'mad' && replyExtra ? [{ id: replyExtra.id }] : [])]
      const direct = new Duel(deck, deck, { twoHumans: true, rng: random(seed) })
      assert.ok(direct.lockBoth([first, second]))
      direct.resolve()
      applyCommand(room, 0, parseCommand({ kind: 'lock', night: 1, plays: first }), true, word)
      assert.deepEqual(gameView(room, 1), { ...enemy, locked: [true, false] })
      applyCommand(room, 1, parseCommand({ kind: 'lock', night: 1, plays: second }), true, word)
      while (direct.prompt) {
        const { side, options } = direct.prompt
        const resumed = JSON.parse(JSON.stringify(room))
        const prompt = gameView(resumed, side)!.prompt!
        assert.deepEqual(prompt.options, options)
        assert.equal(gameView(resumed, (1 - side) as 0 | 1)!.prompt, null)
        const id = options[0].id
        assert.ok(direct.answer(id))
        applyCommand(room, side, { kind: 'answer', night: 1, step: prompt.step, id }, true, word)
      }
      const a = gameView(room, 0)!, b = gameView(room, 1)!
      assert.deepEqual(a.revealed, b.revealed)
      assert.equal(a.revealed[0][0].role, role)
      assert.deepEqual(a.players, b.players)
      assert.equal(a.phase, direct.phase)
      for (const side of [0, 1] as const) {
        const current = side === 0 ? a : b
        assert.deepEqual(current.hand, direct.players[side].hand)
        assert.equal(current.players[side].hp, direct.players[side].hp)
        assert.deepEqual(current.players[side].hpChange, direct.nightHpChange(side))
        assert.deepEqual(current.players[side].discard, direct.players[side].discard.map(card => card.role))
        assert.deepEqual(current.investigations, direct.investigationsFor(side))
        assert.equal(current.log.length, direct.log.filter(log => log.privateTo === undefined || log.privateTo === side).length)
      }
      return
    }
    assert.fail('Expected a fixed hand containing the test card and the opposing play')
  })
}
