import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STARTER, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import {
  assassinEvidence, assassinForecast, experimentalStrongNpc, experimentalView, type ExperimentalView,
} from '../scripts/experimentalStrongNpc.ts'
import { random } from '../scripts/balance.ts'

const features = { assassin: true, assassinIntel: true, assassinTiming: true }
const two = STARTER.map(role => role === 'tyrant' ? 'assassin' : role)
const fixture = () => experimentalView(new Duel(two, STARTER, { twoHumans: true, rng: random(27) }), 0)
const wolfProbability = (view: ExperimentalView, intel: boolean) =>
  assassinForecast(view, random(39), intel).find(r => r.role === 'wolf')!.probability
const twoOptions = { enemyRemaining: [{role:'wolf',count:1},{role:'witch',count:1}], enemyHandCount:1, enemyMax:1 } as const

test('assassin estimator uses only prior personal intel and distinguishes known deck positions from drawn cards', () => {
  const view = { ...fixture(), ...twoOptions, night: 5 } as ExperimentalView
  const inspect = (kind: 'seer' | 'prophet', status: 'observed' | 'drawn' | 'unknown' | 'used' | 'old', night = 4) =>
    ({ ...view, investigations: [{
      night, kind, sourceId: 3, cards: [{ role:'wolf', status, position:kind==='prophet' && status === 'observed' ? 1 : undefined }],
    }] }) satisfies ExperimentalView
  const neutral = wolfProbability(view, false)
  assert.equal(wolfProbability(inspect('seer', 'observed', 5), true), neutral)
  assert.ok(wolfProbability(inspect('seer','old'), true) > neutral)
  assert.equal(wolfProbability(inspect('prophet','observed'), true), 0)
  assert.ok(wolfProbability(inspect('prophet','drawn'), true) > neutral)
  assert.equal(wolfProbability(inspect('prophet','unknown'), true), neutral)
  assert.equal(wolfProbability(inspect('prophet','used'), true), neutral)
  assert.equal(assassinEvidence({ ...inspect('seer','old'), night: 15 }).hand.size, 0)
})

test('fixed public scenarios measure HP sensitivity and independent guesses can both be legal', () => {
  const view = { ...fixture(), ...twoOptions, hp: 15, enemyHp: 4, night: 15,
    hand: [{ id: 1, role:'assassin' }, { id: 2, role:'assassin' }],
  } satisfies ExperimentalView
  const plays = experimentalStrongNpc(view, random(42), features)
  assert.equal(plays.length, 2)
  assert.deepEqual(new Set(plays.map(p=>p.guess)), new Set(['wolf','witch']))
  const wide = { ...view, enemyHandCount: 2 } satisfies ExperimentalView
  const expanded = (hp: number) => assassinForecast({ ...wide, enemyHp: hp }, random(39), false)
    .find(x=>x.role==='witch')!.probability
  assert.ok(expanded(4) > expanded(20))
})

test('real engine preserves separate guesses and grants 4 or 8 nominal damage under current rules', () => {
  const front = (deck: Role[], first: Role[]) => {
    const rest = [...deck]
    for (const role of first) rest.splice(rest.indexOf(role), 1)
    return [...first, ...rest]
  }
  for (const second of ['witch','wolf'] as const) {
    const duel = new Duel(front(two,['assassin','assassin']),front(STARTER,['wolf']),{twoHumans:true,rng:()=>.999999})
    const [first, other] = duel.players[0].hand
    assert.ok(duel.lockBoth([[{id:first.id,guess:'wolf'}, {id:other.id,guess:second}], [{id:duel.players[1].hand[0].id}]]))
    duel.resolve()
    assert.deepEqual(duel.revealed[0].map(c=>c.guess), ['wolf',second])
    assert.equal(duel.nightHpChange(1).lost, second === 'wolf' ? 8 : 4)
  }
})

test('timing can hold an assassin for investigation when the forecast is diffuse', () => {
  const candidates: Role[] = ['wolf','witch','trap','cat','mason','curse','spy','seer']
  const view = {
    ...fixture(), night: 5, hp: 14, enemyHp: 16, enemyHandCount: 1, enemyMax: 1,
    enemyRemaining: candidates.map(role => ({ role, count: 1 })),
    hand: [{ id: 1, role: 'assassin' }, { id: 2, role: 'seer' }, { id: 3, role: 'knight' }, { id: 4, role: 'mason' }],
  } satisfies ExperimentalView
  const before = experimentalStrongNpc(view, random(1), { ...features, assassinTiming: false })
  const after = experimentalStrongNpc(view, random(1), features)
  assert.deepEqual(before, [{ id: 1, guess: 'spy' }, { id: 4 }])
  assert.deepEqual(after, [{ id: 2 }, { id: 4 }])
})

test('assassin decisions and forecast are invariant to changes in secret state', () => {
  const duel = new Duel(two, STARTER, { twoHumans:true, rng:random(7) })
  const before = experimentalView(duel,0)
  const [mine, foe] = duel.players
  ;[foe.hand[1],foe.deck[3]] = [foe.deck[3],foe.hand[1]]
  foe.deck.reverse()
  mine.deck.reverse()
  Reflect.set(duel,'npcPlays',[{id:foe.hand[1].id,guess:'wolf'}])
  Reflect.get(duel,'investigations')[1].push({sourceId:8,night:0,kind:'seer',cards:[{...mine.hand[0]}],revision:0})
  const after = experimentalView(duel,0)
  assert.deepEqual(before,after)
  assert.deepEqual(assassinForecast(before,random(42),true),assassinForecast(after,random(42),true))
  const move = experimentalStrongNpc(after,random(42),features)
  assert.deepEqual(move,experimentalStrongNpc(before,random(42),features))
  assert.ok(duel.canLock(0,move))
})
