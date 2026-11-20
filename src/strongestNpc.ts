import { card, RULES, type Role } from './cards.ts'
import type { Investigation, Play } from './duel.ts'
import type { StrongNpcView } from './strongNpc.ts'

type ReadonlyTree<T> = T extends object ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T
export type StrongestNpcView = ReadonlyTree<StrongNpcView & { investigations: Investigation[] }>
type Action = { role: Role; guess?: Role }
type Pair<T> = [T, T]
type Scenario = { hand: Role[]; actions: Action[]; cancel: [number, number, number, number] }
const expand = (entries: StrongestNpcView['enemyRemaining']) => entries.flatMap(e => Array<Role>(e.count).fill(e.role))
const raid = (role: Role) => role === 'wolf' || role === 'dire' || role === 'fox'
const defense = (role: Role) => role === 'hunter' || role === 'trap' || role === 'knight' || role === 'cat'
const cap = (hp: number, max: number) => Math.max(0, Math.min(max, hp))

export function strongestRandom(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000
}

function take(pool: Role[], rng: () => number) {
  return pool.splice(Math.floor(rng() * pool.length), 1)[0]
}
function remove(pool: Role[], role: Role) {
  const index = pool.indexOf(role)
  if (index >= 0) pool.splice(index, 1)
}

export function assassinEvidence(view: StrongestNpcView) {
  const hand = new Map<Role, { weight: number; kind: 'seer' | 'prophet' }>()
  const positions = new Map<number, Role>()
  for (const record of view.investigations) {
    const age = view.night - record.night
    if (age < 1) continue
    for (const entry of record.cards) {
      if (record.kind === 'prophet' && entry.status === 'observed' && entry.position) {
        positions.set(entry.position, entry.role)
      }
      const weight = record.kind === 'seer' && (entry.status === 'observed' || entry.status === 'old') ?
        (entry.status === 'observed' ? .95 : .68) * .63 ** (age - 1) :
        record.kind === 'prophet' && entry.status === 'drawn' ? .88 * .64 ** (age - 1) : 0
      if (weight >= .12 && weight > (hand.get(entry.role)?.weight ?? 0)) hand.set(entry.role, { weight, kind: record.kind })
    }
  }
  return { hand, positions }
}

function priority(role: Role, hp: number, enemyHp: number, pressure: number, healing: number, noHeal: boolean) {
  switch (role) {
    case 'wolf': return 3.3
    case 'dire': return hp <= 2 ? -10 : hp <= 5 ? 1 : enemyHp <= 5 ? 5 : 3.5
    case 'fox': return hp <= 10 ? 4 : 2.4
    case 'witch': return noHeal ? -5 : Math.min(4, RULES.hp - hp + pressure) * 1.1
    case 'hunter': case 'trap': return (hp <= 6 ? 4 : 2.9) + pressure
    case 'knight': return (hp <= 6 ? 3.2 : 2.3) + pressure * .5
    case 'cat': case 'assassin': return 2.4
    case 'mad': return 2.6
    case 'merchant': return hp <= card(role).recoil! ? -10 : 1.2
    case 'curse': return 1.3 + healing
    default: return 1.3
  }
}

function guessFrom(pool: Role[], rng: () => number) {
  return pool[Math.floor(rng() * pool.length)]
}

function predict(view: StrongestNpcView, rng: () => number): Scenario[] {
  const pool = expand(view.enemyRemaining), own = expand(view.ownRemaining)
  const observed = view.enemyHistory.flat()
  const initial = new Map(view.enemyDeck.map(e => [e.role, e.count]))
  const recent = observed.length + 6
  const raidRate = (observed.filter(raid).length + 6 * own.filter(raid).length / Math.max(1, own.length)) / recent
  const defenseRate = (observed.filter(defense).length + 2) / (recent + 2)
  const healing = view.hp < view.maxHp && own.includes('witch') ? .65 : 0
  const observations = assassinEvidence(view)
  const evidence = new Map([...observations.hand].map(([role, e]) => [role, e.weight]))
  for (const role of observations.positions.values()) {
    // Keep enough unknown cards to fill a legal sampled hand even if a record is stale.
    if (pool.length > view.enemyHandCount) remove(pool, role)
  }
  const twoRate = (3 + view.enemyHistory.filter(turn => turn.length === 2).length) / (5 + view.enemyHistory.length)
  const bias = new Map(view.enemyRemaining.map(({ role }) => {
    const expected = (initial.get(role) ?? 0) * observed.length / RULES.deckSize
    return [role, (observed.filter(r => r === role).length - expected) / (4 + expected)]
  }))
  return Array.from({ length: 24 }, () => {
    const unseen = [...pool], hand: Role[] = []
    for (const [role, weight] of evidence) {
      if (hand.length < view.enemyHandCount && unseen.includes(role) && rng() < weight) {
        hand.push(role)
        remove(unseen, role)
      }
    }
    while (hand.length < view.enemyHandCount && unseen.length) hand.push(take(unseen, rng))
    const ranked = hand.map(role => {
      const situational = raid(role) ? -.75 * defenseRate : role === 'mad' ? twoRate * .9 : 0
      const survival = view.enemyHp <= 5 && defense(role) ? .65 : 0
      return { role, score: priority(role, view.enemyHp, view.hp, raidRate,
        healing, view.enemyNoHeal)
        + situational + survival + 1.7 * (bias.get(role) ?? 0) + rng() * 4.6 }
    }).sort((a, b) => b.score - a.score)
    const amount = view.enemyMax >= 2 && ranked.length >= 2 && rng() < twoRate && ranked[1].score >= 1.7 ? 2 : 1
    return {
      hand,
      actions: ranked.slice(0, amount).map(({ role }) => ({ role, guess: role === 'assassin' ? guessFrom(own, rng) : undefined })),
      cancel: [0, 0, 0, 0].map(() => Math.floor(rng() * 2)) as Scenario['cancel'],
    }
  })
}

