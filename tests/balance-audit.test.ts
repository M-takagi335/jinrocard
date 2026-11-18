import assert from 'node:assert/strict'
import test from 'node:test'
import { validDeck, type Role } from '../src/cards.ts'
import { Duel } from '../src/duel.ts'

const pool: Role[] = ['wolf','wolf','dire','assassin','fox','cat','hunter','knight','witch','trap','seer','prophet','spy','jester','medium','keeper','mason','merchant','mad','tyrant']
function fixture(left: Role[], right: Role[], roll = .99999) {
  const ordered = (opening: Role[]) => {
    const rest = [...pool]
    for (const role of opening) {
      const index = rest.indexOf(role)
      if (index >= 0) rest.splice(index, 1)
    }
    return [...opening, ...rest].slice(0, 20)
  }
  let rng = .99999
  const duel = new Duel(ordered(left), ordered(right), {
    rng: () => rng,
    rules: { handRefill: 0 },
    npc: ({ hand, max }) => hand.slice(0, Math.min(right.length, max)).map(({ id }) => ({ id })),
  })
  const play = (roles: Role[] = left) => {
    const options = [...duel.players[0].hand]
    const plays = roles.map(role => {
      const index = options.findIndex(card => card.role === role)
      assert.ok(index >= 0)
      return { id: options.splice(index, 1)[0].id }
    })
    assert.ok(duel.lock(plays))
    rng = roll
    duel.resolve()
  }
  const hp = () => duel.players.map(player => player.hp)
  return { duel, play, hp }
}

test('audit: mutual mad effects resolve even when both mad cards are disabled', () => {
  const { duel, play, hp } = fixture(['wolf','mad'], ['wolf','mad'])
  play()
  assert.deepEqual(duel.revealed.map(cards => cards.map(card => card.disabled)), [[false, true], [false, true]])
  assert.deepEqual(hp(), [17,17])
})

test('audit: two mad cards can hit the same instance, and do not cancel a solo play', () => {
  const twice = fixture(['mad','mad'], ['wolf','dire'])
  twice.play()
  assert.deepEqual(twice.duel.revealed[1].map(card => card.disabled), [false, true])
  assert.deepEqual(twice.hp(), [17,20])
  const solo = fixture(['mad','mad'], ['wolf'])
  solo.play()
  assert.deepEqual(solo.hp(), [17,20])
  assert.ok(solo.duel.revealed[1].every(card => !card.disabled))
})

test('audit: each trap counters a raid once; knight budget also applies to trap and cat counters', () => {
  const traps = fixture(['wolf','wolf'], ['trap','trap'])
  traps.play()
  assert.deepEqual(traps.hp(), [16,20])
  const chain = fixture(['wolf','cat'], ['trap','knight'])
  chain.play()
  assert.deepEqual(chain.hp(), [18,19])
  const blocked = fixture(['wolf','knight'], ['trap','cat'])
  blocked.play()
  assert.deepEqual(blocked.hp(), [20,20])
  const armor = fixture(['wolf','cat'], ['wolf','knight'])
  armor.play()
  assert.deepEqual(armor.hp(), [17,16])
  const doubleKnight = fixture(['wolf','wolf'], ['knight','knight'])
  doubleKnight.play()
  assert.deepEqual(doubleKnight.hp(), [20,18])
})

test('audit: cat-to-cat reflection does not chain and self-damage does not trigger cat', () => {
  const { play, hp } = fixture(['wolf','cat'], ['wolf','cat'])
  play()
  assert.deepEqual(hp(), [14,14])
  const self = fixture(['dire','cat'], ['hunter'])
  self.play()
  assert.deepEqual(self.hp(), [18,20])
})

