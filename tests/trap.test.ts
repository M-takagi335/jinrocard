import assert from 'node:assert/strict'
import test from 'node:test'
import { STARTER, ROLES, card, validDeck, type Role } from '../src/cards.ts'
import { Duel, type Side } from '../src/duel.ts'
import { projectNight } from '../src/strongestNpc.ts'
import { applyCommand, gameView, newRoom, replay, requireClientRules } from '../src/onlineProtocol.ts'
import { soundCues } from '../src/soundEvents.ts'
import { hasUnreadHistory, markHistoryRead, releaseHistory } from '../src/releaseHistory.ts'

function opening(first: Role[]) {
  const cards = [...first]
  for (const role of [...STARTER, ...ROLES.flatMap(r => Array<Role>(card(r).limit).fill(r))]) {
    if (cards.length === 20) break
    if (cards.filter(x => x === role).length < card(role).limit) cards.push(role)
  }
  assert.ok(validDeck(cards)); return cards
}
const cases: [string, Role[], Role[], number[], { mad?: number; guess?: Role; hp?: number[]; winner?: Side | 'draw' }?][] = [
 ['罠師2枚・小襲撃',['trap','trap'],['wolf'],[20,16]],
 ['罠師2枚・襲撃10',['trap','trap'],['dire','dire'],[16,12]],
 ['罠師2枚・片方無効',['trap','trap'],['mad','wolf'],[20,18],{mad:0}],
 ['罠師2枚・相手猫又',['trap','trap'],['wolf','cat'],[17,16]],
 ['狩人と罠師',['hunter','trap'],['wolf'],[20,18]],
 ['襲撃なし',['hunter','trap'],['seer'],[20,20]],
 ['特殊だけ',['hunter','trap'],['assassin'],[16,20],{guess:'hunter'}],
 ['狂人が狩人を無効',['hunter','trap'],['mad','dire'],[18,16],{mad:0}],
 ['狂人が罠師を無効',['hunter','trap'],['mad','dire'],[20,18],{mad:.99999}],
 ['自分猫又',['trap','cat'],['dire'],[18,13]],
 ['相手猫又だけ発動',['trap','cat'],['wolf','cat'],[17,18]],
 ['双方猫又',['trap','cat'],['dire','cat'],[15,13]],
 ['HP3で相手猫又',['trap'],['wolf','cat'],[0,18],{hp:[3,20],winner:1}],
 ['双方HP0',['trap','cat'],['dire','cat'],[0,0],{hp:[5,7],winner:'draw'}],
 ['大狼自傷',['dire'],['hunter'],[18,20]],
 ['妖狐HP11',['trap'],['fox'],[20,9],{hp:[20,11]}],
 ['妖狐HP10',['trap'],['fox'],[19,8],{hp:[20,10]}],
 ['騎士と特殊',['trap','knight'],['assassin','wolf'],[18,18],{guess:'trap'}],
 ['騎士と襲撃8',['trap','knight'],['wolf','dire'],[17,16]],
 ['回復前HP0',['trap','witch'],['dire'],[0,16],{hp:[2,20],winner:1}],
 ['回復前HP1',['trap','witch'],['dire'],[5,16],{hp:[3,20]}],
 ['狂人が罠師を無効・襲撃通過',['trap','wolf'],['mad','wolf'],[17,17],{mad:0}],
 ['罠師2枚と暗殺者',['trap','trap'],['assassin'],[16,20],{guess:'trap'}],
 ['罠師2枚の反撃を騎士が軽減',['trap','trap'],['wolf','knight'],[20,18]],
 ['襲撃と特殊を同時防御',['trap'],['wolf','assassin'],[16,18],{guess:'trap'}],
 ['襲撃札そのものが無効',['trap','mad'],['wolf','seer'],[20,20],{mad:0}],
]
for (const [name, ours, theirs, expected, options = {}] of cases) test('new trap: ' + name, () => {
  let resolving = false
  const game = new Duel(opening(ours), opening(theirs), { twoHumans: true, rng: () => resolving ? (options.mad ?? .99999) : .99999 })
  if (options.hp) game.players.forEach((p, i) => p.hp = options.hp![i])
  const before = game.players.map(p => p.hp) as [number, number]
  const plays = [ours, theirs].map((roles, side) => roles.map((role, i) => ({ id: game.players[side].hand[i].id, ...(role === 'assassin' ? { guess: options.guess ?? 'trap' } : {}) })))
  assert.ok(game.lockBoth(plays as [typeof plays[0], typeof plays[0]])); resolving = true; game.resolve()
  while (game.prompt) assert.ok(game.answer(game.prompt.options[0].id))
  assert.deepEqual(game.players.map(p => p.hp), expected)
  if (options.winner !== undefined) assert.equal(game.winner, options.winner)
  const projected = projectNight([ours, theirs].map((row, side) => row.map((role, i) => ({ role, guess: plays[side][i].guess }))) as Parameters<typeof projectNight>[0], before, options.mad === 0 ? [0,0,0,0] : [1,1,1,1])
  assert.deepEqual(projected.hp, expected)
})