type RoleForecast = { role: Role; probability: number }
function forecast(view: StrongestNpcView, scenarios: Scenario[]): RoleForecast[] {
  return view.enemyRemaining.map(({ role }) => ({ role,
    probability: scenarios.filter(s => s.actions.some(a => a.role === role)).length / scenarios.length,
  })).sort((a, b) => b.probability - a.probability)
}

// Public HP projection follows the engine phases. Non-HP effects are scored separately.
export function projectNight(committed: Pair<readonly Action[]>, hp: Pair<number>, cancel: Scenario['cancel'],
  maxHp: number = RULES.hp, noHeal: Pair<boolean> = [false, false]) {
  const active = committed.map((actions, i) => {
    const mad = committed[1 - i].filter(action => action.role === 'mad').length
    return actions.length === 2 && mad ? actions.filter((_, j) => j !== cancel[i * 2] &&
      (mad < 2 || j !== cancel[i * 2 + 1])) : actions
  })
  const count = (side: number, role: Role) => active[side].filter(a => a.role === role).length
  const shield = [0, 1].map(i => count(i, 'knight') * card('knight').power!)
  const damage = [0, 0], trap = [0, 0], recoil = [0, 0], cat = [0, 0]
  const hit = (target: number, amount: number) => {
    const blocked = Math.min(shield[target], amount)
    shield[target] -= blocked
    return amount - blocked
  }
  for (const i of [0, 1]) {
    const enemy = 1 - i
    let attack = 0, special = 0
    for (const a of active[i]) {
      const spec = card(a.role)
      if (raid(a.role)) {
        attack += a.role === 'fox' && hp[i] <= spec.lowHp! ? spec.boosted! : spec.power!
        recoil[i] += spec.recoil ?? 0
      }
      if (a.role === 'assassin' && committed[enemy].some(b => b.role === a.guess)) special += spec.power!
    }
    if (attack) {
      trap[i] = count(enemy, 'trap') * card('trap').power!
      attack = count(enemy, 'hunter') ? 0 : Math.max(0, attack - count(enemy, 'trap') * card('trap').raidReduction!)
    }
    damage[enemy] = hit(enemy, attack + special)
  }
  for (const i of [0, 1]) damage[i] += hit(i, trap[i])
  for (const i of [0, 1]) if (damage[i]) cat[1 - i] = hit(1 - i, count(i, 'cat') * card('cat').power!)
  const result = hp.map((value, i) => cap(value - damage[i] - cat[i] - recoil[i], maxHp)) as Pair<number>
  const supplies: Pair<number> = [0, 0]
  if (result.every(Boolean)) {
    for (const i of [0, 1]) {
      if (!noHeal[i] && !count(1 - i, 'curse')) result[i] = cap(result[i] + count(i, 'witch') * card('witch').power!, maxHp)
      result[i] = cap(result[i] - count(i, 'merchant') * card('merchant').recoil!, maxHp)
    }
    if (result.every(Boolean)) for (const i of [0, 1]) {
      const attacks = committed[1 - i].some(a => card(a.role).category === 'attack')
      supplies[i] = count(i, 'merchant') * card('merchant').power! + count(i, 'mason') +
        (attacks ? count(i, 'spy') * card('spy').power! : count(i, 'jester') * card('jester').power!)
    }
  }
  return { hp: result, active, supplies }
}

