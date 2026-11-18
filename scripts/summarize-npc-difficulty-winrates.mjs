import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const rows=readFileSync(process.argv[2],'utf8').trim().split(/\r?\n/).map(JSON.parse)
const levels={easy:'やさしい',standard:'標準',strong:'強い',strongest:'最強'}
const labels={standard:'標準同士','random-mirror':'ランダム同一','random-independent':'ランダム独立',
  rush:'速攻同一',defense:'耐久同一',intel:'情報同一','rush-defense':'速攻×耐久',
  'rush-intel':'速攻×情報','defense-intel':'耐久×情報'}
const codes=Object.keys(levels)
const pairKeys=[...new Set(rows.map(r=>r.pair.join('/')))].sort()
const groups=[['standard'],['random-mirror','random-independent'],['rush'],['defense'],['intel'],
  ['rush-defense','rush-intel','defense-intel']]
const sum=values=>values.reduce((a,b)=>a+b,0)
const number=(x,digits=2)=>x.toFixed(digits)
const pct=x=>number(x*100)+'%'
const range=(lo,hi)=>'['+pct(Math.max(0,lo))+'〜'+pct(Math.min(1,hi))+']'
const mean=values=>sum(values)/values.length
const count=rows[0].samples.length
assert.equal(pairKeys.length,6)
assert.equal(rows.length,54)
assert.ok(rows.every(r=>r.samples.length===count&&r.games===count*4))
assert.equal(new Set(rows.map(r=>r.name+'|'+r.pair.join('/'))).size,rows.length)

const slices=(level,subset=rows)=>subset.filter(r=>r.pair.includes(level)).map(r=>({row:r,side:r.pair.indexOf(level)}))
function interval(values){
  const p=mean(values)
  const se=Math.sqrt(sum(values.map(v=>(v-p)**2))/(values.length*(values.length-1)))
  return pct(p)+' '+range(p-1.96*se,p+1.96*se)
}
function perSeed(xs,metric,weights=xs.map(()=>1/xs.length)){
  return Array.from({length:count},(_,i)=>sum(xs.map(({row,side},j)=>{
    const [win,draw]=row.samples[i][side]
    return weights[j]*(win+(metric==='score'?draw*.5:0))/4
  })))
}
function record(xs){
  const fields=Object.keys(xs[0].row.totals[0])
  return Object.fromEntries(fields.map(f=>[f,sum(xs.map(({row,side})=>row.totals[side][f]))]))
}
function wdl(xs){
  const m=record(xs)
  const games=m.win+m.loss+m.draw
  assert.equal(games,sum(xs.map(x=>x.row.games)))
  return [games,m.win,m.loss,m.draw,interval(perSeed(xs,'win')),pct(m.draw/games),interval(perSeed(xs,'score'))]
}
function balanced(xs,metric){
  const weights=xs.map(({row})=>{
    const description=groups.find(keys=>keys.includes(row.name))
    const opponents=xs.filter(x=>x.row.name===row.name).length
    return 1/(groups.length*description.length*opponents)
  })
  assert.ok(Math.abs(sum(weights)-1)<1e-9)
  return interval(perSeed(xs,metric,weights))
}
function table(headers,body){
  console.log('| '+headers.join(' | ')+' |')
  console.log('| '+headers.map(()=> '---').join(' | ')+' |')
  for(const row of body)console.log('| '+row.join(' | ')+' |')
  console.log()
}
const split=key=>key.split('/')
const subset=(a,b,conditions=rows)=>conditions.filter(r=>r.pair.includes(a)&&r.pair.includes(b))
const pairName=key=>split(key).map(x=>levels[x]).join(' vs ')
const cols=['試合','勝','負','分','勝率（95%区間）','引分率','得点率（95%区間）']
const sorted=[...codes].sort((a,b)=>mean(perSeed(slices(b),'score'))-mean(perSeed(slices(a),'score')))
console.log('## 総合ランキング\n')
table(['難易度',...cols,'6分類均等の勝率（95%区間）','6分類均等の得点率（95%区間）'],
  sorted.map(code=>{const xs=slices(code);return [levels[code],...wdl(xs),balanced(xs,'win'),balanced(xs,'score')]}))

const matrix=(title,conditions)=>{
  console.log('## '+title+'\n')
  table(['行の難易度',...Object.values(levels)],codes.map(a=>[levels[a],...codes.map(b=>{
    if(a===b)return '—'
    return interval(perSeed(slices(a,subset(a,b,conditions)),'win'))
  })]))
}
matrix('総当たり勝率',rows)
matrix('ランダム同一構成の勝率',rows.filter(r=>r.name==='random-mirror'))
matrix('ランダム独立構成の勝率',rows.filter(r=>r.name==='random-independent'))

console.log('## 6対戦の勝敗・得点率\n')
table(['行頭の難易度の成績',...cols],pairKeys.map(key=>{
  const [a,b]=split(key);return [pairName(key),...wdl(slices(a,subset(a,b)))]
}))

for(const [label,conditions] of [
  ['同一デッキの合計',['standard','random-mirror','rush','defense','intel']],
  ['異なる種類のデッキの合計',groups[5]],
  ['ランダム2条件の合計',groups[1]],
]){
  console.log('### '+label+'\n')
  const cells=rows.filter(r=>conditions.includes(r.name))
  table(['行頭の難易度の成績',...cols],pairKeys.map(key=>{
    const [a,b]=split(key);return [pairName(key),...wdl(slices(a,subset(a,b,cells)))]
  }))
}

for(const [name,label] of Object.entries(labels)){
  console.log('### '+label+'\n')
  const cells=rows.filter(r=>r.name===name)
  table(['行頭の難易度の成績',...cols],pairKeys.map(key=>{
    const [a,b]=split(key);return [pairName(key),...wdl(slices(a,subset(a,b,cells)))]
  }))
}
console.log('## 難易度別のプレイ指標\n')
const ratio=(a,b)=>b?pct(a/b):'—'
table(['難易度','平均夜','与ダメ／試合','被ダメ／試合','襲撃成功','防御成功','1枚','2枚','暗殺者的中','回復／試合',
  '魔女実効率','判断ms／手','最終HP'],codes.map(code=>{
  const xs=slices(code),m=record(xs),enemy=record(xs.map(x=>({...x,side:1-x.side})))
  const games=m.win+m.loss+m.draw
  return [levels[code],number(m.night/games),number(m.damage/games),number(enemy.damage/games),
    ratio(m.raidHit,m.raid),ratio(m.defended,m.defense),ratio(m.one,m.decisions),ratio(m.two,m.decisions),
    ratio(m.correct,m.guess),number(m.heal/games),ratio(m.heal,m.witch*4),number(m.ms/m.decisions,3),number(m.hp/games)]
}))
console.log('本試験 '+sum(rows.map(r=>r.games))+' 試合。')
