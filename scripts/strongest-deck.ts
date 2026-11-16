import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { ROLES, RULES, STARTER, card, validDeck, type Role } from '../src/cards.ts'
import { Duel, chooseNpc, shuffle, type NpcView, type Play, type Side } from '../src/duel.ts'
import { DECK_TYPES, generateDeck } from '../src/generateDeck.ts'
import { decks, plan, promptRank, random, type Tactics } from './balance.ts'

const policies = ['npc', 'attack', 'hp', 'public', 'intel', 'random'] as const
type Policy = typeof policies[number]
type Deck = { id: string; cards: Role[] }
type Stats = { games: number; wins: number; draws: number; hp: number; enemyHp: number; nights: number; survived15: number; hpDecision: number; pairSquares: number }
const stats = (): Stats => ({ games: 0, wins: 0, draws: 0, hp: 0, enemyHp: 0, nights: 0, survived15: 0, hpDecision: 0, pairSquares: 0 })
const sides = [0, 1] as const
const raid = new Set<Role>(['wolf', 'dire', 'fox'])
const roleNames = new Map(ROLES.map(role => [card(role).name, role]))
const playedSuffix = 'を使用した。'
let trials = 0
let nextPair = 0

class Observations {
  cursor = 0
  readonly history = new Map<number, { raid: boolean; attack: boolean }>()

  tactics(game: Duel, side: Side): Tactics {
    const opponent = side === 0 ? 'NPC' : 'プレイヤー'
    for (; this.cursor < game.log.length; this.cursor++) {
      const event = game.log[this.cursor]
      if (event.privateTo !== undefined || !event.text.startsWith(opponent + 'は')) continue
      const text = event.text.slice(opponent.length + 1)
      const role = text.endsWith(playedSuffix) ? roleNames.get(text.slice(0, -playedSuffix.length)) : undefined
      if (!role && text !== '手札がないためパスした。') continue
      const night = this.history.get(event.night) ?? { raid: false, attack: false }
      if (role) {
        night.raid ||= raid.has(role)
        night.attack ||= card(role).category === 'attack'
      }
      this.history.set(event.night, night)
    }
    const recent = [...this.history].filter(([night]) => night >= game.night - 5 && night < game.night).map(([, value]) => value)
    const intel = new Map<Role, number>()
    for (const record of game.investigationsFor(side).slice(-5)) {
      for (const clue of record.cards) {
        if (clue.status === 'used' || clue.status === 'unknown') continue
        const reliability = record.kind === 'seer' ? clue.status === 'observed' ? 1 : .65
          : clue.status === 'drawn' ? .75 : clue.position === 1 ? .25 : .1
        const weight = reliability * .65 ** (game.night - record.night)
        intel.set(clue.role, Math.max(weight, intel.get(clue.role) ?? 0))
      }
    }
    return {
      intel,
      raidRate: recent.length ? recent.filter(night => night.raid).length / recent.length : undefined,
      attackRate: recent.length ? recent.filter(night => night.attack).length / recent.length : undefined,
    }
  }
}