function payoff(hp: Pair<number>, start: Pair<number>, late: number, final: boolean) {
  const diff = hp[0] - hp[1]
  if (!hp[0] || !hp[1] || final) return Math.sign(diff) * 25 + diff * .5
  const trailing = start[0] < start[1]
  return (hp[0] - start[0]) * (1.05 + (start[0] <= 7 ? .24 : 0) + (trailing ? -.25 : .35) * late)
    + (start[1] - hp[1]) * (1.14 + (trailing ? .4 : 0) * late)
    + late * (Math.tanh(diff / 4) - Math.tanh((start[0] - start[1]) / 4)) * 4
}

function combinations<T>(hand: readonly T[], max: number) {
  return hand.flatMap((entry, i) => [[entry], ...(max >= 2 ? hand.slice(i + 1).map(next => [entry, next]) : [])])
}

function distinctBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>()
  return values.filter(value => {
    const id = key(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

type Zones = { hand: Role[]; deck: Role[]; discard: Role[] }

// Inputs are sampled zones. Run supply effects in their committed order, before
// current plays reach the discard pile. Cleanup, refill, trim and dawn follow.
export function nextSampledZones(zones: Zones, committed: readonly Action[], active: readonly Action[],
  enemy: readonly Action[], hp: number, refill: number, rng: () => number): Zones {
  const { hand, deck, discard } = zones
  const draw = (n: number) => {
    for (let i = 0; i < n; i++) {
      if (!deck.length) while (discard.length) deck.push(take(discard, rng))
      const next = deck.shift()
      if (next) hand.push(next)
    }
  }
  const pick = (pool: Role[], high: boolean) => {
    if (!pool.length) return undefined
    const sign = high ? 1 : -1
    let best = 0
    for (let i = 1; i < pool.length; i++) {
      if (sign * priority(pool[i], hp, 20, 0, 0, false) > sign * priority(pool[best], hp, 20, 0, 0, false)) best = i
    }
    return pool.splice(best, 1)[0]
  }
  const trim = () => {
    while (hand.length > RULES.handLimit) discard.push(pick(hand, false)!)
  }
  const attacks = enemy.some(({ role }) => card(role).category === 'attack')
  for (const { role } of active) {
    if (role === 'merchant' || role === 'mason' || (role === 'spy' && attacks) || (role === 'jester' && !attacks)) {
      draw(card(role).power!)
      if (role === 'mason' && hand.length) discard.push(pick(hand, false)!)
    } else if (role === 'medium' || role === 'keeper') {
      const recovered = pick(discard, true)
      if (recovered && role === 'medium') hand.push(recovered)
      else if (recovered) deck.unshift(recovered)
    }
  }
  discard.push(...committed.map(a => a.role))
  draw(Math.max(0, Math.min(refill, RULES.handLimit) - hand.length))
  trim()
  draw(RULES.nightlyDraw)
  trim()
  return zones
}

function sampleDeck(pool: Role[], rng: () => number, observed?: ReadonlyMap<number, Role>) {
  const deck: (Role|undefined)[] = Array(pool.length).fill(undefined)
  for (const [position, role] of observed ?? []) {
    if (position >= 1 && position <= deck.length && !deck[position - 1] && pool.includes(role)) {
      deck[position - 1] = role
      remove(pool, role)
    }
  }
  return deck.map(role => role ?? take(pool, rng))
}

export function chooseStrongestNpc(view: StrongestNpcView, rng: () => number): Play[] {
  if (!view.hand.length) return []
  const scenarios = predict(view, rng)
  const guesses = view.hand.some(entry => entry.role === 'assassin')
    ? forecast(view, scenarios).slice(0, 3).map(entry => entry.role) : []
  const hp: Pair<number> = [view.hp, view.enemyHp]
  const late = Math.max(0, 1 - (view.finalNight - view.night) / 5)
  const final = view.night >= view.finalNight
  const allMoves = combinations(view.hand, view.max)
  const moves = distinctBy(allMoves, move => move.map(a => a.role).join(','))
  const values = moves.flatMap(move => {
    const count = move.filter(a => a.role === 'assassin').length
    const alternatives = !count || !guesses.length ? [[undefined, undefined]] :
      count === 2 ? guesses.flatMap(a => guesses.map(b => [a, b])) :
        guesses.map(guess => [guess, guess])
    return alternatives.map(pair => {
      let prediction = 0
      const actions = move.map(({ role }) => ({ role, guess: role === 'assassin' ? pair[prediction++] : undefined }))
      const after = view.hand.filter(entry => !move.includes(entry)).map(entry => entry.role)
      let score = 0
      for (const scenario of scenarios) {
        const result = projectNight([actions, scenario.actions], hp, scenario.cancel, view.maxHp, [view.noHeal, view.enemyNoHeal])
        score += payoff(result.hp, hp, late, final)
        if (final || !result.hp.every(Boolean)) continue
        const ownSupply = result.supplies[0] + result.active[0].filter(a => a.role === 'medium' && view.discard.length).length
        const supply = Math.min(view.deckCount + view.discard.length, ownSupply)
        score += (Math.min(Math.max(view.handRefill, after.length + supply), 5) -
          Math.min(Math.max(view.handRefill, after.length), 5)) * (after.length < 4 ? .82 : .37)
        const future = (side: number) => result.active[side].reduce((sum, { role }) =>
          sum + (role === 'tyrant' ? 1.1 : role === 'keeper' && (side ? view.enemyDiscard : view.discard).length ? .55 :
            role === 'seer' || role === 'prophet' ? .18 : 0), 0)
        score += future(0) - future(1) * .75
      }
      const cost = actions.reduce((sum, a) => sum + (after.length < view.handRefill ? .08 : .25) +
        (['witch','trap','dire','wolf'].includes(a.role) ? .27 : .05), 0)
      return { move, actions, after, score: score / scenarios.length - (final ? 0 : cost) + rng() * .17 }
    })
  }).sort((a, b) => b.score - a.score)

  const beam = !final ? values.slice(0, 3) : values.slice(0, 1)
  if (beam.length > 1) {
    const ownPool = expand(view.ownRemaining)
    for (const entry of view.hand) remove(ownPool, entry.role)
    const enemyPool = expand(view.enemyRemaining)
    // Shared current scenarios and random seeds across candidates. A neutral,
    // greedy opponent policy makes this a two-night approximation.
    const futures = [0, 8, 16]
      .map(index => ({ scenario: scenarios[index], seed: Math.floor(rng() * 0x100000000) }))
    const observed = assassinEvidence(view).positions
    for (const move of beam) {
      let score = 0
      for (const { scenario, seed } of futures) {
        const result = projectNight([move.actions, scenario.actions], hp, scenario.cancel, view.maxHp, [view.noHeal, view.enemyNoHeal])
        if (!result.hp.every(Boolean)) continue
        let state = seed
        const nextRandom = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000)
        const unusedEnemy = [...enemyPool], leftEnemy = [...scenario.hand]
        for (const role of scenario.hand) remove(unusedEnemy, role)
        for (const { role } of scenario.actions) remove(leftEnemy, role)
        const ownProjected = nextSampledZones({
          hand: [...move.after], deck: sampleDeck([...ownPool], nextRandom), discard: view.discard.map(c => c.role),
        }, move.actions, result.active[0], scenario.actions, result.hp[0], view.handRefill, nextRandom)
        const enemyProjected = nextSampledZones({
          hand: leftEnemy, deck: sampleDeck(unusedEnemy, nextRandom, observed), discard: view.enemyDiscard.map(c => c.role),
        }, scenario.actions, result.active[1], move.actions, result.hp[1], view.handRefill, nextRandom)
        const own = ownProjected.hand
        const enemy = enemyProjected.hand
        const max = (i: number) => result.active[1 - i].some(a => a.role === 'tyrant') ? 1 : RULES.maxPlays
        const theirs = enemy.map(role => ({ role, score: priority(role, result.hp[1], result.hp[0], 0, 0, false) }))
          .sort((a, b) => b.score - a.score).slice(0, max(1))
          .map(({ role }) => ({ role, guess: role === 'assassin'
            ? guessFrom([...ownProjected.hand, ...ownProjected.deck], nextRandom)
            : undefined }))
        const nextGuess = guessFrom([...enemyProjected.hand, ...enemyProjected.deck], nextRandom)
        let best = -Infinity
        const nextMoves = own.length ? combinations(own, max(0)) : [[]]
        for (const action of distinctBy(nextMoves, roles => roles.join(','))) {
          const next = projectNight([action.map(role => ({ role, guess: role === 'assassin' ? nextGuess : undefined })), theirs],
            result.hp, scenario.cancel, view.maxHp)
          best = Math.max(best, payoff(next.hp, result.hp, late,
            view.night + 1 === view.finalNight))
        }
        score += best
      }
      move.score += .24 * score / futures.length
    }
    beam.sort((a, b) => b.score - a.score)
  }
  return beam[0].move.map(({ id }, i) => ({ id, ...(beam[0].actions[i].guess ? { guess: beam[0].actions[i].guess } : {}) }))
}