test('audit: spy and jester look at revealed attack classification, even if disabled or inactive', () => {
  for (const attack of ['wolf', 'cat'] as const) {
    const spy = fixture(['spy','mad'], ['hunter', attack])
    spy.play()
    assert.equal(spy.duel.revealed[1][1].disabled, true)
    assert.equal(spy.duel.players[0].hand.length, 6)
    assert.deepEqual(spy.hp(), [20,20])
    const jester = fixture(['jester','mad'], ['hunter', attack])
    jester.play()
    assert.equal(jester.duel.revealed[1][1].disabled, true)
    assert.equal(jester.duel.players[0].hand.length, 4)
    assert.deepEqual(jester.hp(), [20,20])
  }
  const idleCat = fixture(['spy'], ['cat'])
  idleCat.play()
  assert.equal(idleCat.duel.players[0].hand.length, 7)
  assert.deepEqual(idleCat.hp(), [20,20])
})

test('audit: witch can be recovered next night but not from the current reveal', () => {
  const { duel, play } = fixture(['witch','medium','medium'], ['hunter'])
  duel.players[0].hp = 10
  play(['witch','medium'])
  assert.equal(duel.prompt, null)
  assert.equal(duel.players[0].hp, 14)
  assert.ok(duel.nextNight())
  play(['medium'])
  const witch = duel.prompt!.options.find(c => c.role === 'witch')!
  assert.ok(witch)
  assert.ok(duel.answer(witch.id))
  assert.ok(duel.players[0].hand.some(c => c.id === witch.id))
  assert.ok(duel.nextNight())
  play(['witch'])
  assert.ok(duel.log.some(entry => entry.night === 3 && entry.text === 'プレイヤーはHPを4回復した。'))
})

test('regression: reject every invalid slot before starting either side of a duel', () => {
  const sparse: Role[] = [...pool]
  delete sparse[7]
  for (const invalid of [sparse, [...pool.slice(0, 19), undefined], [...pool.slice(0, 19), null],
    [...pool.slice(0, 19), 'missing'], [...pool.slice(0, 19), 'toString']]) {
    assert.equal(validDeck(invalid), false)
    assert.throws(() => new Duel(invalid as Role[], pool), /デッキの枚数または投入上限/)
    assert.throws(() => new Duel(pool, invalid as Role[]), /デッキの枚数または投入上限/)
  }
  assert.equal(validDeck(pool), true)
})

test('optional intel draw preserves the snapshot and grants only configured active bonuses', () => {
  const ordered: Role[] = ['seer','prophet', ...pool.filter(role => role !== 'seer' && role !== 'prophet')]
  const enemy: Role[] = ['hunter', ...pool.filter(role => role !== 'hunter')]
  function inspect(intelDraw?: { seer?: number; prophet?: number }) {
    const duel = new Duel(ordered, enemy, {
      rng: () => .99999, intelDraw,
      npc: ({ hand }) => [{ id: hand[0].id }],
    })
    assert.ok(duel.lock(duel.players[0].hand.slice(0, 2).map(({ id }) => ({ id }))))
    duel.resolve()
    return duel
  }
  const a = inspect()
  const b = inspect({ seer: 1 })
  const c = inspect({ seer: 1, prophet: 1 })
  assert.deepEqual([a,b,c].map(duel => duel.players[0].hand.length), [4,5,6])
  assert.deepEqual(a.investigationsFor(0), c.investigationsFor(0))
  assert.deepEqual(c.investigationsFor(0).map(record => record.cards.length), [1,3])
  assert.deepEqual(c.investigationsFor(1), [])

  const disruption: Role[] = ['mad', ...pool.filter(role => role !== 'mad')]
  const disabled = new Duel(ordered, disruption, { rng: () => .99999,
    intelDraw: { seer: 1, prophet: 1 }, npc: ({ hand }) => [{ id: hand[0].id }] })
  assert.ok(disabled.lock(disabled.players[0].hand.slice(0, 2).map(({ id }) => ({ id }))))
  disabled.resolve()
  assert.equal(disabled.revealed[0][1].disabled, true)
  assert.equal(disabled.players[0].hand.length, 5)
  assert.deepEqual(disabled.investigationsFor(0).map(record => record.kind), ['seer'])
})
