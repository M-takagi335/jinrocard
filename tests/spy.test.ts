import assert from 'node:assert/strict'
import test from 'node:test'
import { card, ROLES, type Role } from '../src/cards.ts'
import { chooseNpc, Duel, type Side } from '../src/duel.ts'
import { applyCommand, gameView, newRoom, replay } from '../src/onlineProtocol.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { chooseStrongestNpc, nextSampledZones } from '../src/strongestNpc.ts'

const deck = (opening: Role[]) => [...opening, ...ROLES.filter(role => !opening.includes(role))].slice(0, 20)
const first = deck(['spy', 'spy', 'jester', 'knight', 'hunter'])
const second = deck(['wolf', 'wolf', 'hunter', 'mad', 'cat'])
const seed = () => 0xffffffff
const rng = () => seed() / 0x100000000
const plays = (duel: Duel, side: Side, roles: Role[]) => {
  const hand = [...duel.players[side].hand]
  return roles.map(role => {
    const index = hand.findIndex(entry => entry.role === role)
    assert.notEqual(index, -1)
    return { id: hand.splice(index, 1)[0].id }
  })
}

for (const [name, ours, theirs, draws] of [
  ['single attack', ['spy'], ['wolf'], 1],
  ['two attacks', ['spy'], ['wolf','wolf'], 1],
  ['no attack', ['spy'], ['hunter'], 0],
  ['two Spies', ['spy','spy'], ['wolf'], 2],
  ['cancelled Spy', ['knight','spy'], ['mad'], 0],
  ['revealed attack without damage', ['hunter','spy'], ['wolf'], 1],
  ['attack category without a raid', ['spy'], ['cat'], 1],
  ['Jester without attack', ['jester'], ['hunter'], 1],
  ['Jester against attack', ['jester'], ['wolf'], 0],
] as const) {
  test('Spy draw and attack category: '+name, () => {
    const duel = new Duel(first,second,{twoHumans:true,rng})
    const before = duel.players[0].hand.length
    const logStart = duel.log.length
    assert.ok(duel.lockBoth([plays(duel,0,[...ours]),plays(duel,1,[...theirs])]))
    duel.resolve()
    while (duel.prompt) assert.ok(duel.answer(duel.prompt.options[0].id))
    assert.equal(duel.log.slice(logStart).filter(e=>e.text==='プレイヤーは2枚引いた。').length, draws)
    assert.equal(duel.players[0].hand.length, Math.min(7,before-ours.length+2*draws))
    if(name==='cancelled Spy') assert.ok(duel.revealed[0].find(c=>c.role==='spy')?.disabled)
  })
}

test('Spy draw and night-end refill stay distinct, and draws recycle discard', () => {
  for(const target of [0,1]){
    const duel = new Duel(first,second,{twoHumans:true,rng})
    const player=duel.players[0]
    player.discard.push(...player.deck.splice(0),...player.hand.splice(target+1))
    const start=duel.log.length
    assert.ok(duel.lockBoth([plays(duel,0,['spy']),plays(duel,1,[target===0?'hunter':'wolf'])]))
    duel.resolve()
    assert.equal(duel.phase,'end')
    assert.equal(player.hand.length,target===0?2:3)
    const texts=duel.log.slice(start).map(e=>e.text)
    assert.ok(texts.includes('プレイヤーは捨て札をシャッフルして山札に戻した。'))
    assert.equal(texts.includes('プレイヤーは夜終了時に手札を2枚補充した。'),target===0)
    assert.equal(texts.includes('プレイヤーは2枚引いた。'),target===1)
  }
})

test('online replays keep the Spy draw and card instance IDs pinned to their starting rules', () => {
  assert.equal(card('spy').limit,2)
  const room=newRoom(first)
  applyCommand(room,1,{kind:'deck',cards:second},true,seed)
  applyCommand(room,0,{kind:'ready'},true,seed)
  applyCommand(room,1,{kind:'ready'},true,seed)
  assert.equal(room.version,5)
  for(const version of [1,2,3,4] as const){
    const saved={...structuredClone(room),version}
    const direct=new Duel(first,second,{twoHumans:true,rng,legacySpy:version<4})
    const pair=[plays(direct,0,['spy']),plays(direct,1,['wolf'])] as const
    const before=gameView(saved,1)!
    applyCommand(saved,0,{kind:'lock',night:1,plays:pair[0]},true,seed)
    assert.deepEqual(gameView(saved,1),{...before,locked:[true,false]})
    applyCommand(saved,1,{kind:'lock',night:1,plays:pair[1]},true,seed)
    assert.ok(direct.lockBoth([...pair]))
    direct.resolve()
    const restored=JSON.parse(JSON.stringify(saved))
    assert.deepEqual(gameView(restored,0)!.hand,direct.players[0].hand)
    assert.deepEqual(gameView(restored,1)!.players,gameView(saved,0)!.players)
    assert.equal(replay(restored).players[0].hand.length,version===4?7:6)
    for(const side of [0,1] as const) applyCommand(restored,side,{kind:'next',night:1},true,seed)
    assert.equal(gameView(restored,0)!.night,2)
  }
})

test('standard, strong and strongest policies submit legal hands with the new Spy value', () => {
  const duel=new Duel(first,second,{twoHumans:true,rng})
  const view=duel.strongNpcView(0)
  assert.equal(card('spy').power,2)
  for(const choose of [chooseNpc,chooseStrongNpc,chooseStrongestNpc]){
    const game=new Duel(first,second,{twoHumans:true,rng})
    const chosen=choose({...view,investigations:[]},rng)
    assert.ok(game.lockBoth([chosen,plays(game,1,['wolf'])]))
    game.resolve()
    while(game.prompt) assert.ok(game.answer(game.prompt.options[0].id))
    assert.equal(game.phase,'end')
  }
})

test('strongest projects both Spy draws before the next night starts', () => {
  const spy = [{ role: 'spy' as const }]
  const hand = (opponent: Role) => nextSampledZones(
    { hand: ['knight','hunter'], deck: ['wolf','fox','witch'], discard: [] },
    spy, spy, [{ role: opponent }], 20, 2, rng,
  ).hand
  assert.deepEqual(hand('wolf'), ['knight','hunter','wolf','fox','witch'])
  assert.deepEqual(hand('hunter'), ['knight','hunter','wolf'])
})
