import assert from 'node:assert/strict'
import test from 'node:test'
import { RULES, STARTER, type Role } from '../src/cards.ts'
import { chooseEasyNpc, chooseNpc, Duel, type NpcView } from '../src/duel.ts'
import { NPC_DIFFICULTIES } from '../src/strongNpc.ts'
import { random } from '../scripts/balance.ts'

function view(roles: Role[], hp = 20): NpcView {
  return { hand: roles.map((role, id) => ({ id, role })), hp, enemyHp: 20, max: 2,
    noHeal: false, discard: [], enemyDiscard: [], enemyDeck: [], enemyRemaining: [{ role: 'hunter', count: 2 }] }
}

function sequence(...values: number[]) {
  return () => {
    const value = values.shift()
    assert.notEqual(value, undefined, 'Unexpected RNG consumption')
    return value!
  }
}

test('difficulty selection orders Easy first without changing the Duel default', () => {
  assert.deepEqual(Object.values(NPC_DIFFICULTIES), ['やさしい','標準','強い','最強'])
  assert.equal(new Duel(STARTER, STARTER, { rng: random(15) }).npcDifficulty, 'standard')
})

test('Easy uses the measured D penalties for attacks, Hunter, Trap and Knight', () => {
  for (const [role, competitor, lower, higher] of [
    ['wolf', 'seer', .21, .23],
    ['hunter', 'seer', .14, .16],
    ['trap', 'seer', .14, .16],
    ['knight', 'merchant', .11, .13],
  ] as const) {
    const input = { ...view([role, competitor]), max: 1 }
    assert.deepEqual(chooseEasyNpc(input, sequence(0,lower,.99)), [{ id: 0 }])
    assert.deepEqual(chooseEasyNpc(input, sequence(0,higher,.99)), [{ id: 1 }])
    assert.deepEqual(chooseNpc(input, sequence(0,higher,.99)), [{ id: 0 }])
  }
})

test('Easy and standard retain distinct 46% and 74% two-card thresholds', () => {
  const input = view(['witch','seer'], 16)
  for (const [policy, threshold] of [[chooseEasyNpc,.46],[chooseNpc,.74]] as const) {
    assert.equal(policy(input, sequence(0,0,threshold-.0001)).length, 2)
    assert.equal(policy(input, sequence(0,0,threshold)).length, 1)
    assert.equal(policy({ ...input, max: 1 }, sequence(0,0,0)).length, 1)
  }
})

test('Easy uses legal Assassin predictions, avoids optional lethal costs and keeps healing', () => {
  assert.deepEqual(chooseEasyNpc(view(['assassin']), sequence(0,0)), [{ id: 0, guess: 'hunter' }])
  assert.deepEqual(chooseEasyNpc({ ...view(['assassin']), enemyRemaining: [] }, sequence(0)), [{ id: 0 }])
  assert.deepEqual(chooseEasyNpc(view(['dire','merchant','witch'], 2), sequence(0,0,0)), [{ id: 2 }])
  assert.deepEqual(chooseEasyNpc(view(['merchant','merchant'], 2), sequence(.9,.9,0)), [{ id: 0 }])
})

test('Easy choices are identical after rearranging private opponent cards', () => {
  const duel = new Duel(STARTER,STARTER,{rng:random(17),npcDifficulty:'easy'})
  const before = duel.strongNpcView(1)
  const opponent = duel.players[0]
  const index = opponent.deck.findIndex(c => c.role !== opponent.hand[0].role)
  assert.notEqual(index,-1)
  const first = opponent.hand[0]
  opponent.hand[0] = opponent.deck[index]
  opponent.deck[index] = first
  opponent.deck.reverse()
  assert.deepEqual(duel.strongNpcView(1),before)
  assert.deepEqual(chooseEasyNpc(duel.strongNpcView(1),random(73)),chooseEasyNpc(before,random(73)))
})

test('Easy uses D throughout a 15-night NPC battle, including Tyrant and recycling', () => {
  const cards: Role[] = ['tyrant','hunter','hunter','hunter','knight','knight','witch','witch','trap','trap','seer',
    'seer','prophet','prophet','spy','spy','jester','jester','medium','medium']
  const rng = () => .9999
  const easy = new Duel(cards,cards,{npcDifficulty:'easy',rng})
  const direct = new Duel(cards,cards,{npc:view=>chooseEasyNpc(view,rng),rng})
  for (let night=1; night<=RULES.finalNight; night++) {
    for (const game of [easy,direct]) {
      if (night===2) assert.equal(game.max(1),1)
      const hand=game.players[0].hand
      const pick=night===1?hand.find(c=>c.role==='tyrant'):hand[0]
      assert.ok(game.lock(pick?[{id:pick.id}]:[]))
      if (night===2) assert.equal(game.revealed[1].length,1)
      game.resolve()
      while (game.prompt) assert.ok(game.answer(game.prompt.options[0].id))
      assert.ok(game.players.every(p=>p.hand.length<=RULES.handLimit))
      if (night<RULES.finalNight) assert.ok(game.nextNight())
    }
    assert.deepEqual(easy.revealed,direct.revealed)
    assert.deepEqual(easy.log,direct.log)
  }
  assert.equal(easy.winner,'draw')
  assert.ok(easy.log.some(e=>e.text.includes('捨て札をシャッフルして山札に戻した')))
})
