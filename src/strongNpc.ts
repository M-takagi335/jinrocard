import { ROLES, card, type Role } from './cards.ts'
import type { NpcView, Play } from './duel.ts'

export const NPC_DIFFICULTIES = { standard: '標準', strong: '強い' } as const
export type NpcDifficulty = keyof typeof NPC_DIFFICULTIES

export type StrongNpcView = NpcView & {
  night: number
  finalNight: number
  maxHp: number
  handRefill: number
  deckCount: number
  ownRemaining: NpcView['enemyRemaining']
  enemyHandCount: number
  enemyMax: number
  enemyNoHeal: boolean
  enemyHistory: readonly (readonly Role[])[]
}

const scenarioCount = 24
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function sampleHand(pool: Role[], size: number, rng: () => number) {
  const copy = [...pool]
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rng() * (copy.length - i))
    const role = copy[j]
    copy[j] = copy[i]
    copy[i] = role
  }
  return copy.slice(0, size)
}

function preference(role: Role, hp: number, enemyHp: number, noHeal: boolean, maxHp: number) {
  switch (role) {
    case 'wolf': return 3.3
    case 'dire': return hp <= 2 ? -10 : hp <= 5 ? 1 : enemyHp <= 5 ? 5 : 3.5
    case 'fox': return hp <= 10 ? 4 : 2.4
    case 'witch': return noHeal ? -5 : Math.min(4, maxHp - hp) * 1.1
    case 'hunter': case 'trap': return hp <= 6 ? 4 : 2.9
    case 'knight': return hp <= 6 ? 3.2 : 2.3
    case 'cat': case 'assassin': return 2.4
    case 'mad': return 2.6
    case 'merchant': return hp <= card('merchant').recoil! ? -10 : 1.2
    default: return 1.3
  }
}

type Scenario = { roles: Role[]; guess?: Role; cancel: number[] }
function predict(view: StrongNpcView, rng: () => number): Scenario[] {
  const pool = view.enemyRemaining.flatMap(({ role, count }) => Array<Role>(count).fill(role))
  const handCount = Math.min(view.enemyHandCount, pool.length)
  const initial = new Map(view.enemyDeck.map(({ role, count }) => [role, count]))
  const history = view.enemyHistory.flat()
  const initialCount = view.enemyDeck.reduce((sum, { count }) => sum + count, 0) || 1
  const playBias = new Map(ROLES.map(role => {
    const prior = (initial.get(role) ?? 0) / initialCount
    const observed = history.filter(played => played === role).length
    return [role, (observed - history.length * prior) / (4 + history.length * prior)]
  }))
  const twoRate = (3 + view.enemyHistory.filter(turn => turn.length === 2).length) / (5 + view.enemyHistory.length)
  const guessPool = view.ownRemaining.flatMap(({ role, count }) => Array<Role>(count).fill(role))
  return Array.from({ length: scenarioCount }, () => {
    const hand = sampleHand(pool, handCount, rng).map(role => ({
      role,
      score: preference(role, view.enemyHp, view.hp, view.enemyNoHeal, view.maxHp) + 1.7 * (playBias.get(role) ?? 0) + rng() * 4.6,
    })).sort((a, b) => b.score - a.score)
    const amount = view.enemyMax >= 2 && hand.length >= 2 && rng() < twoRate && hand[1].score >= 1.7 ? 2 : 1
    return {
      roles: hand.slice(0, amount).map(entry => entry.role),
      guess: guessPool[Math.floor(rng() * guessPool.length)],
      cancel: Array.from({ length: 4 }, () => Math.floor(rng() * 2)),
    }
  })
}

type Effects = {
  raid: number; special: number; recoil: number; shield: number; blocksRaid: boolean
  trap: number; cat: number; heal: number; blocksHealing: boolean; merchant: number; supplies: number; future: number
}

// A compact one-night projection. Only the engine resolves the actual effects.
function project(roles: readonly Role[], guess: Role | undefined, enemy: readonly Role[], hp: number,
  noHeal: boolean, hasDiscard: boolean, maxHp: number) {
  const result: Effects = { raid: 0, special: 0, recoil: 0, shield: 0, blocksRaid: false,
    trap: 0, cat: 0, heal: 0, blocksHealing: false, merchant: 0, supplies: 0, future: 0 }
  const enemyAttacks = enemy.some(role => card(role).category === 'attack')
  for (const role of roles) {
    const spec = card(role)
    switch (role) {
      case 'wolf': case 'dire': case 'fox':
        result.raid += role === 'fox' && hp <= spec.lowHp! ? spec.boosted! : spec.power!
        result.recoil += spec.recoil ?? 0
        break
      case 'assassin': if (guess && enemy.includes(guess)) result.special += spec.power!; break
      case 'cat': result.cat += spec.power!; break
      case 'hunter': result.blocksRaid = true; break
      case 'trap': result.blocksRaid = true; result.trap += spec.power!; break
      case 'knight': result.shield += spec.power!; break
      case 'witch': if (!noHeal) result.heal += spec.power!; break
      case 'merchant': result.merchant += spec.recoil!; result.supplies += spec.power!; break
      case 'spy': if (enemyAttacks) result.supplies += spec.power!; break
      case 'jester': if (!enemyAttacks) result.supplies += spec.power!; break
      case 'mason': result.supplies += spec.power! - 1; break
      case 'medium': if (hasDiscard) result.supplies += 1; break
      case 'keeper': if (hasDiscard) result.future += .55; break
      case 'curse': result.blocksHealing = true; break
      case 'tyrant': result.future += 1.1; break
      case 'seer': case 'prophet': result.future += hp < maxHp ? .12 : .18; break
    }
  }
  return result
}

