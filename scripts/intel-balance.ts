import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { CARDS, ROLES, card, validDeck, type Role } from '../src/cards.ts'
import { Duel, type NpcView, type Play, type Side } from '../src/duel.ts'
import { decks, plan, promptRank, random, type Agent, type Style, type Tactics } from './balance.ts'

const variants = {
  A: { refill: 3, bonus: {} },
  B: { refill: 3, bonus: { seer: 1 } },
  C: { refill: 3, bonus: { seer: 1, prophet: 1 } },
  D: { refill: 2, bonus: { seer: 1, prophet: 1 } },
}
const [variantRaw, mode, repetitions = '500'] = process.argv.slice(2)
assert.ok(Object.hasOwn(variants, variantRaw) && (mode === 'legacy' || mode === 'improved'))
const variant = variantRaw as keyof typeof variants
const config = variants[variant]
const samples = Number(repetitions)
assert.ok(Number.isSafeInteger(samples) && samples > 0)
assert.equal(CARDS.witch.power, 4)

function swap(base: Style, remove: Role[], add: Role[]): Role[] {
  const cards: Role[] = [...decks[base]]
  for (const role of remove) {
    const index = cards.indexOf(role)
    assert.ok(index >= 0, role)
    cards.splice(index, 1)
  }
  return [...cards, ...add]
}
const lineup: { id: string; label: string; style: Style; cards: Role[] }[] = [
  { id:'rush', label:'速攻・基準', style:'rush', cards:decks.rush },
  { id:'rushHex', label:'速攻＋妨害', style:'rush', cards:swap('rush',['mason','spy','cat'],['mad','curse','tyrant']) },
  { id:'defense', label:'耐久・基準', style:'defense', cards:decks.defense },
  { id:'defenseMedium', label:'耐久＋霊媒師', style:'defense', cards:swap('defense',['cat','jester','seer'],['medium','keeper','curse']) },
  { id:'defenseCat', label:'耐久＋猫又', style:'defense', cards:swap('defense',['jester','seer','medium'],['wolf','fox','mad']) },
  { id:'hex', label:'妨害・基準', style:'hex', cards:decks.hex },
  { id:'hexAlt', label:'妨害＋回収', style:'hex', cards:swap('hex',['dire','seer'],['medium','keeper']) },
  { id:'intel', label:'情報・基準', style:'intel', cards:decks.intel },
  { id:'intelAssassin', label:'情報＋暗殺者支援', style:'intel', cards:swap('intel',['spy','spy','jester','jester'],['knight','witch','trap','mad']) },
  { id:'intelAttack', label:'情報＋攻撃', style:'intel', cards:swap('intel',['spy','spy','jester','jester'],['dire','dire','fox','cat']) },
  { id:'recovery', label:'回収・基準', style:'recovery', cards:decks.recovery },
  { id:'recoveryWitch', label:'回収＋魔女保護', style:'recovery', cards:swap('recovery',['merchant','jester','mason'],['knight','curse','cat']) },
  { id:'balanced', label:'バランス・基準', style:'balanced', cards:decks.balanced },
  { id:'balancedAlt', label:'バランス＋情報', style:'balanced', cards:swap('balanced',['spy','mason'],['prophet','cat']) },
]
for (const entry of lineup) assert.ok(validDeck(entry.cards), entry.id)

const raids = new Set<Role>(['wolf','dire','fox'])
const names = new Map(ROLES.map(role => [card(role).name, role]))
const sides = [0, 1] as const
const actors = ['プレイヤー', 'NPC'] as const
type Notice = { night: number; text: string; privateTo?: Side }
type Intel = ReturnType<Duel['investigationsFor']>[number]
type Forecast = { role: Role; investigated: boolean }

class Memory {
  cursor = 0
  records = 0
  queue: Forecast[] = []
  lastDecay = 1
  hand = new Map<Role, { weight: number; investigated: boolean }>()
  history = new Map<number, { raid: boolean; attack: boolean }>()
  readonly side: Side
  constructor(side: Side) { this.side = side }

