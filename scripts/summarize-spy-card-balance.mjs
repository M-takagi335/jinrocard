import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const inputs=process.argv.slice(2)
assert.ok(inputs.length>=1, 'Pass final JSONL, then optional strongest JSONL')
const rows=inputs.flatMap(path=>readFileSync(path,'utf8').trim().split(/\r?\n/).map(JSON.parse))
const modes=[...new Set(rows.map(x=>x.mode))]
for(const mode of modes) assert.equal(rows.filter(x=>x.mode===mode).length,98,'Incomplete result: '+mode)
const groups=['0','S1','S2','J1','J2','S1J1','S2J2']
const allies=rows.filter(r=>r.mode!=='strongest')
const styles=[...new Set(rows.map(x=>x.opponent))]
const bases=[...new Set(rows.map(x=>x.baseName))]
const variants=['A','B','adjusted']
const sum=values=>values.reduce((a,b)=>a+b,0)
const rate=(n,d)=>d?(100*n/d).toFixed(2)+'%':'—'
const avg=(n,d)=>d?(n/d).toFixed(3):'—'
const stats=(xs,v,against)=>{
  const applicable=xs.filter(x=>x.totals[v] && (!against || x.totals[against]))
  if(!applicable.length)return '—'
  const games=sum(applicable.map(x=>x.games))
  const wins=sum(applicable.map(x=>x.totals[v].wins))
  const draws=sum(applicable.map(x=>x.totals[v].draws))
  const pairedGroups=Map.groupBy(applicable,x=>x.mode==='strongest'?'strongest':'main')
  let variance=0
  for(const group of pairedGroups.values()){
    const seeds=group[0].games/2
    const values=Array.from({length:seeds},(_,i)=>sum(group.map(x=>x.totals[v].pairWins[i]-(against?x.totals[against].pairWins[i]:0))))
    const mean=sum(values)/seeds
    variance+=seeds*sum(values.map(x=>(x-mean)**2))/Math.max(1,seeds-1)
  }
  const diff=wins-(against?sum(applicable.map(x=>x.totals[against].wins)):0)
  const half=1.96*Math.sqrt(variance)/games
  const range=[diff/games-half,diff/games+half].map(n=>(100*(against?n:Math.max(0,Math.min(1,n)))).toFixed(2)).join('〜')
  if(against)return (100*diff/games).toFixed(2)+'pt ['+range+']'
  return rate(wins,games)+' ['+range+']／'+wins+'勝 '+(games-wins-draws)+'敗 '+draws+'分'
}
const table=(headers,body)=>{
  console.log('| '+headers.join(' | ')+' |\n| '+headers.map(()=> '---').join(' | ')+' |')
  for(const row of body)console.log('| '+row.join(' | ')+' |')
  console.log()
}
const compare=xs=>[...variants.map(v=>stats(xs,v)),stats(xs,'B','A'),stats(xs,'adjusted','B')]
const metric=(xs,v,role,bucket)=>{
  const source=xs.filter(x=>x.totals[v]).flatMap(x=>x.totals[v].rows[role].filter((_,i)=>bucket===undefined||bucket===i))
  return Array.from({length:rows[0].units.length},(_,i)=>sum(source.map(x=>x[i])))
}
const details=(xs,v,role,bucket)=>{
  const [used,checked,hit,drawn,refill,ends,net,offset,overflow,recycle,windows,hitWindows,hitEnds,missWindows,missEnds]=metric(xs,v,role,bucket)
  return [used,checked,hit,rate(hit,checked),drawn,refill,avg(ends,windows),avg(net,hitWindows),rate(offset,drawn),overflow,recycle,avg(hitEnds,hitWindows),avg(missEnds,missWindows)]
}
const mixed=allies.filter(x=>x.totals.B)
const controls=allies.filter(x=>x.build==='J1'||x.build==='J2')
const headers=['A','B（判断固定）','B（判断調整）','B−A','調整−固定']
console.log('## 採用枚数別の勝率\n')
table(['構成',...headers],groups.map(g=>[g,...compare(allies.filter(x=>x.build===g))]))
console.log('## 難易度・相手・デッキ土台別\n')
table(['条件',...headers],[['主分析全体',...compare(mixed)],...modes.map(m=>[m,...compare(rows.filter(x=>x.mode===m&&x.totals.B))]),
  ...styles.map(s=>[s,...compare(mixed.filter(x=>x.opponent===s))]),
  ...bases.map(b=>[b,...compare(mixed.filter(x=>x.baseName===b))])])
console.log('## 密偵と道化師の相性\n')
table(['相手','相手の攻撃札提出率（A）','A 密偵1・2','B 密偵1・2','道化師1・2','密偵A 成立率','密偵B 成立率','道化師 成立率'],styles.map(o=>{
  const s=allies.filter(x=>x.opponent===o&&['S1','S2'].includes(x.build))
  const j=controls.filter(x=>x.opponent===o)
  const trigger=(r,v,role)=>{const m=metric(r,v,role);return rate(m[2],m[1])}
  return [o,rate(sum(s.map(x=>x.totals.A.attacks)),sum(s.map(x=>x.totals.A.rounds))),stats(s,'A'),stats(s,'B'),stats(j,'A'),
    trigger(s,'A','spy'),trigger(s,'B','spy'),trigger(j,'A','jester')]
}))
console.log('## 自動補充を分離した手札計測\n')
const effectHeaders=['提出','条件判定','成立','成立率','追加ドロー計','自動補充計','平均夜末手札','純増／成立夜','補充で相殺','上限破棄','夜内再利用','成立時夜末','不成立時夜末']
table(['条件',...effectHeaders],[
  ...variants.map(v=>['密偵 '+v,...details(mixed,v,'spy')]),
  ['道化師のみ',...details(controls,'A','jester')],
  ...variants.map(v=>['混合デッキの道化師 '+v,...details(mixed,v,'jester')])
])
table(['案','提出直後の残り',...effectHeaders],['A','B'].flatMap(v=>Array.from({length:5},(_,b)=>[v,b===4?'4以上':b,...details(mixed,v,'spy',b)])))
console.log('## 試合数\n')
table(['難易度','試合数'],modes.map(m=>[m,sum(rows.filter(x=>x.mode===m).map(x=>x.games*Object.keys(x.totals).length))]))
