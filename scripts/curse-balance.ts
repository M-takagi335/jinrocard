import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { card, STARTER, validDeck, type Role } from '../src/cards.ts'
import { chooseNpc, type Duel, type Side } from '../src/duel.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { promptRank, random } from './balance.ts'

const engineUrl = new URL('../src/duel.ts', import.meta.url)
const engineSource = readFileSync(engineUrl, 'utf8')
function replaceOnce(source: string, target: string, replacement: string) {
  assert.equal(source.split(target).length, 2, 'Engine implementation changed: ' + target)
  return source.replace(target, replacement)
}
async function engine(timing: 'A' | 'B') {
  // Evaluate a separate copy for this script only. Preserve the engine's order, RNG and public views.
  let source = engineSource.replace(/from '(\.\/[^']+)'/g, (_, path: string) => "from '" + new URL(path, engineUrl).href + "'")
  if (timing === 'B') source = replaceOnce(source, 'p.next.noHeal=true', 'p.status.noHeal=true')
  const blocked = "if(p.status.noHeal) this.write(who[i]+'の回復は呪術師に無効化された。')"
  source = replaceOnce(source, blocked, `if(p.status.noHeal) {
    this.write(who[i]+'の回復は呪術師に無効化された。')
    this.write('curse-balance:' + i + ':' + count(i,'witch') + ':' +
      Math.min(this.rules.hp-p.hp,count(i,'witch')*card('witch').power!))
  }`)
  const code = stripTypeScriptTypes(source, { mode: 'strip' })
  return (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')) as { Duel: typeof Duel }).Duel
}

const variants = { A: await engine('A'), B: await engine('B') }
const lineups: Record<string, Role[]> = {
  標準寄り: STARTER.map(role => role === 'curse' ? 'knight' : role),
  襲撃重視: ['wolf','wolf','wolf','dire','dire','fox','fox','assassin','cat','hunter','hunter','knight','witch','witch',
    'trap','spy','mason','mad','jester','medium'],
  耐久重視: ['wolf','wolf','wolf','dire','fox','cat','cat','hunter','hunter','hunter','knight','knight','witch','witch',
    'trap','trap','medium','medium','mad','spy'],
}
const controlOpponent: Role[] = [...lineups.耐久重視]
const opponents: Record<string, Role[]> = {
  魔女2枚: controlOpponent,
  魔女0枚: controlOpponent.map((role, index) => role === 'witch' ? index % 2 ? 'mason' : 'seer' : role),
}
const replacements: Record<string, Role[]> = {
  標準寄り: ['spy', 'mason'],
  襲撃重視: ['jester', 'medium'],
  耐久重視: ['spy', 'medium'],
}
const sides = [0, 1] as const
const seat = (side: Side): Side => side === 0 ? 1 : 0
const seeds = Number(process.argv[2] ?? 180)
assert.ok(Number.isSafeInteger(seeds) && seeds > 0)

function verifyOrder() {
  for (const timing of ['A', 'B'] as const) {
    for (const disabled of [false, true]) {
      const DuelType = variants[timing]
      const drawOrder: Role[] = ['curse','wolf','hunter','knight','seer','spy','wolf','witch','cat','fox','dire','assassin',
        'mason','mad','medium','merchant','jester','prophet','keeper','trap']
      const reply: Role[] = ['witch','witch','mad','wolf','fox','hunter','knight','seer','spy','cat','dire','assassin','mason',
        'curse','medium','merchant','jester','prophet','keeper','trap']
      // Use no shuffle, then force Mad to disable the first committed card.
      let calls = 0
      const game = new DuelType(drawOrder, reply, { twoHumans: true, rng: () => ++calls <= 38 ? .9999 : 0 })
      game.players[1].hp = 18
      const id = (side: Side, role: Role) => ({ id: game.players[side].hand.find(entry => entry.role === role)!.id })
      assert.ok(game.lockBoth([[id(0,'curse'), id(0,'wolf')], disabled ? [id(1,'witch'), id(1,'mad')] : [id(1,'witch')]]))
      game.resolve()
      assert.equal(game.players[1].hp, timing === 'B' && !disabled ? 15 : 19)
      assert.ok(game.nextNight())
      assert.ok(game.lockBoth([[id(0,'hunter')],[id(1,'witch')]]))
      game.resolve()
      assert.equal(game.players[1].hp, timing === 'A' && !disabled ? 19 : timing === 'B' && !disabled ? 19 : 20)
    }
  }
}
verifyOrder()

