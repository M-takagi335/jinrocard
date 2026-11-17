import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { ROLES, RULES, STARTER, card, validDeck, type Role } from '../src/cards.ts'
import type { Duel, Play, Side } from '../src/duel.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { promptRank, random } from './balance.ts'
import { reviewEngine, variants, type Variant } from './card-review-engine.ts'

const engines = new Map(await Promise.all(variants.map(async variant => [variant, await reviewEngine(variant)] as const)))
const seeds = Number(process.argv[2] ?? 32)
assert.ok(Number.isSafeInteger(seeds) && seeds > 1)
const output = process.argv[3] ?? 'reports/card-balance-review-data.json'
const focusOnly = process.argv.includes('--focus')
const profiles = ['rush', 'defense', 'intel', 'combo'] as const
const opponents = {
  rush: generateDeck('rush', random(5046)),
  defense: generateDeck('defense', random(312)),
}
const controls: Role[] = ['wolf', 'knight', 'spy', 'mason']
const bases = Object.fromEntries(profiles.map((type, i) => [type, generateDeck(type, random(14796 + i))])) as Record<typeof profiles[number], Role[]>
const weights = ['plain', 'seek', 'use'] as const
type Weight = typeof weights[number]
type Mode = 'standard' | 'strong'
const modes = ['standard', 'strong'] as const
const sides = [0, 1] as const
const opposite = (side: Side): Side => side === 0 ? 1 : 0
const logIndex = (line: string) => line.split(':')

function fitting(deck: Role[], banned: readonly Role[]) {
  return ROLES.find(role => !banned.includes(role) && deck.filter(entry => entry === role).length < card(role).limit)!
}
function swapPair(base: readonly Role[], target: Role, anchor: Role) {
  const control = [...base]
  let index = control.findIndex(role => role === anchor && role !== target)
  if (index === -1) index = control.findIndex(role => role !== target)
  if (control.filter(role => role === target).length === card(target).limit) {
    const reserve = control.findIndex(role => role === target)
    control[reserve] = fitting(control, [target])
  }
  const treated = [...control]
  treated[index] = target
  assert.ok(validDeck(control) && validDeck(treated))
  assert.equal(treated.filter((role, i) => role !== control[i]).length, 1)
  return { control, treated, index }
}

function guidedMove(game: Duel, side: Side, plays: Play[], method: Weight) {
  if (method === 'plain') return { plays, informed: false }
  const view = game.strongNpcView(side)
  const records = game.investigationsFor(side)
  const proposed = [...plays]
  if (view.hp >= 10 && game.night <= 11 && !records.some(entry => game.night - entry.night <= 2)) {
    const intel = view.hand.find(entry => entry.role === 'prophet' || entry.role === 'seer')
    const playedIntel = proposed.some(entry => view.hand.some(c => c.id === entry.id && (c.role === 'prophet' || c.role === 'seer')))
    if (intel && !playedIntel) {
      const low = proposed.findIndex(entry => view.hand.some(c => c.id === entry.id && ['keeper','spy','jester','curse','tyrant'].includes(c.role)))
      if (proposed.length < view.max) proposed.push({ id: intel.id })
      else if (low >= 0) proposed[low] = { id: intel.id }
    }
  }
  let informed = false
  if (method === 'use') {
    const clues = new Map<Role, number>()
    for (const record of records.slice(-5)) {
      const age = game.night - record.night
      if (age > 4) continue
      for (const item of record.cards) {
        const usable = record.kind === 'prophet' ? item.status === 'drawn' : item.status === 'observed' || item.status === 'old'
        if (!usable) continue
        const score = (item.status === 'observed' ? 2 : 1.6) * .67 ** Math.max(0, age - 1)
        clues.set(item.role, Math.max(clues.get(item.role) ?? 0, score))
      }
    }
    for (const entry of proposed) {
      if (!entry.guess || !clues.size) continue
      const candidates = view.enemyRemaining.map(c => ({ ...c, score: Math.log1p(c.count)
        + (view.enemyHistory.flat().filter(role => role === c.role).length * .15)
        + (clues.get(c.role) ?? 0) + (entry.guess === c.role ? .55 : 0) }))
      candidates.sort((a, b) => b.score - a.score)
      if (candidates[0] && clues.has(candidates[0].role)) {
        informed ||= entry.guess !== candidates[0].role
        entry.guess = candidates[0].role
      }
    }
  }
  return { plays: proposed, informed }
}