function enabled(roles: readonly Role[], opponent: readonly Role[], cancel: readonly number[], offset: number) {
  if (roles.length !== 2 || !opponent.includes('mad')) return roles
  const first = cancel[offset]
  const twice = opponent[0] === 'mad' && opponent[1] === 'mad'
  return roles.filter((_, index) => index !== first && (!twice || index !== cancel[offset + 1]))
}

function healthAfter(a: Effects, b: Effects, hp: number, enemyHp: number, maxHp: number) {
  const incoming = (a.blocksRaid ? 0 : b.raid) + b.special + (a.raid ? b.trap : 0)
  const outgoing = (b.blocksRaid ? 0 : a.raid) + a.special + (b.raid ? a.trap : 0)
  const ownHit = Math.max(0, incoming - a.shield)
  const enemyHit = Math.max(0, outgoing - b.shield)
  const ownCounter = enemyHit ? Math.max(0, b.cat - Math.max(0, a.shield - incoming)) : 0
  const enemyCounter = ownHit ? Math.max(0, a.cat - Math.max(0, b.shield - outgoing)) : 0
  const own = Math.max(0, hp - ownHit - ownCounter - a.recoil)
  const enemy = Math.max(0, enemyHp - enemyHit - enemyCounter - b.recoil)
  if (!own || !enemy) return [own, enemy] as const
  return [Math.max(0, Math.min(maxHp, own + (b.blocksHealing ? 0 : a.heal)) - a.merchant),
    Math.max(0, Math.min(maxHp, enemy + (a.blocksHealing ? 0 : b.heal)) - b.merchant)] as const
}

export function chooseStrongNpc(view: StrongNpcView, rng: () => number): Play[] {
  const moves: number[][] = []
  for (let i = 0; i < view.hand.length; i++) {
    moves.push([i])
    if (view.max >= 2) for (let j = i + 1; j < view.hand.length; j++) moves.push([i, j])
  }
  if (!moves.length) return []
  const scenarios = predict(view, rng)
  // The prediction only nominates guesses present in the public remaining pool.
  const guesses = view.enemyRemaining.map(entry => ({ ...entry,
    likelihood: scenarios.filter(scenario => scenario.roles.includes(entry.role)).length,
  })).sort((a, b) => b.likelihood - a.likelihood || b.count - a.count).slice(0, 2).map(entry => entry.role)
  const lastNight = view.night >= view.finalNight
  const trailing = view.hp < view.enemyHp
  const late = clamp(1 - (view.finalNight - view.night) / 5, 0, 1)
  const ownHasDiscard = view.discard.length > 0
  const enemyHasDiscard = view.enemyDiscard.length > 0
  let best = -Infinity
  let chosen: Play[] = []
  for (const move of moves) {
    const roles = move.map(index => view.hand[index].role)
    const candidates = roles.includes('assassin') && guesses.length ? guesses : [undefined]
    for (const guess of candidates) {
      let sum = 0
      for (const scenario of scenarios) {
        const ours = project(enabled(roles, scenario.roles, scenario.cancel, 0), guess, scenario.roles,
          view.hp, view.noHeal, ownHasDiscard, view.maxHp)
        const theirs = project(enabled(scenario.roles, roles, scenario.cancel, 2), scenario.guess, roles,
          view.enemyHp, view.enemyNoHeal, enemyHasDiscard, view.maxHp)
        const [hp, enemyHp] = healthAfter(ours, theirs, view.hp, view.enemyHp, view.maxHp)
        const difference = hp - enemyHp
        if (!hp || !enemyHp || lastNight) {
          sum += Math.sign(difference) * 25 + difference * .5
        } else {
          const selfWeight = 1.05 + (view.hp <= 7 ? .24 : 0) + (trailing ? -.25 : .35) * late
          sum += (hp - view.hp) * selfWeight + (view.enemyHp - enemyHp) * (1.14 + (trailing ? .4 : 0) * late)
          sum += late * (Math.tanh(difference / 4) - Math.tanh((view.hp - view.enemyHp) / 4)) * 4
          const left = view.hand.length - move.length
          const afterDraw = Math.max(view.handRefill, Math.min(view.deckCount + view.discard.length, ours.supplies) + left)
          sum += (Math.min(afterDraw, 5) - Math.min(Math.max(view.handRefill, left), 5)) * (left < 4 ? .82 : .37)
          sum += ours.future - theirs.future * .75
        }
      }
      const reservation = lastNight ? 0 : roles.reduce((cost, role) => {
        const valuable = role === 'witch' || role === 'trap' || role === 'dire' || role === 'wolf'
        const recycle = view.hand.length - move.length < view.handRefill ? .08 : .25
        return cost + recycle + (valuable ? .27 : .05)
      }, 0)
      // The jitter is bounded, so it only breaks near ties.
      const score = sum / scenarios.length - reservation + rng() * .17
      if (score > best) {
        best = score
        chosen = move.map(index => {
          const { id, role } = view.hand[index]
          return role === 'assassin' && guess ? { id, guess } : { id }
        })
      }
    }
  }
  return chosen
}