function play(a: Deck, b: Deck, policy: readonly [Policy, Policy], seed: number, side: Side, result: Stats) {
  const lineup = side === 0 ? [a, b] : [b, a]
  const rng = [random(seed ^ 0xa12e913d), random(seed ^ 0x73e251cb)]
  const engineRng = random(seed)
  const observations = [new Observations(), new Observations()]
  let game: Duel | undefined
  function choose(seat: Side, view: NpcView): Play[] {
    const participant = seat === side ? 0 : 1
    const mode = policy[participant]
    if (mode === 'npc') return chooseNpc(view, rng[participant])
    if (mode === 'random') {
      if (!view.hand.length) return []
      const amount = 1 + Math.floor(rng[participant]() * Math.min(view.max, view.hand.length))
      return shuffle(view.hand, rng[participant]).slice(0, amount).map(({ id, role }) => (
        role === 'assassin' && view.enemyRemaining.length
          ? { id, guess: view.enemyRemaining[Math.floor(rng[participant]() * view.enemyRemaining.length)].role }
          : { id }
      ))
    }
    const tactics = mode === 'intel'
      ? game ? observations[seat].tactics(game, seat) : { intel: new Map<Role, number>() }
      : mode === 'public' || mode === 'hp' ? { intel: new Map<Role, number>() } : undefined
    const agent = mode === 'attack' ? { style: 'rush', policy: 'two' } as const
      : mode === 'hp' ? { style: 'defense', policy: 'cycle' } as const
      : { style: 'balanced', policy: 'selective' } as const
    const seen = new Set([...tactics?.intel ?? []].filter(([, weight]) => weight >= .3).map(([role]) => role))
    return plan(agent, view, game?.night ?? 1, rng[participant], seen, tactics)
  }
  game = new Duel(lineup[0].cards, lineup[1].cards, { rng: engineRng, npc: view => choose(1, view) })
  let steps = 0
  while (game.phase !== 'finished') {
    assert.ok(++steps < 250, '対戦が終了しない')
    if (game.phase === 'select') {
      const [self, enemy] = game.players
      assert.ok(game.lock(choose(0, {
        hand: self.hand, hp: self.hp, enemyHp: enemy.hp, max: game.max(0), noHeal: self.status.noHeal,
        discard: self.discard, enemyDiscard: enemy.discard, enemyDeck: game.deckComposition(1), enemyRemaining: game.remainingComposition(1),
      })))
      game.resolve()
    } else if (game.phase === 'choice') {
      const prompt = game.prompt!
      const self = game.players[prompt.side]
      const recovery = prompt.title.includes('回収')
      const rank = (role: Role) => promptRank(role, self.hp, self.status.noHeal, self.discard.length)
      const ordered = [...prompt.options].sort((a, b) => recovery ? rank(b.role) - rank(a.role) : rank(a.role) - rank(b.role))
      assert.ok(game.answer(ordered[0].id))
    } else assert.ok(game.nextNight())
  }
  for (const seat of sides) {
    const player = game.players[seat]
    assert.equal(new Set([...player.deck, ...player.hand, ...player.discard].map(c => c.id)).size, RULES.deckSize)
    assert.equal(player.deck.length + player.hand.length + player.discard.length, RULES.deckSize)
  }
  const win = Number(game.winner === side)
  result.games++
  result.wins += win
  result.draws += Number(game.winner === 'draw')
  result.hp += game.players[side].hp
  result.enemyHp += game.players[1 - side].hp
  result.nights += game.night
  result.survived15 += Number(game.night === RULES.finalNight && game.players[side].hp > 0)
  result.hpDecision += Number(game.night === RULES.finalNight && game.players.every(player => player.hp > 0))
  trials++
  return win
}

function paired(a: Deck, b: Deck, policy: readonly [Policy, Policy], pairs: number, start: number) {
  const result = stats()
  for (let n = 0; n < pairs; n++) {
    const seed = (Math.imul(start + n, 0x9e3779b1) ^ 0xb8ec2f79) >>> 0
    const wins = play(a, b, policy, seed, 0, result) + play(a, b, policy, seed, 1, result)
    result.pairSquares += wins * wins
  }
  return result
}