const empty = () => ({
  games: 0, wins: 0, draws: 0, night15: 0, hpDecision: 0, uses: 0, successes: 0, measures: 0,
  earlyUses: 0, earlyHits: 0, midUses: 0, midHits: 0, lateUses: 0, lateHits: 0, disabled: 0,
  observations: 0, drawn: 0, travel: 0, sameNightDraw: 0, observedNights: 0, actionableNights: 0, records: 0,
  guesses: 0, correct: 0, changedGuess: 0, changedCorrect: 0,
  lateHpWins: 0, lateHpGames: 0, merchantKo: 0,
})
type Stats = ReturnType<typeof empty>
type Cell = { label: string; profile: string; opponent: string; mode: Mode; cards: Role[]; anchor?: Role; index: number; variant?: Variant; method?: Weight }
function add(total: Stats, line: Stats) {
  for (const key of Object.keys(line) as (keyof Stats)[]) total[key] += line[key]
}
function run(cell: Cell, enemy: Role[], seed: number, focal: Side, observeInfo = false) {
  const kit = engines.get(cell.variant ?? 'current')!
  const lineup = focal === 0 ? [cell.cards, enemy] : [enemy, cell.cards]
  const game = new kit.Duel(lineup[0], lineup[1], { twoHumans: true, rng: random(seed) })
  const choose = cell.mode === 'strong' ? kit.chooseStrongNpc : kit.chooseNpc
  const trackedId = cell.index + 1 + (focal ? RULES.deckSize : 0)
  const role = cell.cards[cell.index]
  const result = empty()
  const pairs: Record<string, [number, number]> = {}
  const tracked: { night: number; id: number; drawn: boolean }[] = []
  let cursor = 0
  let acted = false
  let informed = false
  let steps = 0
  while (game.phase !== 'finished') {
    assert.ok(++steps < 250, 'Duel failed to finish')
    if (game.phase === 'select') {
      if (observeInfo) for (const record of game.investigationsFor(focal)) {
        if (record.kind !== 'prophet' || record.night === game.night) continue
        result.observedNights += Number(record.cards.some(entry => entry.status === 'observed'))
        result.actionableNights += Number(game.night - record.night <= 4 && record.cards.some(entry => entry.status === 'drawn'))
      }
      const chosen = sides.map(side => choose(game.strongNpcView(side),
        random(seed ^ Math.imul(game.night, 0x9e3779b9) ^ (side === focal ? 0x529527ab : 0x37afa453))))
      const update = guidedMove(game, focal, chosen[focal], cell.method ?? 'plain')
      chosen[focal] = update.plays
      informed = update.informed
      assert.ok(game.lockBoth([chosen[0], chosen[1]]))
      game.resolve()
      acted = true
    } else if (game.prompt) {
      const prompt = game.prompt
      const player = game.players[prompt.side]
      const sign = prompt.title.includes('回収') ? -1 : 1
      const rank = (candidate: Role) => sign * promptRank(candidate, player.hp, player.status.noHeal, player.discard.length)
      assert.ok(game.answer([...prompt.options].sort((a,b) => rank(a.role) - rank(b.role))[0].id))
    } else {
      assert.ok(game.nextNight())
    }

    if (acted && !game.prompt) {
      const used = game.revealed[focal].find(entry => entry.id === trackedId)
      const history = game.log.slice(cursor)
      if (used) {
        const marker = '@effect:' + trackedId + ':'
        const measured = history.filter(entry => entry.text.startsWith(marker)).reduce((sum, entry) => sum + Number(entry.text.slice(marker.length)), 0)
        const success = role === 'tyrant' ? !used.disabled && game.phase !== 'finished' : measured > 0
        result.uses++
        result.successes += Number(success)
        result.measures += measured
        result.disabled += Number(used.disabled)
        const stage = game.night <= 5 ? 'early' : game.night <= 10 ? 'mid' : 'late'
        result[stage + 'Uses']++
        result[stage + 'Hits'] += Number(success)
        for (const ally of game.revealed[focal].filter(entry => entry.id !== trackedId && !entry.disabled)) {
          const entry = pairs[ally.role] ??= [0, 0]
          entry[0]++
          entry[1] += Number(success)
        }
        if (role === 'merchant' && history.some(entry => entry.text.startsWith(focal === 0 ? 'プレイヤーは商人' : 'NPCは商人') && entry.text.endsWith('（HP 0）。')))
          result.merchantKo++
      }
      if (observeInfo) {
        for (const entry of game.revealed[focal].filter(c => c.guess && !c.disabled)) {
          const correct = game.revealed[opposite(focal)].some(c => c.role === entry.guess)
          result.guesses++
          result.correct += Number(correct)
          if (informed) {
            result.changedGuess++
            result.changedCorrect += Number(correct)
          }
        }
      }
      acted = false
    }

    // Track exact cards for measurement only; the policy never receives these IDs.
    if (!acted) {
      if (observeInfo) for (; cursor < game.log.length; cursor++) {
        const { text, night } = game.log[cursor]
        if (text.startsWith('@prophet:' + focal + ':')) {
          const cards = logIndex(text)[3].split(',').map(Number)
          result.records++
          result.observations += cards.length
          for (const id of cards) tracked.push({ night, id, drawn: false })
        } else if (text.startsWith('@draw:')) {
          const id = Number(logIndex(text)[1])
          for (const item of tracked.filter(item => item.id === id && !item.drawn)) {
            item.drawn = true
            result.drawn++
            result.travel += night - item.night
            result.sameNightDraw += Number(night === item.night)
          }
        }
      }
      else cursor = game.log.length
    }
  }
  result.games = 1
  result.wins = Number(game.winner === focal)
  result.draws = Number(game.winner === 'draw')
  result.night15 = Number(game.night === RULES.finalNight)
  result.hpDecision = Number(game.reason === '第15夜終了')
  result.lateHpGames = Number(game.night >= 11 && result.hpDecision)
  result.lateHpWins = result.lateHpGames * result.wins
  return { result, pairs }
}

