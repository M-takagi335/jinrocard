import assert from 'node:assert/strict'
import test from 'node:test'
import type { Role } from '../src/cards.ts'
import { canConfirmTutorial, createTutorialDuel, lockTutorialNight } from '../src/tutorial.ts'

function guidedRun() {
  const duel = createTutorialDuel()
  const play = (...roles: Role[]) => roles.map(role => ({ id: duel.players[0].hand.find(card => card.role === role)!.id }))
  assert.deepEqual(duel.players.map(player => player.hp), [20, 20])
  assert.equal(duel.players[0].hand.length, 6)
  assert.equal(canConfirmTutorial(duel, play('hunter')), false)
  assert.ok(lockTutorialNight(duel, play('wolf')))
  assert.equal(duel.phase, 'reveal')
  assert.deepEqual(duel.revealed.map(row => row.map(card => card.role)), [['wolf'], ['wolf']])
  assert.deepEqual(duel.players.map(player => player.hp), [20, 20])
  duel.resolve()
  assert.deepEqual(duel.players.map(player => player.hp), [17, 17])
  assert.deepEqual([duel.nightHpChange(0), duel.nightHpChange(1)], [{ lost: 3, gained: 0 }, { lost: 3, gained: 0 }])
  const handSize = duel.players[0].hand.length
  assert.ok(duel.nextNight())
  assert.equal(duel.players[0].hand.length, handSize + 1)
  assert.ok(lockTutorialNight(duel, play('hunter')))
  duel.resolve()
  assert.deepEqual(duel.nightHpChange(0), { lost: 0, gained: 0 })
  assert.match(duel.log.map(entry => entry.text).join('\n'), /狩人が襲撃を防いだ/)
  assert.ok(duel.nextNight())
  assert.equal(canConfirmTutorial(duel, play('witch')), false)
  assert.ok(lockTutorialNight(duel, play('witch', 'wolf')))
  duel.resolve()
  assert.deepEqual(duel.nightHpChange(0), { lost: 3, gained: 4 })
  assert.deepEqual(duel.players.map(player => player.hp), [18, 14])
  assert.ok(duel.nextNight())
  assert.ok(lockTutorialNight(duel, play('seer')))
  duel.resolve()
  assert.equal(duel.investigationsFor(0)[0].cards.length, 1)
  assert.deepEqual(duel.investigationsFor(1), [])
  assert.ok(duel.nextNight())
  return duel
}

test('tutorial lessons resolve through the regular rules and can start fresh', () => {
  const duel = guidedRun()
  assert.equal(duel.night, 5)
  assert.deepEqual(createTutorialDuel().players.map(player => player.hp), [20, 20])
})

test('every one- or two-card hand choice can finish the free tutorial night', () => {
  const size = guidedRun().players[0].hand.length
  for (let first = 0; first < size; first++) {
    for (let second = first; second < size; second++) {
      const duel = guidedRun()
      const ids = first === second ? [first] : [first, second]
      assert.ok(lockTutorialNight(duel, ids.map(index => ({ id: duel.players[0].hand[index].id }))))
      duel.resolve()
      assert.equal(duel.phase, 'end')
      assert.equal(duel.prompt, null)
    }
  }
})

test('tutorial HP totals include counterattack and recoil separately by fighter', () => {
  const duel = guidedRun()
  const plays = duel.players[0].hand.filter(card => card.role === 'trap' || card.role === 'dire')
    .map(({ id }) => ({ id }))
  assert.equal(plays.length, 2)
  assert.ok(lockTutorialNight(duel, plays))
  duel.resolve()
  assert.deepEqual(duel.nightHpChange(0), { lost: 2, gained: 0 })
  assert.deepEqual(duel.nightHpChange(1), { lost: 7, gained: 0 })
  assert.deepEqual(duel.players.map(player => player.hp), [16, 7])
})

test('the tutorial engine records only the actual healing up to 20 HP', () => {
  const duel = createTutorialDuel()
  const witch = duel.players[0].hand.find(card => card.role === 'witch')!
  const hunter = duel.players[1].hand.find(card => card.role === 'hunter')!
  duel.players[0].hp = 18
  assert.ok(duel.lockBoth([[{ id: witch.id }], [{ id: hunter.id }]]))
  duel.resolve()
  assert.equal(duel.players[0].hp, 20)
  assert.deepEqual(duel.nightHpChange(0), { lost: 0, gained: 2 })
})
