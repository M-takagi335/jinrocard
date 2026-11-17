import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STARTER, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'
import { chooseStrongestNpc, strongestRandom } from '../src/strongestNpc.ts'
import { requestStrongestNpc, type StrongestRequest } from '../src/strongestNpcClient.ts'

test('strongest rejects pending, illegal, stale and duplicate plays before simultaneous reveal', () => {
  const duel = new Duel(STARTER, STARTER, { npcDifficulty: 'strongest', rng: strongestRandom(77) })
  const view = duel.strongestNpcView()!
  const mine = [{ id: duel.players[0].hand.find(c => c.role !== 'assassin')!.id }]
  const enemy = chooseStrongestNpc(view, strongestRandom(11))
  assert.equal(duel.lock(mine), false)
  assert.equal(duel.prepareNpc(2, enemy), false)
  assert.equal(duel.prepareNpc(1, mine), false)
  assert.ok(duel.prepareNpc(1, enemy))
  assert.equal(duel.prepareNpc(1, enemy), false)
  assert.equal(duel.strongestNpcView(), undefined)
  assert.deepEqual(duel.revealed, [[], []])
  assert.ok(duel.lock(mine))
  assert.equal(duel.phase, 'reveal')
  assert.deepEqual(duel.revealed[1].map(c => c.id), enemy.map(c => c.id))
})

test('official strongest snapshot and decisions are identical when only hidden state changes', () => {
  const duel = new Duel(STARTER, STARTER, { npcDifficulty: 'strongest', rng: strongestRandom(7) })
  const before = duel.strongestNpcView()!
  const player = duel.players[0]
  ;[player.hand[0], player.deck[0]] = [player.deck[0], player.hand[0]]
  player.deck.reverse()
  duel.players[1].deck.reverse()
  Reflect.set(duel, 'npcPlays', [{ id: player.hand[0].id, guess: 'wolf' }])
  Reflect.get(duel, 'investigations')[0].push({ sourceId: 2, night: 0, kind: 'seer', cards: [duel.players[1].hand[0]], revision: 0 })
  const after = duel.strongestNpcView()!
  assert.deepEqual(before, after)
  assert.deepEqual(chooseStrongestNpc(before, strongestRandom(23)), chooseStrongestNpc(after, strongestRandom(23)))
})

test('strongest goes through all 15 nights including prompts, and prepares exactly once per night', () => {
  const cards: Role[] = ['hunter','hunter','hunter','knight','knight','witch','witch','trap','trap','seer','seer',
    'prophet','prophet','spy','spy','jester','jester','medium','medium','tyrant']
  const duel = new Duel(cards, cards, { npcDifficulty: 'strongest', rng: strongestRandom(615) })
  let lastPrepared = 0
  let steps = 0
  while (duel.phase !== 'finished') {
    assert.ok(++steps < 200)
    if (duel.phase === 'select') {
      const view = duel.strongestNpcView()!
      assert.equal(view.night, lastPrepared + 1)
      const moves = chooseStrongestNpc(view, strongestRandom(481 + duel.night))
      assert.ok(duel.prepareNpc(duel.night, moves))
      lastPrepared = duel.night
      assert.ok(duel.lock(duel.players[0].hand.slice(0, 1).map(c => ({ id: c.id }))))
      duel.resolve()
    } else if (duel.phase === 'choice') assert.ok(duel.answer(duel.prompt!.options[0].id))
    else assert.ok(duel.nextNight())
  }
  assert.equal(lastPrepared, 15)
  assert.equal(duel.winner, 'draw')
})

test('strongest receives its own investigations only after the night, and normal HP decides the result', () => {
  const enemy = STARTER.map(role => role === 'tyrant' ? 'prophet' : role)
  const head = ['seer', 'prophet'] as const
  const deck = [...head, ...enemy.filter(role => !head.some(entry => entry === role))]
  const duel = new Duel(STARTER, deck, { npcDifficulty: 'strongest', rng: () => .9999, rules: { finalNight: 2 } })
  const first = duel.strongestNpcView()!
  assert.deepEqual(first.investigations, [])
  assert.ok(duel.prepareNpc(1, first.hand.slice(0, 2).map(c => ({ id: c.id }))))
  assert.ok(duel.lock([{ id: duel.players[0].hand.find(c => c.role === 'hunter')?.id ?? duel.players[0].hand[0].id }]))
  duel.resolve()
  assert.equal(duel.strongestNpcView(), undefined)
  assert.ok(duel.nextNight())
  const second = duel.strongestNpcView()!
  assert.deepEqual(second.investigations.map(r => [r.kind, r.night]), [['seer', 1], ['prophet', 1]])
  assert.ok(second.investigations[1].cards.some(c => c.status === 'drawn' || c.status === 'observed'))
  assert.ok(duel.prepareNpc(2, chooseStrongestNpc(second, strongestRandom(42))))
  assert.ok(duel.lock([{ id: duel.players[0].hand.find(c => c.role !== 'assassin')!.id }]))
  duel.resolve()
  while (duel.prompt) assert.ok(duel.answer(duel.prompt.options[0].id))
  const [a,b] = duel.players.map(p => p.hp)
  assert.equal(duel.winner, a === b ? 'draw' : a > b ? 0 : 1)
})

test('worker drops stale replies, falls back on invalid moves, and aborts without submitting', async () => {
  const match = () => new Duel(STARTER, STARTER, { npcDifficulty: 'strongest', rng: strongestRandom(7) })
  const harness = () => {
    const duel = match(), view = duel.strongestNpcView()!, owner = new AbortController()
    let request: StrongestRequest | undefined
    let terminated = 0
    const worker = {
      onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
      postMessage(message: StrongestRequest) { request = message },
      terminate() { terminated++ },
    }
    const pending = requestStrongestNpc(view, 71, owner.signal,
      moves => duel.prepareNpc(view.night, moves), () => worker as unknown as Worker)
    const send = (data: unknown) => worker.onmessage?.({ data })
    return { duel, pending, send, owner, id: request!.id, stopped: () => terminated }
  }
  const a = harness()
  a.send({ id: a.id, night: 2, plays: [{ id: 0 }] })
  assert.equal(a.duel.npcReady, false)
  a.send({ id: a.id, night: 1, plays: [{ id: 0 }] })
  assert.equal(await a.pending, true)
  assert.equal(a.stopped(), 1)
  const b = harness()
  b.owner.abort()
  b.send({ id: b.id, night: 1, plays: [] })
  assert.equal(await b.pending, false)
  assert.equal(b.duel.npcReady, false)
  assert.equal(b.stopped(), 1)

  for (const mode of ['startup', 'timeout'] as const) {
    const duel = match(), view = duel.strongestNpcView()!
    const ready = await requestStrongestNpc(view, 71, new AbortController().signal,
      moves => duel.prepareNpc(view.night, moves), () => {
        if (mode === 'startup') throw Error('Worker unavailable')
        return { postMessage() {}, terminate() {} } as unknown as Worker
      }, 1)
    assert.equal(ready, true)
  }
})