  update(log: Notice[], getRecords: () => Intel[]) {
    const enemy = actors[1 - this.side]
    const self = actors[this.side]
    for (let index = this.cursor; index < log.length; index++) {
      const { privateTo } = log[index]
      if (privateTo !== undefined && privateTo !== this.side) continue
      const { text, night } = log[index]
      if (night > this.lastDecay) {
        for (const [role, clue] of this.hand) {
          if (clue.weight < .15) this.hand.delete(role)
          else this.hand.set(role, { ...clue, weight: clue.weight * .58 })
        }
        this.lastDecay = night
      }
      if (privateTo === this.side && text.startsWith(self + 'の') && text.includes('が確認：')) {
        const record = getRecords()[this.records++]
        if (record.kind === 'seer') {
          for (const { role } of record.cards) this.hand.set(role, { weight: 1, investigated: true })
        } else this.queue = record.cards.map(({ role }) => ({ role, investigated: true }))
      } else if (text === enemy + 'は捨て札をシャッフルして山札に戻した。') {
        this.queue = []
      } else if (text.startsWith(enemy + 'は')) {
        const detail = text.slice(enemy.length + 1)
        const played = detail.match(/^(.+)を使用した。$/)
        const discarded = detail.match(/^(.+)を捨てた。$/)
        const returned = detail.match(/^(.+)を(手札|山札の一番上)に戻した。$/)
        const drawn = detail.match(/^(\d+)枚引いた。$/) ?? detail.match(/^夜終了時に手札を(\d+)枚補充した。$/)
        if (played || discarded) {
          const role = names.get((played ?? discarded)![1])
          if (!role) continue
          this.hand.delete(role)
          if (played) {
            const observation = this.history.get(night) ?? { raid: false, attack: false }
            observation.raid ||= raids.has(role)
            observation.attack ||= card(role).category === 'attack'
            this.history.set(night, observation)
          }
        } else if (returned) {
          const role = names.get(returned[1])
          if (!role) continue
          if (returned[2] === '手札') this.remember(role, .65, false)
          else this.queue.unshift({ role, investigated: false })
        } else if (drawn) {
          for (const { role, investigated } of this.queue.splice(0, Number(drawn[1]))) this.remember(role, .75, investigated)
        } else if (detail === '手札がないためパスした。') {
          this.history.set(night, { raid: false, attack: false })
        }
      }
    }
    this.cursor = log.length
  }

  remember(role: Role, weight: number, investigated: boolean) {
    const prior = this.hand.get(role)
    this.hand.set(role, { weight: Math.max(prior?.weight ?? 0, weight),
      investigated: investigated || Boolean(prior?.investigated) })
  }

  tactics(night: number): Tactics {
    const recent = [...this.history].filter(([turn]) => turn < night && turn >= night - 5).map(([, stat]) => stat)
    return {
      intel: new Map([...this.hand].map(([role, clue]) => [role, clue.weight])),
      raidRate: recent.length ? recent.filter(s => s.raid).length / recent.length : undefined,
      attackRate: recent.length ? recent.filter(s => s.attack).length / recent.length : undefined,
    }
  }
}

function metrics() {
  return { games:0, wins:0, draws:0, nights:0, ko:0, hpDecision:0, hp:0, turns:0, one:0, two:0,
    hand:0, reshuffle:0, plays:0, seer:0, prophet:0, seerGames:0, prophetGames:0, seerWins:0, prophetWins:0,
    assassin:0, hits:0, assisted:0, assistedHits:0 }
}
type Metrics = ReturnType<typeof metrics>