type Mode = 'standard' | 'strong'
type Timing = keyof typeof variants
function run(deck: Role[], opponent: Role[], mode: Mode, timing: Timing, seed: number, focal: Side) {
  const target = seat(focal)
  const lineup = focal === 0 ? [deck, opponent] : [opponent, deck]
  const game = new variants[timing](lineup[0], lineup[1], { twoHumans: true, rng: random(seed) })
  const choose = mode === 'strong' ? chooseStrongNpc : chooseNpc
  const windows = new Set<number>()
  const matches = new Set<number>()
  let uses = 0, withheld = 0, witches = 0, blocked = 0, raidUses = 0, raidHits = 0, cursor = 0, lastResolved = 0
  const raidWindows = new Set<number>()
  let steps = 0
  while (game.phase !== 'finished') {
    assert.ok(++steps < 250, 'Duel failed to finish')
    if (game.phase === 'select') {
      // Independent, reproducible decision RNG per participant and night.
      const plays = sides.map(side => choose(game.strongNpcView(side),
        random(seed ^ Math.imul(game.night, 0x9e3779b9) ^ (side === focal ? 0x529527ab : 0x37afa453))))
      assert.ok(game.lockBoth([plays[0], plays[1]]))
      game.resolve()
    } else if (game.prompt) {
      const prompt = game.prompt
      const player = game.players[prompt.side]
      const sign = prompt.title.includes('回収') ? -1 : 1
      const rank = (role: Role) => sign * promptRank(role, player.hp, player.status.noHeal, player.discard.length)
      assert.ok(game.answer([...prompt.options].sort((a,b) => rank(a.role) - rank(b.role))[0].id))
    } else assert.ok(game.nextNight())

    if (game.night !== lastResolved && game.revealed[focal].length && game.phase !== 'select') {
      lastResolved = game.night
      const enabled = game.revealed[focal].filter(entry => !entry.disabled)
      const curses = enabled.filter(entry => entry.role === 'curse').length
      if (curses) {
        uses += curses
        const window = game.night + Number(timing === 'A')
        windows.add(window)
        if (enabled.some(entry => entry.role === 'wolf' || entry.role === 'dire')) {
          raidUses++
          raidWindows.add(window)
        }
      }
    }
    for (; cursor < game.log.length; cursor++) {
      const entry = game.log[cursor]
      if (!entry.text.startsWith('curse-balance:' + target + ':')) continue
      const [, , count, hp] = entry.text.split(':').map(Number)
      witches += count
      blocked++
      withheld += hp
      if (hp > 0) {
        matches.add(entry.night)
        raidHits += Number(raidWindows.has(entry.night))
      }
    }
  }
  assert.ok([...matches].every(night => windows.has(night)))
  return { wins: Number(game.winner === focal), draws: Number(game.winner === 'draw'), uses,
    windows: windows.size, hits: matches.size, blocked, witches, withheld, raidUses, raidHits }
}

for (const mode of ['standard', 'strong'] as const) for (const [name, base] of Object.entries(lineups)) {
  for (const [opponentName, opponent] of Object.entries(opponents)) {
    for (const copies of [0, 1, 2]) {
      const deck = [...base]
      for (const role of replacements[name].slice(0, copies)) deck[deck.indexOf(role)] = 'curse'
      assert.ok(validDeck(deck) && validDeck(opponent))
      const totals = {} as Record<Timing, ReturnType<typeof run>>
      for (const timing of (copies ? ['A', 'B'] : ['A']) as Timing[]) {
        for (let i = 0; i < seeds; i++) for (const focal of sides) {
          const simulation = run(deck, opponent, mode, timing, (0x34768a33 + Math.imul(i, 0x9e3779b9)) >>> 0, focal)
          if (!totals[timing]) totals[timing] = simulation
          else for (const key of Object.keys(simulation) as (keyof typeof simulation)[]) totals[timing][key] += simulation[key]
        }
      }
      console.log(JSON.stringify({ mode, name, opponent: opponentName, copies, games: 2 * seeds, ...totals }))
    }
  }
}
