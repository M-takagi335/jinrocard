import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { ROLES, card } from '../src/cards.ts'

const variants = ['A', 'B', 'C', 'D']
const modes = ['legacy', 'improved']
const sets = modes.flatMap(mode => variants.map(variant => {
  const raw = readFileSync(new URL('../reports/intel-' + mode + '-' + variant + '.json', import.meta.url), 'utf8')
  const data = JSON.parse(raw)
  assert.equal(data.variant, variant)
  assert.equal(data.mode, mode)
  assert.equal(data.samples, 500)
  assert.equal(data.matches.length, data.lineup.length * (data.lineup.length + 1) / 2)
  for (const row of data.matches) {
    for (const sides of [row.forward, row.reverse]) {
      assert.ok(sides.every(stat => stat.games === data.samples))
      assert.equal(sides[0].draws, sides[1].draws)
      assert.equal(sides[0].wins + sides[1].wins + sides[0].draws, data.samples)
    }
  }
  return data
}))
const [first] = sets
const baseIds = new Set(['rush', 'defense', 'hex', 'intel', 'recovery', 'balanced'])
const version = mode => mode === 'legacy' ? '従来AI' : '改善AI'
const pct = (num, den) => den ? (100 * num / den).toFixed(2) + '%' : '—'
const avg = (num, den) => den ? (num / den).toFixed(2) : '—'
const add = (a, b) => Object.fromEntries(Object.keys(a).map(key => [key, a[key]+(b[key] ?? 0)]))
const left = row => add(row.forward[0],row.reverse[1])
const right = row => add(row.forward[1],row.reverse[0])
const all = data => data.matches.flatMap(row => [left(row), right(row)]).reduce(add)
const per = (data, index, filter = () => true) => data.matches.filter(filter).flatMap(row => [
  ...(row.i === index ? [left(row)] : []), ...(row.j === index ? [right(row)] : []),
]).reduce(add)
function versus(data, a, b) {
  const row = data.matches.find(({i,j}) => i === Math.min(a,b) && j === Math.max(a,b))
  return a === b ? add(left(row),right(row)) : row.i === a ? left(row) : right(row)
}
const idx = id => first.lineup.findIndex(entry => entry.id === id)
const sameOpponent = ({i,j}, target, allowed) =>
  (i === target && allowed.has(first.lineup[j].id)) || (j === target && allowed.has(first.lineup[i].id))
const matched = (data, id, allowed) => per(data, idx(id), row => sameOpponent(row, idx(id), allowed))
const otherFamilies = style => new Set(first.lineup.filter(d => d.style !== style).map(d => d.id))
const win = s => pct(s.wins,s.games)
const table = (columns, rows) => ['| '+columns.join(' | ')+' |','| '+columns.map(()=>'---').join(' | ')+' |',
  ...rows.map(row=>'| '+row.join(' | ')+' |')].join('\n')
