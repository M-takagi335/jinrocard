import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { CARDS, ROLES, card, validDeck, type Role } from '../src/cards.ts'
import { Duel, type Instance, type NpcView, type Play, type Side } from '../src/duel.ts'

export const decks = {
  rush: ['wolf','wolf','wolf','dire','dire','fox','fox','cat','cat','assassin','hunter','hunter','knight','trap','witch','witch','mason','spy','mad','curse'],
  defense: ['wolf','wolf','fox','cat','cat','assassin','hunter','hunter','hunter','knight','knight','witch','witch','trap','trap','seer','jester','mason','medium','curse'],
  hex: ['wolf','wolf','wolf','dire','fox','cat','assassin','hunter','knight','witch','witch','trap','trap','seer','mason','mad','mad','curse','curse','tyrant'],
  intel: ['wolf','wolf','wolf','fox','cat','assassin','assassin','hunter','knight','witch','trap','seer','seer','prophet','prophet','spy','spy','jester','jester','curse'],
  recovery: ['wolf','wolf','wolf','fox','cat','hunter','hunter','knight','witch','witch','trap','trap','medium','medium','keeper','keeper','mason','mason','merchant','jester'],
  balanced: ['wolf','wolf','wolf','dire','assassin','fox','cat','hunter','hunter','knight','witch','witch','trap','seer','spy','medium','mason','mad','curse','tyrant'],
} satisfies Record<string, Role[]>
export type Style = keyof typeof decks
type Policy = 'selective' | 'two' | 'one' | 'cycle' | 'neutral'
export type Agent = { style: Style; policy: Policy }
const styles = Object.keys(decks) as Style[]
const sides = [0, 1] as const
for (const [style, roles] of Object.entries(decks)) assert.ok(validDeck(roles), style)

export function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const pressure: Partial<Record<Role, number>> = { wolf: 2.4, dire: 2.1, fox: 1.8, witch: 1.4, hunter: 1.15, trap: 1.25, cat: 1.05, assassin: 1.1 }
const bias: Record<Style, Partial<Record<Role, number>>> = {
  rush: { wolf: .7, dire: .7, fox: .5, assassin: .3 },
  defense: { trap: .5, knight: .3, witch: .65, cat: .5 },
  hex: { mad: .8, curse: .8, tyrant: .75, trap: .2 },
  intel: { seer: .65, prophet: .5, assassin: .8, spy: .4, jester: .4 },
  recovery: { medium: .3, keeper: .45, mason: .45, merchant: .3 },
  balanced: {},
}