function run(left: number, right: number, seed: number, totals: [Metrics, Metrics]) {
  const teams = [lineup[left], lineup[right]]
  const rng = [random(seed ^ 0x96331b49), random(seed ^ 0x15b113cb)]
  const memory = [new Memory(0), new Memory(1)]
  const evidence: ReadonlySet<Role>[] = [new Set(), new Set()]
  const used = [new Set<Role>(), new Set<Role>()]
  let game: Duel | undefined
  let npcNight = 0

  function choose(side: Side, view: NpcView, night: number): Play[] {
    const style = teams[side].style
    const agent: Agent = { style, policy: style === 'recovery' ? 'cycle' : 'selective' }
    let seen: ReadonlySet<Role> = new Set<Role>()
    let tactics: Tactics | undefined
    if (game && mode === 'improved') {
      const state = memory[side]
      state.update(game.log, () => game!.investigationsFor(side))
      tactics = state.tactics(night)
      seen = new Set([...state.hand].filter(([, clue]) => clue.investigated).map(([role]) => role))
    } else if (game) {
      seen = new Set(game.investigationsFor(side).flatMap(record => record.cards
        .filter(c => c.status !== 'used' && night - record.night <= 1).map(c => c.role)))
    }
    evidence[side] = seen
    return plan(agent, view, night, rng[side], seen, tactics)
  }

  game = new Duel(teams[0].cards, teams[1].cards, {
    rng: random(seed), rules: { handRefill: config.refill }, intelDraw: config.bonus,
    npc: view => choose(1, view, ++npcNight),
  })
  let steps = 0
  while (game.phase !== 'finished') {
    assert.ok(++steps < 250, 'duel stalled')
    if (game.phase === 'choice') {
      const p = game.players[0]
      const prompt = game.prompt!
      const rank = (role: Role) => promptRank(role, p.hp, p.status.noHeal, p.discard.length)
      const sorted = [...prompt.options].sort((a,b) => prompt.title.includes('回収') ? rank(b.role)-rank(a.role) : rank(a.role)-rank(b.role))
      assert.ok(game.answer(sorted[0].id))
    } else if (game.phase === 'select') {
      const p = game.players[0], q = game.players[1]
      const view: NpcView = { hand:p.hand, hp:p.hp, enemyHp:q.hp, max:game.max(0), noHeal:p.status.noHeal,
        discard:p.discard, enemyDiscard:q.discard, enemyDeck:game.deckComposition(1), enemyRemaining:game.remainingComposition(1) }
      for (const side of sides) totals[side].hand += game.players[side].hand.length
      assert.ok(game.lock(choose(0, view, game.night)))
      game.resolve()
      for (const side of sides) {
        const stat = totals[side]
        const shown = game.revealed[side]
        stat.turns++
        stat.plays += shown.length
        stat.one += Number(shown.length === 1)
        stat.two += Number(shown.length === 2)
        for (const c of shown) {
          if (c.role === 'seer' || c.role === 'prophet') {
            stat[c.role]++
            used[side].add(c.role)
          }
          if (c.role === 'assassin' && !c.disabled && c.guess !== undefined) {
            const hit = game.revealed[1 - side].some(other => other.role === c.guess)
            stat.assassin++
            stat.hits += Number(hit)
            if (evidence[side].has(c.guess)) {
              stat.assisted++
              stat.assistedHits += Number(hit)
            }
          }
        }
      }
    } else assert.ok(game.nextNight())
  }
  for (const side of sides) {
    const { hand, deck, discard, hp } = game.players[side]
    const cards = [...hand, ...deck, ...discard]
    assert.equal(cards.length, 20)
    assert.equal(new Set(cards.map(c => c.id)).size, 20)
    const stat = totals[side]
    const won = Number(game.winner === side)
    stat.games++
    stat.wins += won
    stat.draws += Number(game.winner === 'draw')
    stat.nights += game.night
    stat.ko += Number(game.reason === 'HPが0になった')
    stat.hpDecision += Number(game.reason !== 'HPが0になった')
    stat.hp += hp
    stat.reshuffle += game.log.filter(l => l.text === actors[side] + 'は捨て札をシャッフルして山札に戻した。').length
    if (used[side].has('seer')) { stat.seerGames++; stat.seerWins += won }
    if (used[side].has('prophet')) { stat.prophetGames++; stat.prophetWins += won }
  }
}

const matches = []
for (let i = 0; i < lineup.length; i++) for (let j = i; j < lineup.length; j++) {
  const forward: [Metrics, Metrics] = [metrics(), metrics()]
  const reverse: [Metrics, Metrics] = [metrics(), metrics()]
  for (let n = 0; n < samples; n++) {
    const seed = (Math.imul(n + 1, 0x9e3779b1) ^ Math.imul(1 + i * lineup.length + j, 0xc2b2ae35)) >>> 0
    run(i, j, seed, forward)
    run(j, i, seed, reverse)
  }
  matches.push({ i, j, forward, reverse })
}
const output = { variant, mode, config, samples, lineup, matches }
const path = new URL('../reports/intel-' + mode + '-' + variant + '.json', import.meta.url)
writeFileSync(path, JSON.stringify(output) + '\n')
console.log(variant + ' ' + mode + ': ' + matches.length * samples * 2 + ' games completed')
