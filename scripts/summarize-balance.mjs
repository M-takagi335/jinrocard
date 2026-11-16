import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { ROLES, card } from '../src/cards.ts'

const labels = { rush: '速攻', defense: '耐久', hex: '妨害', intel: '情報', recovery: '回収', balanced: 'バランス' }
const styles = Object.keys(labels)
const ruleRows = [0, 2, 3].flatMap(refill => [3, 4].map(heal => {
  const data = JSON.parse(readFileSync(new URL('../reports/balance-' + refill + '-' + heal + '.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
  assert.equal(data.refill, refill)
  assert.equal(data.heal, heal)
  assert.ok(data.trials >= 1000)
  assert.equal(data.matrix.length, 21)
  for (const row of [...data.matrix, ...data.tempo, ...data.oneVsTwo, ...data.cycle, ...data.cyclePriority]) {
    assert.ok([...row.forward, ...row.reverse].every(stat => stat.games === data.trials))
  }
  return data
}))
const current = ruleRows.find(row => row.refill === 3 && row.heal === 4)
const rate = (x,y) => (x / y * 100).toFixed(1) + '%'
const mean = (x,y) => (x / y).toFixed(2)
const numeric = (a,b) => Object.fromEntries(Object.keys(a).filter(k=>typeof a[k] === 'number').map(k=>[k,a[k]+b[k]]))
const merged = (a,b) => ({ ...numeric(a,b), usage:numeric(a.usage,b.usage), disabled:numeric(a.disabled,b.disabled) })
const left = row => merged(row.forward[0], row.reverse[1])
const right = row => merged(row.forward[1], row.reverse[0])
const combined = rows => rows.reduce(merged)
const format = (columns, rows) => [
  '| ' + columns.join(' | ') + ' |',
  '| ' + columns.map(()=>'---').join(' | ') + ' |',
  ...rows.map(row=>'| '+row.join(' | ')+' |'),
].join('\n')
const group = (matrix, style) => combined(matrix.flatMap(row => {
  if (row.a.style === style && row.b.style === style) return [left(row), right(row)]
  if (row.a.style === style) return [left(row)]
  if (row.b.style === style) return [right(row)]
  return []
}))
const global = data => combined(data.matrix.flatMap(r => [left(r), right(r)]))
const countTrials = data => [...data.matrix, ...data.tempo, ...data.oneVsTwo, ...data.cycle, ...data.cyclePriority]
  .reduce((n,row) => n + row.forward[0].games + row.reverse[0].games, 0)
const totalGames = ruleRows.reduce((n,r) => n + countTrials(r), 0)
const win = stat => rate(stat.wins,stat.games)
const heading = ['デッキ', '試合', '勝率', '引分率', '平均決着夜', '終了HP', '1夜の使用枚数', '2枚出し率']
const matchup = styles.flatMap(a => styles.filter(b => b !== a).map(b => {
  const row = current.matrix.find(r=>r.a.style===a&&r.b.style===b || r.a.style===b&&r.b.style===a)
  const stat = row.a.style===a ? left(row) : right(row)
  const forward = row.a.style===a ? row.forward[0] : row.reverse[0]
  const reverse = row.a.style===a ? row.reverse[1] : row.forward[1]
  return { a,b,stat,forward,reverse }
})).sort((a,b) => b.stat.wins/b.stat.games-a.stat.wins/a.stat.games)
const strongest = matchup.slice(0,5)
const sections = [
  '# 人狼デュエル バランス検証の集計',
  '元のゲームコードはコミット `348a846`。試合はすべてローカルのゲームエンジンで完走。合計 ' + totalGames.toLocaleString('ja-JP') + ' 試合。',
  '## 6デッキの構成',
  format(['デッキ','20枚の内訳'], styles.map(style => [labels[style],ROLES.flatMap(role=>{
    const count = current.decks[style].filter(r=>r===role).length
    return count ? [card(role).name+'×'+count] : []
  }).join('、')])),
  '## 現行設定の集計',
  '勝率は引き分けを勝利に含めず全試合を分母とした。終了HPは敗戦の0を含む。相性表の対角も左右各1,000試合。デッキ別の集計では同型戦の両側を含む。',
  format(heading, styles.map(style=>{
    const s = group(current.matrix, style)
    return [labels[style],s.games,win(s),rate(s.draws,s.games),mean(s.nights,s.games),mean(s.hp,s.games),mean(s.plays,s.turns),rate(s.two,s.turns)]
  })),
  format(['行側の勝率',...styles.map(s=>labels[s])], styles.map(a=>[labels[a],...styles.map(b=>{
    if(a===b)return win(group(current.matrix.filter(row=>row.a.style===a&&row.b.style===a),a))
    return win(matchup.find(row=>row.a===a&&row.b===b).stat)
  })])),
  format(['上位の相性','左右合算','左席','右席','引分率','決着夜','終了HP（行側 / 相手）'], strongest.map(row=>{
    const inverse = matchup.find(r=>r.a===row.b&&r.b===row.a)
    return [labels[row.a]+' 対 '+labels[row.b],win(row.stat),win(row.forward),win(row.reverse),rate(row.stat.draws,row.stat.games),
      mean(row.stat.nights,row.stat.games),mean(row.stat.hp,row.stat.games)+' / '+mean(inverse.stat.hp,inverse.stat.games)]
  })),
  '## カード使用率',
  '各カードの公開枚数 ÷ そのデッキが公開した総枚数。無効化されたカードも含む。0回は「—」。再利用されたカードは使うたびに数える。',
  format(['役職',...styles.map(s=>labels[s])], ROLES.map(role=>[card(role).name,...styles.map(style=>{
    const m = group(current.matrix,style)
    return m.usage[role] ? rate(m.usage[role],m.plays) : '—'
  })])),
  '## 手札補充・魔女の回復量比較',
  '各設定につき6デッキの組み合わせ21通りを左右各1,000試合。魔女の回復量は検証プロセス内で上書きし、終了時に元の値へ戻す。',
  format(['補充','魔女回復','総試合（追加実験含む）','平均決着夜','終了HP','HP0決着率','補充/人/試合','2枚出し率',...styles.map(s=>labels[s]+'勝率')],ruleRows.map(row=>{
    const g = global(row)
    return [row.refill,row.heal,countTrials(row),mean(g.nights,g.games),mean(g.hp,g.games),rate(g.ko,g.games),
      mean(g.refill,g.games),rate(g.two,g.turns),...styles.map(s=>win(group(row.matrix,s)))]
  })),
  '## 2枚出しの比較（魔女4）',
  '同じデッキを使用。2枚固定は、手札と独裁者の制限が許す限り最善の2枚を選ぶ。選択型は手札を残す判断も行う。1枚固定・選択型との各比較は左右各1,000試合。',
  format(['補充','デッキ','2枚固定 対 選択型','2枚固定 対 1枚固定','2枚固定の補充/試合','選択型の補充/試合'],ruleRows.filter(r=>r.heal===4).flatMap(row=>row.tempo.map((r,i)=>{
    const a = left(r), b = right(r)
    return [row.refill,labels[r.a.style],win(a),win(left(row.oneVsTwo[i])),mean(a.refill,a.games),mean(b.refill,b.games)]
  }))),
  '## 魔女＋霊媒師の比較',
  '回収型の20枚を固定し、左の比較では通常の選択方針、右では魔女が捨て札にあり、手札に魔女がなく、回復可能な場合に回収を高く評価する。勝率・実回復HP・魔女を戻した回数はいずれも回収型側。',
  format(['補充','魔女回復','相手','通常勝率','回収優先勝率','通常回復HP','優先回復HP','通常の魔女回収/試合','優先の魔女回収/試合'], ruleRows.flatMap(row=>row.cycle.map((r,i)=>{
    const a=left(r), b=left(row.cyclePriority[i])
    return [row.refill,row.heal,labels[r.b.style],win(a),win(b),mean(a.healed,a.games),mean(b.healed,b.games),
      mean(a.witchReturns,a.games),mean(b.witchReturns,b.games)]
  }))),
  '## 再実行',
  'Node.js 22.18以降。補充は0、2、3、回復量は3、4。各組み合わせを実行し、同じファイル名へ出力する。',
  '```powershell\nforeach ($refill in 0,2,3) {\n  foreach ($heal in 3,4) {\n    node --disable-warning=ExperimentalWarning --experimental-strip-types scripts/balance.ts $refill $heal 1000 | Set-Content "reports/balance-$refill-$heal.json" -Encoding utf8\n    if ($LASTEXITCODE -ne 0) { throw "Simulation failed" }\n  }\n}\nnode --disable-warning=ExperimentalWarning --experimental-strip-types scripts/summarize-balance.mjs\nnpm test\n```',
]
writeFileSync(new URL('../reports/balance-tables.md',import.meta.url),sections.join('\n\n')+'\n')
console.log(totalGames + ' verified trials across six scenarios')
