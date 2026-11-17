import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { ROLES, STARTER, validDeck, type Role } from '../src/cards.ts'
import type * as Engine from '../src/duel.ts'
import type * as Strong from '../src/strongNpc.ts'
import { generateDeck } from '../src/generateDeck.ts'
import { promptRank, random } from './balance.ts'

const baseline = 'befe15b4360d3b1d687f006dc6b4e0d0ae071759'
const stressRecovery = process.argv.includes('--reuse')
const variants = ['A', 'B-fixed', 'B-adapted'] as const
type Variant = typeof variants[number]
type Side = Engine.Side
const sides = [0, 1] as const
function replace(source: string, from: string, to: string) {
  assert.equal(source.split(from).length, 2, 'Missing unique anchor: ' + from)
  return source.replace(from, to)
}
function source(name: string, overrides: Record<string, string> = {}) {
  const url = new URL('../src/' + name, import.meta.url)
  return execFileSync('git', ['show', baseline + ':src/' + name], { encoding: 'utf8' })
    .replace(/from '(\.\/[^']+)'/g, (_, path: string) => "from '" + (overrides[path] ?? new URL(path, url).href) + "'")
}
const moduleUrl = (code: string) => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'strip' })).toString('base64')
async function setup(variant: Variant) {
  const strong = source('strongNpc.ts')
  const policy = variant === 'B-adapted'
    ? replace(replace(strong, "case 'merchant': return hp <= 2", "case 'merchant': return hp <= 1"), 'result.merchant += spec.recoil!', 'result.merchant += 1')
    : strong
  let engine = source('duel.ts')
  if (variant !== 'A') engine = replace(engine, "count(i, 'merchant') * card('merchant').recoil!", "count(i, 'merchant')")
  if (variant === 'B-adapted') engine = replace(engine, "case 'merchant': return hp<=2", "case 'merchant': return hp<=1")
  engine = replace(engine, "if(kind==='refill') this.write(who[side]+'は夜終了時に手札を'+drawn+'枚補充した。')",
    "if(kind==='refill') this.write(who[side]+'は夜終了時に手札を'+drawn+'枚補充した。'); return drawn")
  engine = replace(engine, "case 'merchant': this.draw(i,spec.power!); break",
    "case 'merchant': { const n=this.draw(i,spec.power!); this.write('@merchant:'+i+':'+n); break }")
  engine = replace(engine, "if (c.role === 'medium') {",
    "if (c.role === 'medium') { if(recovered.role==='merchant') this.write('@recovery:'+i+':1')")
  engine = replace(engine, "this.write(who[i]+'は商人でHPを'+lost", "this.write('@cost:'+i+':'+lost); this.write(who[i]+'は商人でHPを'+lost")
  engine = replace(engine, "this.write(who[i]+'はHPを'+gained", "this.write('@heal:'+i+':'+gained); this.write(who[i]+'はHPを'+gained")
  return { ...(await import(moduleUrl(engine)) as typeof Engine), ...(await import(moduleUrl(policy)) as typeof Strong) }
}
const kits = new Map(await Promise.all(variants.map(async variant => [variant, await setup(variant)] as const)))