const rate = (s: Stats) => s.wins / s.games
const population = new Map<string, Deck>()
const signature = (cards: Role[]) => [...cards].sort().join(',')
function register(cards: Role[], id = 'D' + String(population.size + 1).padStart(3, '0')) {
  assert.ok(validDeck(cards), id)
  const key = signature(cards)
  const existing = population.get(key)
  if (existing) return existing
  const sorted = ROLES.flatMap(role => cards.filter(entry => entry === role))
  const deck = { id, cards: sorted }
  population.set(key, deck)
  return deck
}
const buildSeed = 0x6ad38370
const rng = random(buildSeed)
function weighted(weights: Partial<Record<Role, number>>) {
  const cards: Role[] = []
  while (cards.length < RULES.deckSize) {
    const choices = ROLES.filter(role => cards.filter(r => r === role).length < card(role).limit)
    let pick = rng() * choices.reduce((sum, role) => sum + (weights[role] ?? 1), 0)
    cards.push(choices.find(role => (pick -= weights[role] ?? 1) < 0) ?? choices.at(-1)!)
  }
  return cards
}
function mutate(base: Deck) {
  const cards = [...base.cards]
  const edits = 1 + Math.floor(rng() * 3)
  const removed = new Set<Role>()
  for (let i = 0; i < edits; i++) removed.add(cards.splice(Math.floor(rng() * cards.length), 1)[0])
  while (cards.length < RULES.deckSize) {
    const choices = ROLES.filter(role => !removed.has(role) && cards.filter(r => r === role).length < card(role).limit)
    cards.push(choices[Math.floor(rng() * choices.length)])
  }
  return register(cards)
}
function neighbors(parents: Deck[], count: number) {
  const found: Deck[] = []
  for (let attempt = 0; found.length < count && attempt < count * 12; attempt++) {
    const size = population.size
    const deck = mutate(parents[attempt % parents.length])
    if (population.size > size) found.push(deck)
  }
  assert.equal(found.length, count)
  return found
}

const types = ['standard', ...DECK_TYPES]
const refs = [register(STARTER, 'standard'), ...DECK_TYPES.map(type => register(generateDeck(type, rng), type))]
assert.deepEqual(refs.map(deck => deck.id), types)
const historical = Object.entries(decks).map(([id, cards]) => register(cards, 'old-' + id))
const themed = [
  register(weighted({ dire: 11, wolf: 9, fox: 8, assassin: 6, cat: 6, mad: 3 }), 'firepower'),
  register(weighted({ hunter: 12, trap: 12, knight: 9, witch: 9, cat: 7 }), 'counter-raid'),
  register(weighted({ wolf: 10, dire: 6, fox: 8, witch: 12, medium: 7, keeper: 4 }), 'attack-heal'),
]
const globalRandom = Array.from({ length: 40 }, () => register(generateDeck('random', rng)))
const evaluated = new Map<string, { deck: Deck; score: number }>()
function rankAgainst(pool: Deck[], opponents: Deck[], pairs: number, tactics: readonly (readonly [Policy, Policy])[], robust: boolean) {
  const offset = nextPair
  nextPair += opponents.length * tactics.length * pairs
  return pool.map(deck => {
    const scores = opponents.map((opponent, index) => {
      const rates = tactics.map((policy, column) => rate(paired(deck, opponent, policy, pairs, offset + (index * tactics.length + column) * pairs)))
      return rates.reduce((sum, n) => sum + n, 0) / rates.length
    })
    const average = scores.reduce((sum, n) => sum + n, 0) / scores.length
    return { deck, score: robust ? .65 * average + .35 * Math.min(...scores) : average }
  }).sort((a, b) => b.score - a.score || a.deck.id.localeCompare(b.deck.id))
}

const fieldPolicies = [['public', 'public'], ['intel', 'hp']] as const
function search(pool: Deck[]) {
  for (const item of rankAgainst(pool, refs, 8, fieldPolicies, true)) evaluated.set(item.deck.id, item)
  return [...evaluated.values()].sort((a, b) => b.score - a.score)
}
search([...new Set([...refs, ...historical, ...themed, ...globalRandom])])
for (let generation = 0; generation < 3; generation++) {
  const parents = [...evaluated.values()].sort((a, b) => b.score - a.score).slice(0, 9).map(entry => entry.deck)
  search(neighbors(parents, 42))
}
const qualifying = rankAgainst([...evaluated.values()].sort((a, b) => b.score - a.score).slice(0, 20).map(entry => entry.deck),
  refs, 24, fieldPolicies, true)