export type Tactics = { intel: ReadonlyMap<Role, number>; raidRate?: number; attackRate?: number }
export function plan(agent: Agent, view: NpcView, night: number, rng: () => number, seen: ReadonlySet<Role>, tactics?: Tactics): Play[] {
  const remaining = view.enemyRemaining
  const total = remaining.reduce((n, c) => n + c.count, 0) || 1
  const count = (roles: Role[]) => remaining.reduce((n, c) => n + (roles.includes(c.role) ? c.count : 0), 0)
  const priorRaid = Math.min(.9, count(['wolf','dire','fox']) / total * 1.75)
  const raids = tactics?.raidRate === undefined ? priorRaid : .45 * priorRaid + .55 * tactics.raidRate
  const guards = Math.min(.8, count(['hunter','trap']) / total * 1.6)
  const priorAttack = Math.min(.95, count(['wolf','dire','fox','assassin','cat']) / total * 1.7)
  const attacks = tactics?.attackRate === undefined ? priorAttack : .55 * priorAttack + .45 * tactics.attackRate
  const late = tactics ? Math.max(0, (night - 10) / 5) : 0
  const lead = Math.max(-1, Math.min(1, (view.hp - view.enemyHp) / 5))
  const heal = card('witch').power!
  const deficit = 20 - view.hp
  const availableWitch = view.hand.some(c => c.role === 'witch')
  const discardedWitch = view.discard.some(c => c.role === 'witch')
  const guess = remaining.map(({ role, count }) => ({
    role,
    score: count * (pressure[role] ?? .65) * (tactics ? 1 + (tactics.intel.get(role) ?? 0) * 1.8 : seen.has(role) ? 1.65 : 1) + rng() * .18,
  })).sort((a,b) => b.score-a.score)[0]?.role

  function score(role: Role) {
    const spec = card(role)
    let points = 0
    switch (role) {
      case 'wolf': case 'dire': case 'fox': {
        const raw = role === 'fox' && view.hp <= spec.lowHp! ? spec.boosted! : spec.power!
        points = raw * (1 - guards) + (raw >= view.enemyHp ? 1.6 : 0)
        if (role === 'dire') points -= view.hp <= 2 ? 50 : view.hp <= 5 ? 3.1 : 1.25
        break
      }
      case 'assassin': points = guess ? 1.25 + (seen.has(guess) ? .75 : 0) + guards : -1; break
      case 'cat': points = attacks * 2.8; break
      case 'hunter': points = raids * 3.5 + (view.hp <= 6 ? raids : 0); break
      case 'trap': points = raids * 5.2; break
      case 'knight': points = attacks * 2 + (view.hp <= 6 ? .8 : 0); break
      case 'witch': points = view.noHeal ? -7 : Math.min(heal, deficit + raids * 1.2) + (deficit >= heal ? .5 : -.8); break
      case 'mad': points = view.enemyRemaining.length >= 2 ? 1.25 + attacks * 1.2 : -.2; break
      case 'curse': points = night < 15 ? .55 + (view.enemyHp <= 16 ? count(['witch']) * .55 : 0) : -.75; break
      case 'tyrant': points = night < 15 ? 2.15 : -.75; break
      case 'spy': points = attacks * (view.hand.length <= 4 ? 1.75 : .75); break
      case 'jester': points = (1 - attacks) * (view.hand.length <= 4 ? 2.2 : 1.2); break
      case 'mason': points = view.hand.length <= 4 ? 1.85 : .75; break
      case 'merchant': points = view.hp <= 2 ? -50 : view.hp <= 6 ? -1.5 : view.hand.length <= 3 ? 1.6 : .45; break
      case 'medium': case 'keeper':
        points = !view.discard.length || night === 15 ? -.8 : role === 'medium' ? 1.3 : 1.0
        if (agent.policy === 'cycle' && discardedWitch && !availableWitch && !view.noHeal && deficit >= heal && night < 15)
          points += role === 'medium' ? 2.9 : 1.8
        break
      case 'seer': points = night < 15 ? .9 : -.4; break
      case 'prophet': points = night < 15 ? 1.0 : -.4; break
    }
    if (tactics && late > 0) {
      if (spec.category === 'guard') points += late * (lead > 0 ? .8 : role === 'witch' ? .35 : -.3)
      if (spec.category === 'attack') points += late * (lead < 0 ? .85 : -.2)
      if (spec.category === 'supply' || role === 'seer' || role === 'prophet') points -= late * .65
    }
    return points + (bias[agent.style][role] ?? 0)
  }

  const hand = view.hand.map(instance => ({ instance, score: score(instance.role) + rng() * .22 }))
  if (!hand.length) return []
  let best = [hand.reduce((a,b) => a.score >= b.score ? a : b)]
  let bestScore = best[0].score
  if (view.max >= 2 && agent.policy !== 'one') {
    for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) {
      const a = hand[i], b = hand[j]
      const pair = [a.instance.role, b.instance.role]
      let adjustment = 0
      if (pair.includes('hunter') && pair.includes('trap') || pair.filter(r => r === 'hunter').length === 2) adjustment -= raids * 3.2
      if (pair.includes('cat') && (pair.includes('hunter') || pair.includes('trap'))) adjustment -= raids * 1.4
      if (pair.every(r => r === 'witch')) adjustment -= Math.max(0, heal * 2 - deficit - raids * 1.5)
      if (pair.includes('witch') && pair.includes('knight') && view.hp <= 8) adjustment += .7
      if (pair.length === 2 && pair.every(r => r === 'dire' || r === 'merchant') && view.hp <= 4) adjustment -= 80
      const points = a.score + b.score + adjustment - (night === 15 ? .1 : view.hand.length <= 3 ? 1.25 : .65)
      if (points > bestScore || (agent.policy === 'two' && best.length === 1)) {
        best = [a,b]
        bestScore = points
      }
    }
  }
  return best.map(({instance}) => instance.role === 'assassin' && guess
    ? { id: instance.id, guess } : { id: instance.id })
}

// Mirror the engine's existing NPC prompt ranking on side 0, so recovery/discard
// choices obey the same heuristic on both sides without patching the engine.
export function promptRank(role: Role, hp: number, noHeal: boolean, discardCount: number) {
  switch (role) {
    case 'dire': return hp <= 4 ? -5 : 6
    case 'wolf': return 5
    case 'fox': return hp <= 10 ? 6 : 4
    case 'witch': return noHeal ? -4 : hp <= 16 ? 8 : hp <= 18 ? 4 : 0
    case 'merchant': return hp <= 2 ? -20 : 2
    case 'hunter': case 'trap': return 5
    case 'medium': case 'keeper': return discardCount ? 3 : -2
    default: return 3
  }
}
const emptyRoles = () => Object.fromEntries(ROLES.map(role => [role, 0])) as Record<Role, number>
function stats() {
  return { games: 0, wins: 0, draws: 0, nights: 0, hp: 0, ko: 0, plays: 0, two: 0, turns: 0,
    refill: 0, healed: 0, witchReturns: 0, usage: emptyRoles(), disabled: emptyRoles() }
}
type Stats = ReturnType<typeof stats>