const fixed = {
  標準: STARTER,
  最強候補D343: ['wolf','wolf','wolf','dire','assassin','assassin','fox','fox','cat','hunter','knight','witch','witch','trap','trap','mason','mason','mad','mad','curse'],
  耐久対策D272: ['wolf','assassin','assassin','cat','cat','hunter','hunter','hunter','knight','knight','witch','witch','trap','trap','seer','seer','jester','medium','mason','mason'],
  商人入り: ['merchant','merchant','wolf','wolf','wolf','dire','fox','fox','knight','knight','hunter','hunter','witch','witch','mason','medium','mad','trap','curse','cat'],
} satisfies Record<string, Role[]>
const opponents = ['標準','速攻','耐久','情報','コンボ','ランダム','最強候補D343','耐久対策D272','商人入り'] as const
function opposing(name: typeof opponents[number], seed: number): Role[] {
  if (name in fixed) return fixed[name as keyof typeof fixed]
  const type = { 速攻: 'rush', 耐久: 'defense', 情報: 'intel', コンボ: 'combo', ランダム: 'random' } as const
  return generateDeck(type[name as keyof typeof type], random(seed ^ 0x363fb29b))
}
const core: Role[] = ['wolf','wolf','wolf','dire','fox','hunter','hunter','knight','trap','cat','curse','mad']
const packages: Record<string, Role[]> = {
  単体: ['fox','dire','knight','trap','spy','jester'],
  霊媒師: ['fox','dire','knight','trap','medium','medium'],
  共有者: ['fox','dire','knight','trap','mason','mason'],
  魔女: ['fox','dire','knight','trap','witch','witch'],
  全支援攻撃: ['medium','medium','mason','mason','witch','witch'],
  全支援防御: ['medium','medium','mason','mason','witch','witch'],
}
function tested(name: string, merchant: number) {
  const deck: Role[] = [...(name === '全支援防御'
    ? ['wolf','wolf','fox','assassin','hunter','hunter','hunter','knight','knight','trap','trap','curse'] as const : core),
    ...packages[name], 'keeper', 'jester']
  for (let i = 0; i < merchant; i++) deck[deck.length - 1 - i] = 'merchant'
  assert.ok(validDeck(deck))
  return deck
}

const empty = () => ({ games:0,wins:0,draws:0,hp:0,enemyHp:0,ko:0,final:0,uses:0,drawn:0,recovered:0,
  reuse:0,repeatGames:0,reuseWins:0,cost:0,heal:0,damage:0,hand:0,handSamples:0,overflow:0,overflowNights:0,overflowPeak:0,
  masonDiscards:0,recycle:0,recycleGames:0,curseStops:0,curseGames:0,curseWins:0,two:0,turns:0 })