const rounds: { target: Deck; counter: Deck; improved: Deck }[] = []
let target = qualifying[0].deck
for (let round = 0; round < 3; round++) {
  const targetPolicies = [['intel', 'intel'], ['hp', 'public']] as const
  const pool = [...refs, ...historical, ...themed, ...rounds.map(entry => entry.counter), ...qualifying.slice(0, 8).map(entry => entry.deck)]
  const first = rankAgainst([...new Set(pool)].filter(deck => deck !== target), [target], 14, targetPolicies, false)
  const counterPool = [...first.slice(0, 6).map(x => x.deck), ...neighbors(first.slice(0, 6).map(x => x.deck), 32)]
  const shortlisted = rankAgainst(counterPool, [target], 16, targetPolicies, false).slice(0, 6)
  const counter = rankAgainst(shortlisted.map(x => x.deck), [target], 45, targetPolicies, false)[0].deck
  const improvePool = [target, ...qualifying.slice(0, 6).map(x => x.deck), ...neighbors([target], 28)]
  const improved = rankAgainst([...new Set(improvePool)].filter(deck => deck !== counter),
    [counter, ...refs], 12, fieldPolicies, true)[0].deck
  rounds.push({ target, counter, improved })
  target = improved
}
const candidates = [...new Set([...qualifying.slice(0, 10).map(x => x.deck), ...rounds.flatMap(r => [r.target, r.improved])])]
const finalRefs = [...new Set([...refs, ...rounds.map(r => r.counter), qualifying[1].deck])]
const finalDecks = [...new Set([...candidates, ...rounds.map(r => r.counter), ...historical, ...themed])]
const searchTrials = trials
console.log(`探索完了 ${population.size}構成・${searchTrials}試合`)
assert.ok(nextPair < 1_000_000)
const finalPairs = 120
const finalPolicies = [['public', 'public'], ['intel', 'hp'], ['hp', 'attack']] as const
const final = finalDecks.map(deck => ({
  id: deck.id,
  vs: finalRefs.map((opponent, i) => ({
    id: opponent.id,
    samples: finalPolicies.map((policy, j) => paired(deck, opponent, policy, finalPairs, 1_000_000 + (i * finalPolicies.length + j) * finalPairs)),
  })),
}))
const counterPairs = 240
const counterValidation = rounds.map(({ target, counter, improved }, index) => ({
  target: target.id, counter: counter.id, improved: improved.id,
  targeted: paired(counter, target, ['intel', 'intel'], counterPairs, 2_000_000 + index * 2 * counterPairs),
  adapted: paired(improved, counter, ['intel', 'intel'], counterPairs, 2_000_000 + (index * 2 + 1) * counterPairs),
}))
function commonWins(id: string) {
  const row = final.find(row => row.id === id)!
  const samples = row.vs.slice(0, refs.length).flatMap(cell => cell.samples)
  return samples.reduce((sum, cell) => sum + cell.wins, 0) / samples.reduce((sum, cell) => sum + cell.games, 0)
}
const policyDecks = [...new Set([qualifying[0].deck, ...candidates.sort((a, b) => commonWins(b.id) - commonWins(a.id)).slice(0, 2)])]
const policyPairs = 120
const policyOpponents = [...new Set([refs[0], refs[2], refs[3], refs[4], rounds[0].counter])]
const policyResults = policyDecks.map(deck => ({
  id: deck.id,
  player: policies.map(mode => ({
    mode,
    samples: policyOpponents.map((opponent, index) => paired(deck, opponent, [mode, 'intel'], policyPairs, 3_000_000 + index * policyPairs)),
  })),
  opponent: policies.map(mode => ({
    mode,
    samples: policyOpponents.map((opponent, index) => paired(deck, opponent, ['intel', mode], policyPairs, 4_000_000 + index * policyPairs)),
  })),
}))
const json = {
  rules: RULES, buildSeed, searchTrials, totalTrials: trials, searched: population.size,
  candidates: candidates.map(deck => deck.id), refs: refs.map(deck => deck.id), finalRefs: finalRefs.map(deck => deck.id),
  decks: [...population.values()], qualifying: qualifying.map(x => ({ id: x.deck.id, score: x.score })),
  finalPolicies, final, counterValidation, policyOpponents: policyOpponents.map(deck => deck.id), policyResults,
}
writeFileSync(new URL('../reports/strongest-deck-results.json', import.meta.url), JSON.stringify(json))
console.log(JSON.stringify({ searched: population.size, searchTrials, totalTrials: trials, rounds: counterValidation.map(r => [r.target, r.counter, r.improved]) }))
