import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RULES, STARTER, validDeck, type Role } from '../src/cards.ts'
import { Duel, type Side } from '../src/duel.ts'
import { experimentalStrongNpc, experimentalView, projectNight } from '../scripts/experimentalStrongNpc.ts'
import { random } from '../scripts/balance.ts'

function fixture(left: Role[], right: Role[], finalNight = RULES.finalNight as number) {
  const prepare = (prefix: Role[]) => {
    const rest = [...STARTER]
    for (const role of prefix) {
      const index = rest.indexOf(role)
      if (index >= 0) rest.splice(index, 1)
      else rest.pop()
    }
    const deck = [...prefix, ...rest]
    assert.ok(validDeck(deck))
    return deck
  }
  return new Duel(prepare(left), prepare(right), {
    twoHumans: true, rng: () => .99999, rules: { finalNight },
  })
}

test('lookahead projection matches real recovery, combat, draw counts and an active tyrant', () => {
  for (const [left, right, hp] of [
    [['merchant','witch'], ['curse','tyrant'], [10,20]],
    [['wolf','cat'], ['trap','knight'], [16,16]],
    [['assassin','hunter'], ['mad','dire'], [14,13]],
  ] as [[Role,Role],[Role,Role],[number,number]][]) {
    const duel = fixture(left, right)
    const actions = [left,right].map((roles,side) => roles.map(role => ({
      role, guess: role === 'assassin' ? (side ? left[0] : right[0]) : undefined,
    })))
    const [a,b] = [0,1].map(side => duel.players[side].hand.slice(0,2)
      .map((c,i) => ({id:c.id,guess:actions[side][i].guess})))
    for (const i of [0,1] as const) duel.players[i].hp=hp[i]
    const before = duel.players.map(p=>p.deck.length)
    const result = projectNight([actions[0],actions[1]], hp, [1,1,1,1])
    assert.ok(duel.lockBoth([a,b]))
    duel.resolve()
    assert.deepEqual(duel.players.map(p=>p.hp),result.hp)
    assert.deepEqual(duel.players.map((p,i)=>before[i]-p.deck.length),result.supplies)
    assert.equal(duel.phase,'end')
    assert.ok(duel.nextNight())
    while (duel.prompt) assert.ok(duel.answer(duel.prompt.options[0].id))
    for (const i of [0,1] as const) {
      const view = experimentalView(duel,i)
      assert.equal(view.max,result.active[1-i].some(c=>c.role==='tyrant')?1:2)
      const after = Math.min(RULES.handLimit, Math.max(RULES.handRefill, 4 + result.supplies[i]) + RULES.nightlyDraw)
      assert.equal(view.hand.length,after)
      assert.ok(duel.canLock(i,experimentalStrongNpc(view,random(48),{
        assassin:true,assassinIntel:true,lookahead:true,
      })))
    }
  }
})

test('both final candidates use the same final-night objective without reservation', () => {
  const duel = fixture(['assassin','knight'], ['wolf'], 1)
  const moves = ([0,1] as Side[]).map(side => {
    const view = experimentalView(duel,side)
    const settings = { assassin:true, assassinIntel:true, lookahead:true }
    const first = experimentalStrongNpc(view,random(19),{...settings,assassinTiming:true})
    assert.deepEqual(first,experimentalStrongNpc(view,random(19),settings))
    return first
  })
  assert.ok(duel.lockBoth([moves[0],moves[1]]))
  duel.resolve()
  while (duel.phase==='choice') assert.ok(duel.answer(duel.prompt!.options[0].id))
  assert.equal(duel.phase,'finished')
  const [a,b]=duel.players.map(p=>p.hp)
  assert.equal(duel.winner,a===b?'draw':a>b?0:1)
})