function duelOnce(agents: [Agent, Agent], refill: number, seed: number, aggregate: [Stats, Stats]) {
  const rng = [random(seed ^ 0x96331b49), random(seed ^ 0x15b113cb)]
  function known(side: Side): Set<Role> {
    return new Set(game.investigationsFor(side).flatMap(record => record.cards
      .filter(c => c.status !== 'used' && game.night - record.night <= 1).map(c => c.role)))
  }
  let game: Duel
  let npcNight = 0
  game = new Duel(decks[agents[0].style], decks[agents[1].style], {
    rng: random(seed), rules: { handRefill: refill },
    npc: view => plan(agents[1], view, ++npcNight, rng[1], npcNight === 1 ? new Set() : known(1)),
  })
  function advanceChoice() {
    const p = game.players[0]
    const prompt = game.prompt!
    const recover = prompt.title.includes('回収')
    const rank = (c: Instance) => promptRank(c.role, p.hp, p.status.noHeal, p.discard.length)
    const ordered = [...prompt.options].sort((a,b) => recover ? rank(b)-rank(a) : rank(a)-rank(b))
    assert.ok(game.answer(ordered[0].id))
  }
  let steps = 0
  while (game.phase !== 'finished') {
    assert.ok(++steps < 250, 'nonterminating duel')
    if (game.phase === 'choice') {
      advanceChoice()
    } else if (game.phase === 'select') {
      const p = game.players[0], q = game.players[1]
      const view: NpcView = { hand:p.hand, hp:p.hp, enemyHp:q.hp, max:game.max(0), noHeal:p.status.noHeal,
        discard:p.discard, enemyDiscard:q.discard, enemyDeck:game.deckComposition(1), enemyRemaining:game.remainingComposition(1) }
      assert.ok(game.lock(plan(agents[0], view, game.night, rng[0], known(0))), 'invalid play')
      game.resolve()
      for (const side of sides) {
        const m = aggregate[side]
        m.turns++
        m.plays += game.revealed[side].length
        m.two += Number(game.revealed[side].length === 2)
        for (const entry of game.revealed[side]) {
          m.usage[entry.role]++
          m.disabled[entry.role] += Number(entry.disabled)
        }
      }
    } else {
      assert.ok(game.nextNight(), 'cannot advance')
    }
  }
  for (const side of sides) {
    const p = game.players[side], m = aggregate[side]
    const liveIds = [...p.hand, ...p.deck, ...p.discard].map(c => c.id)
    assert.equal(liveIds.length, 20)
    assert.equal(new Set(liveIds).size, 20)
    assert.ok(p.hp >= 0 && p.hp <= 20 && p.hand.length <= 7)
    m.games++
    m.wins += Number(game.winner === side)
    m.draws += Number(game.winner === 'draw')
    m.nights += game.night
    m.hp += p.hp
    m.ko += Number(game.reason === 'HPが0になった')
  }
  for (const entry of game.log) {
    const side = entry.text.startsWith('プレイヤーは') ? 0 : entry.text.startsWith('NPCは') ? 1 : null
    if (side === null) continue
    const m = aggregate[side]
    const refill = entry.text.match(/は夜終了時に手札を(\d+)枚補充/)
    if (refill) m.refill += Number(refill[1])
    const heal = entry.text.match(/はHPを(\d+)回復/)
    if (heal) m.healed += Number(heal[1])
    if (/は魔女を(手札|山札の一番上)に戻した/.test(entry.text)) m.witchReturns++
  }
}

function pair(a: Agent, b: Agent, refill: number, trials: number, offset: number) {
  const forward: [Stats, Stats] = [stats(), stats()]
  const reverse: [Stats, Stats] = [stats(), stats()]
  for (let i = 0; i < trials; i++) {
    const seed = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(offset + 1, 0xc2b2ae35)) >>> 0
    duelOnce([a,b], refill, seed, forward)
    duelOnce([b,a], refill, seed, reverse)
  }
  return { a, b, forward, reverse }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [refillArg, healArg, trialsArg = '1000'] = process.argv.slice(2)
  const refill = Number(refillArg), heal = Number(healArg), trials = Number(trialsArg)
  assert.ok([0,2,3].includes(refill) && [3,4].includes(heal) && Number.isSafeInteger(trials) && trials > 0)
  const original = CARDS.witch.power
  try {
    // Override only this process's card data; never write to production sources.
    CARDS.witch.power = heal
    const selective = (style: Style): Agent => ({ style, policy: style === 'recovery' ? 'cycle' : 'selective' })
    const matrix = styles.flatMap((a,i) => styles.slice(i).map((b,j) =>
      pair(selective(a), selective(b), refill, trials, i * 6 + i + j)))
    const tempo = heal === 4 ? styles.map((style,i) =>
      pair({style,policy:'two'}, {style,policy:'selective'}, refill, trials, 100+i)) : []
    const oneVsTwo = heal === 4 ? styles.map((style,i) =>
      pair({style,policy:'two'}, {style,policy:'one'}, refill, trials, 200+i)) : []
    const cycle = styles.map((style,i) =>
      pair({style:'recovery',policy:'neutral'}, selective(style), refill, trials, 300+i))
    const cyclePriority = styles.map((style,i) =>
      pair({style:'recovery',policy:'cycle'}, selective(style), refill, trials, 300+i))
    console.log(JSON.stringify({ refill, heal, trials, decks, matrix, tempo, oneVsTwo, cycle, cyclePriority }))
  } finally {
    CARDS.witch.power = original
  }
}
