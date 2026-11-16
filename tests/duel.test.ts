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
    const countBeforeRecovery = game.drawPileComposition(0).find(entry => entry.role === recovered.role)?.count ?? 0
    assert.equal(game.answer(recovered.id),true)
    assert.equal((role==='medium'?p.hand.at(-1):p.deck[0])?.id,recovered.id)
    assert.equal(p.discard.length,2)
    if (role === 'keeper') {
      const countBeforeDraw = game.drawPileComposition(0).find(entry => entry.role === recovered.role)?.count ?? 0
      assert.equal(countBeforeDraw, countBeforeRecovery + 1)
      assert.ok(game.nextNight())
      assert.equal(game.players[0].hand.at(-1)?.id, recovered.id)
      const countAfterDraw = game.drawPileComposition(0).find(entry => entry.role === recovered.role)?.count ?? 0
      assert.equal(countAfterDraw, countBeforeDraw - 1)
    }
  }
})
test('seer ignores played cards; prophet does not reorder the deck; logs are private',()=>{
  const {game,play}=rig(['seer','prophet'],['wolf'])
  const expected=game.players[1].deck.map(c=>c.role)
  play()
  const intel=game.log.filter(l=>l.privateTo===0)
  assert.equal(intel.length,2)
  assert.ok(intel[0].text.endsWith('人狼'))
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
        assert.ok(game.lock(chooseNpc({hand:p.hand,hp:p.hp,enemyHp:q.hp,max:game.max(0),noHeal:p.status.noHeal,discard:p.discard,enemyDiscard:q.discard,enemyDeck:game.deckComposition(1),enemyDrawPile:game.drawPileComposition(1)},rng)))
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


test('starting deck composition is public, unique, and independent of hidden zones', () => {
  let view: import('../src/duel.ts').NpcView | undefined
  const game = new Duel(STARTER, NPC_DECK, {
    npc: input => {
      view = input
      return chooseNpc(input, () => 0)
    },
  })
  assert.ok(view)
  assert.deepEqual(view.enemyDeck, game.deckComposition(0))
  assert.deepEqual(view.enemyDrawPile, game.drawPileComposition(0))
  assert.equal(Object.hasOwn(view, 'enemyHand'), false)
  assert.equal(Object.hasOwn(view, 'enemyPlays'), false)
  const entries = game.deckComposition(1)
  assert.deepEqual(entries.find(entry => entry.role === 'wolf'), { role: 'wolf', count: 2 })
  assert.ok(entries.every(entry => Object.keys(entry).length === 2))
  assert.equal(entries.reduce((sum, entry) => sum + entry.count, 0), 20)
  assert.equal(new Set(entries.map(entry => entry.role)).size, entries.length)
  const [enemy] = game.players[1].hand.splice(0, 1)
  game.players[1].discard.push(enemy)
  assert.strictEqual(entries, game.deckComposition(1))
})

test('assassin rejects absent roles and hits once when the opponent reveals two matching cards', () => {
  const { game } = rig(['assassin'], ['wolf', 'wolf'])
  const id = game.players[0].hand[0].id
  assert.equal(game.lock([{ id, guess: 'curse' }]), false)
  assert.deepEqual(game.revealed, [[], []])
  assert.equal(game.lock([{ id, guess: 'wolf' }]), true)
  game.resolve()
  assert.equal(game.players[1].hp, 16)
  assert.equal(game.log.filter(entry => entry.text.includes('的中')).length, 1)
  const pair = rig(['assassin'], ['hunter', 'wolf'])
  pair.play('wolf')
  assert.equal(pair.game.players[1].hp, 16)
})

test('NPC role guesses follow the composition of different opponents', () => {
  for (const role of ['medium', 'jester'] as const) {
    const game = new Duel([role], ['assassin'], {
      rules: { deckSize: 1, opening: 1, finalNight: 1 },
    })
    assert.equal(game.lock([{ id: game.players[0].hand[0].id }]), true)
    assert.equal(game.revealed[1][0].guess, role)
    game.resolve()
    assert.equal(game.players[0].hp, 16)
  }
})

test('playing two repeatedly refills both hands and reuses the discard without duplicating cards', () => {
  const deck: Role[] = ['hunter','hunter','hunter','knight','knight','witch','witch','trap','trap','seer','seer','prophet','prophet','mad','mad','curse','curse','keeper','medium','cat']
  const game = new Duel(deck, deck, {
    rng: () => .99999,
    npc: view => view.hand.slice(0, 2).map(({id}) => ({id})),
  })
  for (let index = 0; index < 14; index++) {
    assert.ok(game.lock(game.players[0].hand.slice(0, 2).map(({id}) => ({id}))))
    game.resolve()
    while (game.prompt) assert.ok(game.answer(game.prompt.options[0].id))
    for (const player of game.players) {
      assert.ok(player.hand.length >= 3)
      const ids = [...player.hand, ...player.deck, ...player.discard].map(({id}) => id)
      assert.equal(new Set(ids).size, 20)
      assert.equal(ids.length, 20)
    }
    assert.ok(game.nextNight())
  }
  assert.ok(game.log.some(entry => entry.text.includes('夜終了時に手札を1枚補充')))
  assert.ok(game.log.some(entry => entry.text.includes('シャッフル')))
  assert.ok(!game.log.some(entry => entry.night === 1 && entry.text.includes('補充')))
})

test('refill is configurable and draws as many as are available after using cards', () => {
  const game = new Duel(['hunter'], ['knight'], {
    rules: { deckSize: 1, handRefill: 5 },
  })
  assert.ok(game.lock([{ id: game.players[0].hand[0].id }]))
  game.resolve()
  assert.deepEqual(game.players.map(player => player.hand.length), [1, 1])
  assert.equal(game.log.filter(entry => entry.text.includes('夜終了時に手札を1枚補充')).length, 2)
})

test('seer investigation stores exactly the sampled roles from the remaining hand, including zero and duplicates in the pool', () => {
  for (const remaining of [0, 1, 2, 3]) {
    const enemy: Role[] = ['hunter', ...(['wolf', 'wolf', 'witch'] as const).slice(0, remaining)]
    const player: Role[] = ['seer', ...(['knight', 'witch', 'mason'] as const).slice(0, remaining)]
    const game = new Duel(player, enemy, {
      rules: { deckSize: enemy.length, opening: enemy.length, handRefill: 0 },
      rng: () => .99999,
      npc: ({ hand }) => [{ id: hand[0].id }],
    })
    const seer = game.players[0].hand[0]
    assert.ok(game.lock([{ id: seer.id }]))
    assert.deepEqual(game.investigationsFor(0), [])
    game.resolve()
    const expected = enemy.slice(1, 2)
    assert.deepEqual(game.investigationsFor(0), [{
      sourceId: seer.id,
      night: 1,
      kind: 'seer',
      cards: expected.map(role => ({ role, status: 'observed' })),
    }])
    assert.ok(game.log.some(entry => entry.privateTo === 0 &&
      entry.text.endsWith(expected.length ? expected.map(role => CARDS[role].name).join(' → ') : '対象なし')))
    const logLength = game.log.length
    game.resolve()
    assert.equal(game.investigationsFor(0).length, 1)
    assert.equal(game.log.length, logLength)
  }
})

test('simultaneous investigations remain private and prophet preserves the engine deck order', () => {
  const { game, play } = rig(['seer', 'prophet'], ['seer'])
  const hand = game.players[1].hand.slice(1, 2).map(c => c.role)
  const deck = game.players[1].deck.slice(0, 3).map(c => c.role)
  const npcSample = game.players[0].hand.slice(2, 3).map(c => c.role)
  play()
  const playerRecords = game.investigationsFor(0)
  assert.deepEqual(playerRecords.map(record => [record.kind, record.cards.map(c => c.role)]), [
    ['seer', hand], ['prophet', deck],
  ])
  assert.deepEqual(game.investigationsFor(1)[0].cards.map(c => c.role), npcSample)
  assert.deepEqual(game.players[1].deck.slice(0, 3).map(c => c.role), deck)
  playerRecords[0].cards.pop()
  assert.equal(game.investigationsFor(0)[0].cards.length, 1)
})

test('public draws age records and only the exact revealed copy is marked used', () => {
  const { game, play } = rig(['seer'], ['hunter'])
  // With the ordered fixture, the two wolves are the first remaining cards.
  play()
  assert.deepEqual(game.investigationsFor(0)[0].cards, [
    { role: 'wolf', status: 'observed' },
  ])
  game.nextNight()
  assert.deepEqual(game.investigationsFor(0)[0].cards.map(c => c.status), ['old'])
  assert.ok(game.lock([{ id: game.players[0].hand[0].id }]))
  assert.deepEqual(game.investigationsFor(0)[0].cards.map(c => c.status), ['used'])
})

test('an NPC draw later in the same night ages the player investigation', () => {
  const { game, play } = rig(['seer'], ['jester'])
  play()
  assert.ok(game.investigationsFor(0)[0].cards.every(c => c.status === 'old'))
  assert.equal(game.investigationsFor(0)[0].night, 1)
})

test('public draw pile counts exclude hands, revealed cards and discard, and update after a reshuffle', () => {
  const roles: Role[] = ['hunter', 'knight', 'witch', 'trap']
  const game = new Duel(roles, roles, {
    rules: { deckSize: 4, opening: 1, handRefill: 0 },
    rng: () => .99999,
    npc: ({ hand }) => [{ id: hand[0].id }],
  })
  const initial = game.deckComposition(1)
  assert.deepEqual(game.drawPileComposition(1), [{ role: 'witch', count: 1 }, { role: 'trap', count: 1 }])
  game.players[1].deck.reverse()
  assert.deepEqual(game.drawPileComposition(1), [{ role: 'witch', count: 1 }, { role: 'trap', count: 1 }])
  game.players[1].deck.reverse()
  for (let night = 1; night <= 3; night++) {
    const before = game.drawPileComposition(1)
    assert.ok(game.lock([{ id: game.players[0].hand[0].id }]))
    assert.deepEqual(game.drawPileComposition(1), before)
    game.resolve()
    assert.deepEqual(game.drawPileComposition(1), before)
    if (night === 3) assert.deepEqual(before, [])
    assert.ok(game.nextNight())
  }
  assert.deepEqual(game.drawPileComposition(1), [{ role: 'knight', count: 1 }, { role: 'witch', count: 1 }])
  assert.deepEqual(game.drawPileComposition(0), game.drawPileComposition(1))
  assert.strictEqual(game.deckComposition(1), initial)
})

test('seer can sample a different remaining role with different randomness', () => {
  const sample = (roll: number) => {
    let rng = .99999
    const game = new Duel(['seer', 'knight', 'witch'], ['hunter', 'wolf', 'witch'], {
      rules: { deckSize: 3, opening: 3, handRefill: 0 },
      rng: () => rng,
      npc: ({ hand }) => [{ id: hand[0].id }],
    })
    assert.ok(game.lock([{ id: game.players[0].hand[0].id }]))
    rng = roll
    game.resolve()
    return game.investigationsFor(0)[0].cards.map(card => card.role)
  }
  assert.deepEqual(sample(.99999), ['wolf'])
  assert.deepEqual(sample(0), ['witch'])
})

test('a disabled seer creates no private log or investigation', () => {
  const { game, play } = rig(['wolf', 'seer'], ['mad'])
  play()
  assert.equal(game.revealed[0][1].disabled, true)
  assert.deepEqual(game.investigationsFor(0), [])
  assert.ok(game.log.every(entry => entry.privateTo !== 0))
})
