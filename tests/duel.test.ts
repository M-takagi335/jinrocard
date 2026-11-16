import test from 'node:test'
import assert from 'node:assert/strict'
import { CARDS, ROLES, STARTER, NPC_DECK, validDeck, type Role } from '../src/cards.ts'
import { Duel, chooseNpc, type Side } from '../src/duel.ts'

const full:Role[]=['wolf','wolf','dire','assassin','fox','cat','hunter','knight','witch','trap','seer','prophet','spy','jester','medium','keeper','mason','merchant','mad','tyrant']
function rig(a:Role[],b:Role[],finalNight=15) {
  const plan=(roles:Role[])=>{
    const d=[...full]
    for(const role of roles){assert.ok(d.includes(role));d.splice(d.indexOf(role),1)}
    return [...roles,...d]
  }
  const game=new Duel(plan(a),plan(b),{
    rng:()=>.99999,rules:{finalNight},
    npc:v=>v.hand.slice(0,Math.min(v.max,b.length)).map(c=>({id:c.id,guess:'hunter'}))
  })
  const play=(guess:Role='hunter')=>{
    assert.equal(game.lock(game.players[0].hand.slice(0,a.length).map(c=>({id:c.id,guess}))),true)
    game.resolve()
  }
  return {game,play}
}

test('all 20 roles are defined and both starter decks obey limits',()=>{
  assert.equal(Object.keys(CARDS).length,20)
  assert.equal(validDeck(STARTER),true)
  assert.equal(validDeck(NPC_DECK),true)
  assert.equal(validDeck(Array(20).fill('wolf')),false)
})
test('picks stay hidden before lock; lock validates guesses, amount and unique card IDs',()=>{
  const {game}=rig(['assassin','wolf'],['knight'])
  const [a,b]=game.players[0].hand
  assert.deepEqual(game.revealed,[[],[]])
  assert.equal(game.lock([]),false)
  assert.equal(game.lock([{id:a.id}]),false)
  assert.equal(game.lock([{id:b.id},{id:b.id}]),false)
  assert.equal(game.lock([{id:a.id,guess:'knight'},{id:b.id}]),true)
  assert.equal(game.lock([{id:b.id}]),false)
  assert.deepEqual(game.revealed.map(r=>r.map(c=>c.role)),[['assassin','wolf'],['knight']])
  game.resolve()
  assert.equal(game.players[1].hp,15)
})
test('hunter suppresses stacked raids but not dire wolf recoil or a successful assassin',()=>{
  const A=rig(['wolf','dire'],['hunter'])
  A.play()
  assert.deepEqual(A.game.players.map(p=>p.hp),[18,20])
  const B=rig(['dire','assassin'],['hunter'])
  B.play()
  assert.deepEqual(B.game.players.map(p=>p.hp),[18,16])
})
test('trap retaliation is reduced by knight; cat does not trigger if attack is fully blocked',()=>{
  const A=rig(['wolf','knight'],['trap'])
  A.play()
  assert.deepEqual(A.game.players.map(p=>p.hp),[20,20])
  const B=rig(['hunter','cat'],['wolf'])
  B.play()
  assert.deepEqual(B.game.players.map(p=>p.hp),[20,20])
  const C=rig(['cat','knight'],['wolf'])
  C.play()
  assert.deepEqual(C.game.players.map(p=>p.hp),[19,17])
})
test('simultaneous lethal attacks draw and witch cannot revive',()=>{
  const {game,play}=rig(['wolf','witch'],['wolf'])
  game.players[0].hp=3;game.players[1].hp=3
  play()
  assert.equal(game.winner,'draw')
  assert.deepEqual(game.players.map(p=>p.hp),[0,0])
  assert.deepEqual(game.players.map(p=>p.discard.length),[2,1])
})
test('dire wolf recoil cannot trigger the same side cat; merchant pays after healing and can lose',()=>{
  const A=rig(['dire','cat'],['hunter'])
  A.play()
  assert.deepEqual(A.game.players.map(p=>p.hp),[18,20])
  const B=rig(['merchant'],['hunter'])
  B.game.players[0].hp=2
  B.play()
  assert.equal(B.game.winner,1)
  assert.equal(B.game.players[0].hand.length,5)
  const C=rig(['merchant','witch'],['hunter'])
  C.game.players[0].hp=2
  C.play()
  assert.equal(C.game.players[0].hp,4)
})
test('mad cancels a deterministic target and does nothing against a single card',()=>{
  const A=rig(['mad'],['wolf','dire'])
  A.play()
  assert.deepEqual(A.game.players.map(p=>p.hp),[17,20])
  assert.equal(A.game.revealed[1][1].disabled,true)
  const B=rig(['mad'],['wolf'])
  B.play()
  assert.equal(B.game.players[0].hp,17)
})
test('next night status limits NPC selection and blocks healing, then expires',()=>{
  const {game,play}=rig(['tyrant'],['witch','wolf'])
  // A curse can be in either player's deck; replace its instance for this fixture.
  game.players[0].hand[1].role='curse'
  assert.equal(game.lock(game.players[0].hand.slice(0,2).map(c=>({id:c.id}))),true)
  game.resolve()
  assert.equal(game.max(1),2)
  game.nextNight()
  assert.equal(game.max(1),1)
  assert.equal(game.players[1].status.noHeal,true)
  game.players[1].hp=12
  game.players[1].hand[0].role='witch'
  play()
  assert.equal(game.players[1].hp,9)
  assert.ok(game.log.some(l=>l.text.includes('回復は呪術師に無効化')))
  game.nextNight()
  assert.equal(game.max(1),2)
  assert.equal(game.players[1].status.noHeal,false)
})
test('recovery excludes currently played cards and preserves instance identity',()=>{
  for(const role of ['medium','keeper'] as const){
    const {game,play}=rig([role,'wolf'],['hunter'])
    const p=game.players[0], recovered=p.deck.shift()!
    p.discard.push(recovered)
    play()
    assert.deepEqual(game.prompt?.options.map(c=>c.id),[recovered.id])
    assert.equal(game.answer(game.revealed[0][1].id),false)
    assert.equal(game.answer(recovered.id),true)
    assert.equal((role==='medium'?p.hand.at(-1):p.deck[0])?.id,recovered.id)
    assert.equal(p.discard.length,2)
  }
})
test('seer ignores played cards; prophet does not reorder the deck; logs are private',()=>{
  const {game,play}=rig(['seer','prophet'],['wolf'])
  const expected=game.players[1].deck.map(c=>c.role)
  play()
  const intel=game.log.filter(l=>l.privateTo===0)
  assert.equal(intel.length,2)
  assert.ok(intel[0].text.includes('大狼'))
  assert.deepEqual(game.players[1].deck.map(c=>c.role),expected)
})
test('mason discard is explicit, overflow is handled, empty deck recycles only discard',()=>{
  const {game,play}=rig(['mason'],['hunter'])
  const p=game.players[0]
  p.discard.push(...p.deck.splice(0))
  play()
  assert.match(game.prompt!.title,/共有者/)
  assert.equal(game.answer(game.prompt!.options[0].id),true)
  assert.equal(p.hand.length,6)
  assert.equal(p.discard.length,2)
  assert.ok(game.log.some(x=>x.text.includes('シャッフル')))
  const capped=new Duel(STARTER,NPC_DECK,{rules:{opening:7}})
  assert.equal(capped.phase,'choice')
  assert.equal(capped.answer(capped.prompt!.options[0].id),true)
  assert.equal(capped.phase,'select')
  assert.deepEqual(capped.players.map(p=>p.hand.length),[7,7])
})
test('final night resolves before comparing HP; equal HP is a draw',()=>{
  const A=rig(['wolf'],['witch'],1)
  A.game.players[1].hp=18
  A.play()
  assert.equal(A.game.players[1].hp,19)
  assert.equal(A.game.winner,0)
  const B=rig(['wolf'],['witch'],1)
  B.play()
  assert.equal(B.game.winner,'draw')
})
test('50 full NPC-style matches never duplicate or lose card instances',()=>{
  for(let seed=1;seed<=50;seed++){
    let n=seed
    const rng=()=>((n=Math.imul(1664525,n)+1013904223>>>0)/2**32)
    const game=new Duel(STARTER,NPC_DECK,{rng})
    for(let actions=0;game.phase!=='finished';actions++){
      assert.ok(actions<500)
      if(game.phase==='choice') assert.ok(game.answer(game.prompt!.options[0].id))
      else if(game.phase==='select'){
        const [p,q]=game.players
        assert.ok(game.lock(chooseNpc({hand:p.hand,hp:p.hp,enemyHp:q.hp,max:game.max(0),noHeal:p.status.noHeal,discard:p.discard,enemyDiscard:q.discard},rng)))
      }else if(game.phase==='reveal') game.resolve()
      else assert.ok(game.nextNight())
      for(const i of [0,1] as Side[]){
        const p=game.players[i]
        const live=[...p.hand,...p.deck,...p.discard]
        const ids=new Set(live.map(c=>c.id))
        assert.equal(live.length,ids.size)
        assert.equal(new Set([...ids,...game.revealed[i].map(c=>c.id)]).size,20)
        assert.ok(p.hp>=0&&p.hp<=20)
        if(['select','end','finished'].includes(game.phase))assert.equal(ids.size,20)
      }
    }
    assert.ok(game.night<=15)
  }
})


test('fox checks HP at attack start and an incorrect assassin guess does no damage',()=>{
  const A=rig(['fox','dire'],['knight'])
  A.game.players[0].hp=11
  A.play()
  assert.deepEqual(A.game.players.map(p=>p.hp),[9,15])
  const B=rig(['fox','assassin'],['knight'])
  B.game.players[0].hp=10
  B.play()
  assert.deepEqual(B.game.players.map(p=>p.hp),[10,18])
})
test('conditional draws use the revealed attack category',()=>{
  const A=rig(['spy','jester'],['cat'])
  A.play()
  assert.equal(A.game.players[0].hand.length,5)
  const B=rig(['spy','jester'],['witch'])
  B.play()
  assert.equal(B.game.players[0].hand.length,6)
})
test('an empty hand is the only valid pass',()=>{
  const game=new Duel([],[],{rules:{deckSize:0,finalNight:1}})
  assert.equal(game.lock([]),true)
  game.resolve()
  assert.equal(game.winner,'draw')
})