test('trap mitigation applies once to total raid, logs actual reduction and triggers defense SE', () => {
  for (const [roles, blocked, hp] of [[['fox'],2,20],[['dire'],3,18],[['wolf','wolf'],3,17]] as [Role[],number,number][]) {
    const game = new Duel(opening(['trap']), opening(roles), {twoHumans:true,rng:()=>.99999})
    assert.ok(game.lockBoth([[{id:game.players[0].hand[0].id}],roles.map((_,i)=>({id:game.players[1].hand[i].id}))]))
    game.resolve()
    assert.equal(game.players[0].hp,hp)
    assert.ok(game.log.some(e=>e.text.includes('襲撃を'+blocked+'軽減')))
    assert.ok(soundCues({night:1,revealed:true,hp:[game.nightHpChange(0),game.nightHpChange(1)],log:game.log}).includes('defense'))
  }
})

test('legacy rooms including waiting lobbies preserve trap rules through replay and reconnect', () => {
  for (const version of [1,2,3,4,5] as const) {
    const room = newRoom(opening(['trap']))
    room.version = version
    const command = (side:Side, cmd:Parameters<typeof applyCommand>[2])=>applyCommand(room,side,cmd,true,()=>0xffffffff)
    command(1,{kind:'deck',cards:opening(['dire'])}); command(0,{kind:'ready'}); command(1,{kind:'ready'})
    assert.equal(room.version,version)
    command(0,{kind:'lock',night:1,plays:[{id:gameView(room,0)!.hand[0].id}]})
    command(1,{kind:'lock',night:1,plays:[{id:gameView(room,1)!.hand[0].id}]})
    const restored = JSON.parse(JSON.stringify(room))
    assert.deepEqual(replay(restored).players.map(p=>p.hp),[version<5?20:18,16])
    assert.deepEqual(gameView(room,0)!.players,gameView(restored,1)!.players)
  }
})

test('old clients can use old rooms but are required to refresh for new rules', () => {
  for (const version of [1,2,3,4]) requireClientRules(undefined,version)
  assert.throws(()=>requireClientRules(undefined,5),/再読み込み/)
  assert.throws(()=>requireClientRules(4,5),/再読み込み/)
  requireClientRules(5,5)
  assert.equal(newRoom(STARTER).version,5)
})

test('history unread state persists, renews for a new ID and tolerates unavailable storage', () => {
  let value: string | null = null
  const storage = {getItem:()=>value,setItem:(_key:string,next:string)=>{value=next}}
  assert.ok(hasUnreadHistory(storage));markHistoryRead(storage);assert.equal(hasUnreadHistory(storage),false)
  value='older-update';assert.ok(hasUnreadHistory(storage))
  assert.ok(hasUnreadHistory({getItem:()=>{throw Error('blocked')}}))
  assert.doesNotThrow(()=>markHistoryRead({setItem:()=>{throw Error('blocked')}}))
  assert.equal(releaseHistory[0].category,'ゲームバランス調整')
})

test('unused trap reduction expires before the following night', () => {
  const game = new Duel(opening(['trap','seer']), opening(['fox','dire']), {twoHumans:true,rng:()=>.99999})
  const play=(a:Role,b:Role)=>{
    assert.ok(game.lockBoth(([a,b] as Role[]).map((role,side)=>[{id:game.players[side].hand.find(c=>c.role===role)!.id}]) as Parameters<Duel['lockBoth']>[0]))
    game.resolve();while(game.prompt)assert.ok(game.answer(game.prompt.options[0].id))
  }
  play('trap','fox');assert.equal(game.players[0].hp,20)
  assert.ok(game.nextNight());play('seer','dire');assert.equal(game.players[0].hp,15)
})

test('partial trap mitigation and retaliation still use HP comparison on the final night', () => {
  const game = new Duel(opening(['trap']),opening(['dire']),{twoHumans:true,rng:()=>.99999})
  game.night=15
  assert.ok(game.lockBoth([[{id:game.players[0].hand[0].id}],[{id:game.players[1].hand[0].id}]]))
  game.resolve()
  assert.deepEqual(game.players.map(p=>p.hp),[18,16]);assert.equal(game.winner,0);assert.equal(game.reason,'第15夜終了')
})