const total = sets.reduce((n,s)=>n+s.matches.length*s.samples*2,0)
const commonIntel = new Set([...baseIds].filter(id=>id!=='intel'))
const summary = [
  '# 情報系カードと手札補充の比較結果',
  '対戦は各条件105組、1組500シード×席順2通りで105,000試合。8条件の合計は ' + total.toLocaleString('ja-JP') + ' 試合。同型戦を含む。表の勝率は引き分け込みの総試合を分母とする。',
  '## A〜Dの総括',
  table(['AI','設定','情報・基準 対異型','情報＋暗殺者支援 対異型','情報＋攻撃 対異型','耐久・基準 対異型','耐久・基準 対情報・基準','平均夜','HP0','最終夜HP判定','1枚','2枚','調査あり暗殺者 的中/件数'],sets.map(data=>{
    const m=all(data)
    const i=otherFamilies('intel'), d=otherFamilies('defense')
    return [version(data.mode),data.variant,win(matched(data,'intel',i)),win(matched(data,'intelAssassin',i)),win(matched(data,'intelAttack',i)),
      win(matched(data,'defense',d)),win(versus(data,idx('defense'),idx('intel'))),avg(m.nights,m.games),
      pct(m.ko,m.games),pct(m.hpDecision,m.games),pct(m.one,m.turns),pct(m.two,m.turns),
      pct(m.assistedHits,m.assisted)+' / '+m.assisted]
  })),
  '## 構成・カード・AIを切り分ける比較',
  '情報3構成を同じ基準デッキ5種類と当てた勝率。情報系の枠以外を置き換えたため、構成差には入れ替えたカードすべての影響を含む。',
  table(['AI','設定','情報・基準','情報＋暗殺者支援','情報＋攻撃','情報・基準 対耐久','情報＋暗殺者支援 対耐久','情報＋攻撃 対耐久'],sets.map(data=>[
    version(data.mode),data.variant,...['intel','intelAssassin','intelAttack'].map(id=>win(matched(data,id,commonIntel))),
    ...['intel','intelAssassin','intelAttack'].map(id=>win(versus(data,idx(id),idx('defense')))),
  ])),
  '前回と同じ基準6デッキだけを抽出したAの指標（同型含む）。',
  table(['AI','耐久勝率','情報勝率','耐久 対情報','2枚出し率'],sets.filter(data=>data.variant==='A').map(data=>{
    const reduced = {...data, matches:data.matches.filter(row=>baseIds.has(first.lineup[row.i].id)&&baseIds.has(first.lineup[row.j].id))}
    const m=all(reduced)
    return [version(data.mode),win(per(reduced,idx('defense'))),win(per(reduced,idx('intel'))),win(versus(data,idx('defense'),idx('intel'))),pct(m.two,m.turns)]
  })),
  '## デッキ構成',
  table(['デッキ','役職別の20枚'],first.lineup.map(deck=>[deck.label,ROLES.flatMap(role=>{
    const n=deck.cards.filter(r=>r===role).length
    return n?[card(role).name+'×'+n]:[]
  }).join('、')])),
  '## 条件別集計',
  '使用率は公開カード全枚数に占める割合。使用後勝率は、そのカードを1回以上公開した側の勝率（無効化や決着による未発動も含む）。暗殺者は無効化されず予想を指定した試行だけを計測し、「調査あり」は予想役職に本人の調査由来の記憶が残っていた試行。勝率や的中率は条件付きの観察値で、使用や調査の因果効果を示さない。',
  '平均手札は夜の選択直前、再構築は1人1試合あたり。HP0の同時引分けと最終夜の同HP引分けは、対応する決着方法に数える。1枚・2枚出し率の分母はパスを含む全夜。',
]
for (const data of sets) {
  const labels=data.lineup.map((d,i)=>(i+1)+'. '+d.label)
  summary.push('### '+version(data.mode)+' '+data.variant)
  summary.push(table([
    'デッキ','試合','勝率','引分','夜','HP0','最終HP判定','終了HP','1枚','2枚','平均手札','再構築','占い師率','占い使用後勝率 (n)',
    '預言者率','預言使用後勝率 (n)','暗殺者全的中 (n)','調査あり的中 (n)',
  ],data.lineup.map((deck,i)=>{
    const s=per(data,i)
    const withN=(n,d)=>d?pct(n,d)+' ('+d+')':'—'
    return [labels[i],s.games,win(s),pct(s.draws,s.games),avg(s.nights,s.games),pct(s.ko,s.games),pct(s.hpDecision,s.games),
      avg(s.hp,s.games),pct(s.one,s.turns),pct(s.two,s.turns),avg(s.hand,s.turns),avg(s.reshuffle,s.games),
      pct(s.seer,s.plays),withN(s.seerWins,s.seerGames),pct(s.prophet,s.plays),withN(s.prophetWins,s.prophetGames),
      withN(s.hits,s.assassin),withN(s.assistedHits,s.assisted)]
  })))
  summary.push(table(['行側の勝率',...labels.map((_,i)=>String(i+1))], labels.map((label,i)=>[
    label,...labels.map((_,j)=>win(versus(data,i,j))),
  ])))
}
writeFileSync(new URL('../reports/intel-balance-tables.md',import.meta.url),summary.join('\n\n')+'\n')
console.log(total.toLocaleString('ja-JP')+' trials verified')