type Totals = ReturnType<typeof empty>
const modes = ['standard','strong'] as const
function play(deck: Role[], enemy: Role[], variant: Variant, mode: typeof modes[number], focal: Side, seed: number) {
  assert.ok(validDeck(deck) && validDeck(enemy))
  const kit = kits.get(variant)!
  const cards = focal ? [enemy,deck] : [deck,enemy]
  const game = new kit.Duel(cards[0], cards[1], { twoHumans: true, rng: random(seed) })
  const choose = mode === 'strong' ? kit.chooseStrongNpc : kit.chooseNpc
  const stats = empty()
  const used = new Set<number>()
  const overflowNights = new Set<number>()
  const name = focal ? 'NPC' : 'プレイヤー'
  let accounted = 0, steps = 0, resolving = false, nightLog = 0
  while (game.phase !== 'finished') {
    assert.ok(++steps < 250, 'Match failed to finish')
    if (game.phase === 'select') {
      stats.hand += game.players[focal].hand.length
      stats.handSamples++
      const move = sides.map(side => choose(game.strongNpcView(side),
        random(seed ^ Math.imul(game.night,0x9e3779b9) ^ (side === focal ? 0x529527ab : 0x37afa453))))
      assert.ok(move.every(entries => entries.length <= 2))
      stats.two += Number(move[focal].length === 2)
      stats.turns++
      nightLog = game.log.length
      assert.ok(game.lockBoth([move[0],move[1]]))
      stats.uses += game.revealed[focal].filter(entry => entry.role === 'merchant').length
      game.resolve()
      resolving = true
    } else if (game.prompt) {
      const p = game.prompt
      const player = game.players[p.side]
      if (p.side === focal && p.title.startsWith('手札上限')) {
        stats.overflow++
        stats.overflowPeak = Math.max(stats.overflowPeak, player.hand.length)
        overflowNights.add(game.night)
      }
      if (p.side === focal && p.title.startsWith('共有者')) stats.masonDiscards++
      const direction = p.title.includes('回収') ? -1 : 1
      const rank = (role: Role) => direction * promptRank(role, player.hp, player.status.noHeal, player.discard.length)
      const recoveredMerchant = stressRecovery && p.side === focal && p.title.startsWith('霊媒師')
        ? p.options.find(entry => entry.role === 'merchant') : undefined
      assert.ok(game.answer((recoveredMerchant ?? [...p.options].sort((a,b) => rank(a.role)-rank(b.role))[0]).id))
    } else assert.ok(game.nextNight())
    if (resolving && (!game.prompt || game.phase === 'finished')) {
      const { lost } = game.nightHpChange(focal)
      stats.damage += lost
      if (game.log.slice(nightLog).some(e => e.text.startsWith('@cost:'+focal+':'))) {
        for (const c of game.revealed[focal].filter(c=> c.role === 'merchant' && !c.disabled)) {
          stats.reuse += Number(used.has(c.id))
          used.add(c.id)
        }
      }
      resolving = false
    }
    for (;accounted < game.log.length;accounted++) {
      const {text} = game.log[accounted]
      if (text.startsWith('@')) {
        const [key, side, amount] = text.split(':')
        if (Number(side)!==focal) continue
        if (key==='@merchant') stats.drawn += Number(amount)
        if (key==='@recovery') stats.recovered += Number(amount)
        if (key==='@cost') stats.cost += Number(amount)
        if (key==='@heal') stats.heal += Number(amount)
      } else if (text.startsWith(name+'は捨て札をシャッフル')) stats.recycle++
      else if (text.startsWith(name+'の回復は呪術師に無効化')) stats.curseStops++
    }
  }
  for (const p of game.players) assert.equal(new Set([...p.hand,...p.deck,...p.discard].map(c=>c.id)).size,20)
  stats.games = 1
  stats.wins = Number(game.winner===focal)
  stats.draws = Number(game.winner==='draw')
  stats.hp = game.players[focal].hp
  stats.enemyHp = game.players[1-focal].hp
  stats.ko = Number(game.players.some(p=>p.hp===0))
  stats.final = Number(game.night===15&&!stats.ko)
  stats.overflowNights = overflowNights.size
  stats.recycleGames = Number(stats.recycle>0)
  stats.curseGames = Number(stats.curseStops>0)
  stats.curseWins = stats.curseGames*stats.wins
  stats.repeatGames = Number(stats.reuse>0)
  stats.reuseWins = stats.repeatGames*stats.wins
  return stats
}

const seeds = Number(process.argv[2] ?? 24)
assert.ok(Number.isSafeInteger(seeds) && seeds>0)
const rows = []
for (const name of stressRecovery ? ['霊媒師','全支援攻撃','全支援防御'] : Object.keys(packages)) {
  for (const [oppIndex, opponent] of opponents.entries()) for (const mode of modes) for (const copies of stressRecovery ? [2] : [0,1,2]) {
    const deck = tested(name,copies)
    for (const variant of copies ? variants : ['A'] as const) {
      const totals = empty()
      const wins = []
      for (let i=0;i<seeds;i++) {
        const seed=(0xa83dbc1b + Math.imul(i,0x9e3779b9) + Math.imul(oppIndex,0x10f3))>>>0
        const enemy=opposing(opponent,seed)
        let pair=0
        for (const side of sides) {
          const result=play(deck,enemy,variant,mode,side,seed)
          for (const key of Object.keys(result) as (keyof Totals)[]) {
            if (key==='overflowPeak') totals[key]=Math.max(totals[key],result[key])
            else totals[key]+=result[key]
          }
          pair+=result.wins/2
        }
        wins.push(pair)
      }
      rows.push({ name, opponent, mode, copies, variant, totals, wins })
    }
  }
  console.log(name,rows.length)
}
writeFileSync(process.argv[3] ?? 'reports/merchant-balance-followup-data.json',JSON.stringify({seeds,baseline,stressRecovery,rows,fixed,deckExamples:Object.fromEntries(Object.keys(packages).map(name=>[name,tested(name,2)]))}))
