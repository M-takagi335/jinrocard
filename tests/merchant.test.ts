import assert from 'node:assert/strict'
import test from 'node:test'
import { ROLES, type Role } from '../src/cards.ts'
import { Duel, chooseNpc } from '../src/duel.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { applyCommand, gameView, newRoom } from '../src/onlineProtocol.ts'
import { soundCues } from '../src/soundEvents.ts'

const deck = (opening: Role[]) => [...opening, ...ROLES.filter(role => !opening.includes(role))].slice(0, 20)
function duel(first: Role[], second: Role[]) {
  return new Duel(deck(first), deck(second), { twoHumans: true, rng: () => .9999 })
}
const pick = (game: Duel, side: 0 | 1, role: Role) => ({ id: game.players[side].hand.find(c => c.role === role)!.id })
function settle(game: Duel) {
  game.resolve()
  while (game.prompt) assert.ok(game.answer(game.prompt.options[0].id))
}

test('Merchant pays one per copy and draws three per copy before enforcing the hand limit', () => {
  for (const copies of [1,2]) {
    const game = duel(['merchant','merchant','knight'], ['hunter'])
    game.players[0].hp = copies + 1
    if (copies === 2) {
      const player = game.players[0]
      player.discard.push(...player.deck.splice(1))
    }
    const plays = game.players[0].hand.filter(c => c.role === 'merchant').slice(0,copies).map(({id})=>({id}))
    assert.ok(game.lockBoth([plays, [pick(game,1,'hunter')]]))
    settle(game)
    assert.equal(game.players[0].hp, 1)
    assert.deepEqual(game.nightHpChange(0), { lost: copies, gained: 0 })
    assert.equal(game.log.filter(e => e.text === 'プレイヤーは3枚引いた。').length, copies)
    assert.equal(game.players[0].hand.length, 7)
    if (copies === 2) assert.ok(game.log.some(e => e.text.includes('捨て札をシャッフル')))
    const player = game.players[0]
    assert.equal(new Set([...player.hand,...player.deck,...player.discard].map(c=>c.id)).size, 20)
  }
})

test('Mad cancels both Merchant cost and draw, while Knight never shields the payment', () => {
  const cancelled = duel(['knight','merchant'], ['mad'])
  assert.ok(cancelled.lockBoth([[pick(cancelled,0,'knight'),pick(cancelled,0,'merchant')], [pick(cancelled,1,'mad')]]))
  settle(cancelled)
  assert.equal(cancelled.revealed[0][1].disabled,true)
  assert.deepEqual(cancelled.nightHpChange(0), { lost:0,gained:0 })
  assert.equal(cancelled.log.some(e=>e.text==='プレイヤーは3枚引いた。'),false)
  const protectedGame = duel(['merchant','knight'], ['wolf'])
  assert.ok(protectedGame.lockBoth([[pick(protectedGame,0,'merchant'),pick(protectedGame,0,'knight')],[pick(protectedGame,1,'wolf')]]))
  settle(protectedGame)
  assert.deepEqual(protectedGame.nightHpChange(0), { lost:2,gained:0 })
  assert.ok(protectedGame.log.some(e=>e.text.includes('商人でHPを1失った')))
})

test('a Merchant recovered by Medium pays one HP again and draws three cards', () => {
  const game = duel(['merchant','medium'], ['hunter','hunter','hunter'])
  const merchant = pick(game,0,'merchant')
  assert.ok(game.lockBoth([[merchant],[pick(game,1,'hunter')]]))
  game.resolve()
  const trim = () => {
    while(game.prompt) assert.ok(game.answer(game.prompt.options.find(c=>c.role!=='merchant' && c.role!=='medium')!.id))
  }
  trim()
  assert.ok(game.nextNight())
  trim()
  assert.ok(game.lockBoth([[pick(game,0,'medium')],[pick(game,1,'hunter')]]))
  game.resolve()
  assert.ok(game.answer(merchant.id))
  trim()
  assert.ok(game.nextNight())
  trim()
  assert.ok(game.lockBoth([[merchant],[pick(game,1,'hunter')]]))
  settle(game)
  assert.equal(game.players[0].hp,18)
  assert.deepEqual(game.nightHpChange(0), { lost:1,gained:0 })
  assert.equal(game.log.filter(e=>e.text==='プレイヤーは3枚引いた。').length,2)
})

test('NPCs use the new cost and avoid a guaranteed lethal double payment', () => {
  const game = duel(['merchant','merchant'], ['hunter'])
  const base = game.strongNpcView(0)
  const hand = base.hand.filter(c => c.role === 'merchant')
  for (const choose of [chooseNpc, chooseStrongNpc]) {
    const move = choose({ ...base, hand, hp: 2, enemyHp: 20, enemyMax: 1,
      enemyRemaining: [{ role:'hunter',count:1 }], enemyHandCount:1 }, () => .5)
    assert.equal(move.length,1)
    assert.ok(hand.some(c=>c.id===move[0].id))
  }
  const one = { ...base, hand: [hand[0], { id: 99, role:'seer' as const }], max: 1 }
  function first(value: number) {
    let draw = 0
    return chooseNpc({ ...one, hp:value }, () => draw++ ? 0 : .9)[0].id
  }
  assert.equal(first(1),99)
  assert.equal(first(2),hand[0].id)
})

test('online replay preserves the Merchant cost of each started rules version', () => {
  const host = deck(['merchant','merchant'])
  const guest = deck(['hunter'])
  const room = newRoom(host)
  const word = () => 0xffffffff
  applyCommand(room,1,{kind:'deck',cards:guest},true,word)
  applyCommand(room,0,{kind:'ready'},true,word)
  applyCommand(room,1,{kind:'ready'},true,word)
  assert.equal(room.version,3)
  for (const version of [1,2,3] as const) {
    const live = { ...structuredClone(room), version }
    const ours = gameView(live,0)!
    const theirs = gameView(live,1)!
    const plays = ours.hand.filter(c=>c.role==='merchant').map(({id})=>({id}))
    applyCommand(live,0,{kind:'lock',night:1,plays},true,word)
    assert.deepEqual(gameView(live,1),{...theirs,locked:[true,false]})
    applyCommand(live,1,{kind:'lock',night:1,plays:[{id:theirs.hand[0].id}]},true,word)
    let current = gameView(live,0)!
    while (current.prompt) {
      applyCommand(live,0,{kind:'answer',night:1,step:current.prompt.step,id:current.prompt.options[0].id},true,word)
      current = gameView(live,0)!
    }
    const lost = version === 3 ? 2 : 4
    assert.deepEqual(current.players[0].hpChange,{lost,gained:0})
    assert.equal(current.players[0].hp,20-lost)
    assert.equal(current.log.filter(e=>e.text==='プレイヤーAは3枚引いた。').length,2)
    const restored = JSON.parse(JSON.stringify(live))
    assert.deepEqual(gameView(restored,0),current)
    assert.deepEqual(gameView(restored,1)!.players,current.players)
    assert.deepEqual(soundCues({ night: current.night, revealed: true, log: current.log,
      hp: current.players.map(player=>player.hpChange) }), ['night','reveal','special'])
    for (const side of [0,1] as const) applyCommand(restored,side,{kind:'next',night:1},true,word)
    assert.deepEqual(gameView(restored,0)!.players[0].hpChange,{lost:0,gained:0})
  }
})
