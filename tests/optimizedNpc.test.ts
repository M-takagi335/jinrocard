import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STARTER, validDeck, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import {
  experimentalStrongNpc, experimentalView, nextNightPayoff, nextSampledZones, type Features,
} from '../scripts/experimentalStrongNpc.ts'
import { random } from '../scripts/balance.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { requestOptimizedNpc, runOptimizedNpc } from '../scripts/optimizedNpcWorker.ts'

const flags = { assassin: true, assassinIntel: true, lookahead: true, accurateFuture: true, fast: true } satisfies Features

test('forecast of final night ranks official wins over ties and ties over losses', () => {
  const start: [number,number] = [10,14]
  const terminal = (hp: [number,number]) => nextNightPayoff(hp,start,.8,true)
  assert.ok(terminal([10,9]) > terminal([15,15]))
  assert.ok(terminal([15,15]) > terminal([20,21]))
  assert.ok(terminal([1,0]) > 0)
  assert.equal(terminal([0,0]),0)
  assert.ok(terminal([0,1]) < 0)
})

function fixture(active: Role[], opposing: Role[], hand: Role[], deck: Role[], discard: Role[]) {
  const mine = [...active, ...hand, ...deck, ...discard]
  const rest = [...STARTER]
  for (const role of mine) {
    const i=rest.indexOf(role)
    if(i>=0)rest.splice(i,1)
  }
  const start=[...mine,...rest].slice(0,20)
  assert.ok(validDeck(start))
  const foe=[...opposing,...STARTER.filter(r=>!opposing.includes(r))]
  while(foe.length<20) foe.push('prophet')
  assert.ok(validDeck(foe))
  const game=new Duel(start,foe,{twoHumans:true,rng:()=>.999999})
  const p=game.players[0], all=[...p.hand,...p.deck]
  // Exact known positions exist only in this test fixture.
  p.hand=all.slice(0,active.length+hand.length)
  p.deck=all.slice(p.hand.length,p.hand.length+deck.length)
  p.discard=all.slice(p.hand.length+deck.length,p.hand.length+deck.length+discard.length)
  return game
}

test('sampled dawn agrees with engine order for draw, shared discard, recovery, and deck-top return', () => {
  for(const [active,enemy,hand,deck,discard] of [
    [['merchant','mason'],['witch'],['cat','hunter'],['wolf','wolf','knight','trap','seer','medium','dire'],[]],
    [['keeper','spy'],['wolf'],['hunter','cat'],['trap','witch','knight'],['dire']],
    [['medium','jester'],['witch'],['hunter'],['trap','witch','knight','wolf'],['dire']],
    [['merchant'],['witch'],[],[],['wolf']],
    [['hunter'],['witch'],[],['wolf','knight','witch'],[]],
  ] as Role[][][]) {
    const duel=fixture(active,enemy,hand,deck,discard)
    const actions=active.map(role=>({role}))
    const expected=nextSampledZones({hand:[...hand],deck:[...deck],discard:[...discard]},
      actions,actions,enemy.map(role=>({role})),19,2,()=>.999999)
    assert.deepEqual([...expected.hand,...expected.deck,...expected.discard].sort(),
      [...hand,...deck,...discard,...active].sort())
    assert.ok(duel.lockBoth([
      duel.players[0].hand.slice(0,active.length).map(c=>({id:c.id})),
      duel.players[1].hand.slice(0,enemy.length).map(c=>({id:c.id})),
    ]))
    const answer=()=>{
      const { title, options }=duel.prompt!
      const chosen=title.includes('回収')?options[0]:options.find(c=>c.role==='seer')??options.find(c=>c.role==='medium')??options[0]
      assert.ok(duel.answer(chosen.id))
    }
    duel.resolve()
    while(duel.prompt)answer()
    assert.ok(duel.nextNight())
    while(duel.prompt)answer()
    const actual=duel.players[0]
    assert.deepEqual(actual.hand.map(c=>c.role),expected.hand,active.join('+'))
    assert.deepEqual(actual.deck.map(c=>c.role),expected.deck)
    assert.deepEqual(actual.discard.map(c=>c.role).sort(),expected.discard.sort())
  }
})

test('optimized decisions and hypothetical draws ignore actual hidden orders and opponent private records', () => {
  const duel=new Duel(STARTER,STARTER,{twoHumans:true,rng:random(261)})
  const before=experimentalView(duel,0), enemy=duel.players[1]
  ;[enemy.hand[0],enemy.deck[0]]=[enemy.deck[0],enemy.hand[0]]
  enemy.deck.reverse()
  duel.players[0].deck.reverse()
  Reflect.set(duel,'npcPlays',[{id:enemy.hand[0].id,guess:'witch'}])
  Reflect.get(duel,'investigations')[1].push({sourceId:1,night:0,kind:'seer',cards:[duel.players[0].hand[0]],revision:0})
  const after=experimentalView(duel,0)
  assert.deepEqual(before,after)
  const selected=experimentalStrongNpc(before,random(17),flags)
  assert.deepEqual(selected,experimentalStrongNpc(after,random(17),flags))
  assert.ok(duel.canLock(0,selected))
})

test('experimental worker selects legal cards and failed startup or timeout falls back', async () => {
  const duel = new Duel(STARTER,STARTER,{twoHumans:true,rng:random(31)})
  const request = { view: experimentalView(duel,0), seed: 9 }
  assert.ok(duel.canLock(0,runOptimizedNpc(request)))
  const expected = chooseStrongNpc(request.view,random(request.seed))
  assert.deepEqual(await requestOptimizedNpc(request,() => { throw Error('worker unavailable') }),expected)
  let terminated = false
  const stalled = { postMessage() {}, terminate() { terminated = true } }
  assert.deepEqual(await requestOptimizedNpc(request,() => stalled as unknown as Worker,1),expected)
  assert.equal(terminated,true)
})