function sampling(cell: Cell, enemy: Role[], info = false, cluster = 0) {
  assert.ok(validDeck(cell.cards) && validDeck(enemy))
  const sum = empty()
  const wins: number[] = []
  const pairs: Record<string, [number, number]> = {}
  for (let i = 0; i < seeds; i++) {
    const seed = (0x34768a33 + Math.imul(i, 0x9e3779b9) + Math.imul(cluster + (focusOnly ? 29 : 0), 0x10f3)) >>> 0
    let won = 0
    for (const side of sides) {
      const entry = run(cell, enemy, seed, side, info)
      add(sum, entry.result)
      won += entry.result.wins
      for (const [role, value] of Object.entries(entry.pairs)) {
        const pair = pairs[role] ??= [0, 0]
        pair[0] += value[0]
        pair[1] += value[1]
      }
    }
    wins.push(won / 2)
  }
  return { ...cell, stats: sum, wins, pairs }
}

const main = []
const proposals = []
const intel = []
for (const [i, profile] of focusOnly ? [] : profiles.entries()) {
  for (const [opponent, deck] of Object.entries(opponents)) for (const mode of modes) for (const role of ROLES) {
    const { control, treated, index } = swapPair(bases[profile], role, controls[i])
    const meta = { label: role, profile, opponent, mode, index, anchor: control[index] }
    main.push({ candidate: sampling({ ...meta, cards: treated }, deck), control: sampling({ ...meta, cards: control }, deck) })
  }
  console.log('role sweep', profile, main.length)
}

const supportBase = (support: boolean) => {
  const cards = STARTER.map(role => role === 'tyrant' ? 'merchant' : role)
  if (support) {
    cards[cards.indexOf('spy')] = 'medium'
    cards[cards.indexOf('assassin')] = 'mason'
  } else {
    cards[cards.indexOf('mason')] = 'jester'
    cards[cards.indexOf('medium')] = 'knight'
  }
  return cards
}
for (const support of [false, true]) for (const [opponent, enemy] of Object.entries(opponents)) for (const mode of modes) {
  const base = supportBase(support)
  for (const role of ['merchant','keeper'] as const) {
    const cards = [...base]
    const index = cards.indexOf('merchant')
    cards[index] = role
    for (const variant of variants.filter(candidate => candidate === 'current' || candidate.startsWith(role))) {
      proposals.push(sampling({ label: role, cards, profile: support ? 'support' : 'solo', opponent, mode, index, variant }, enemy, false, 3))
    }
  }
}
const infoBase = [...bases.intel]
for (const role of ['prophet','seer'] as const) {
  for (const assassin of [false, true]) for (const [opponent, enemy] of Object.entries(opponents)) {
    const cards = [...infoBase]
    for (const [i, entry] of cards.entries()) {
      if (entry === 'prophet' || entry === 'seer' || (!assassin && entry === 'assassin'))
        cards[i] = fitting(cards, ['prophet','seer', ...(assassin ? [] : ['assassin'] as Role[])])
    }
    const { treated, index } = swapPair(cards, role, 'spy')
    for (const method of weights)
      intel.push(sampling({ label: role, profile: assassin ? 'assassin' : 'no-assassin', opponent, mode: 'strong', cards: treated, index, method }, enemy, true, 11))
  }
}
writeFileSync(output, JSON.stringify({ seeds, rules: RULES, bases, opponents, main, proposals, intel }))
