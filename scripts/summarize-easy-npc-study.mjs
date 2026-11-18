import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const rows=readFileSync(process.argv[2],'utf8').trim().split(/\r?\n/).map(JSON.parse)
assert.equal(rows.length,52,'Incomplete final run')
assert.ok(rows.every(r=>r.stage==='final'&&r.pairWins.length*2===r.games))
const leaders=['A','B','C','D','E']
const fixtures=[...new Set(rows.filter(x=>x.rival==='A').map(x=>x.name))]
const sum=items=>items.reduce((a,b)=>a+b,0)
const pct=(n,d)=>d?(100*n/d).toFixed(2)+'%':'—'
const avg=(n,d,places=2)=>d?(n/d).toFixed(places):'—'
function collect(xs){
  const add=field=>Object.fromEntries(Object.keys(xs[0][field]).map(k=>[k,sum(xs.map(r=>r[field][k]))]))
  const data=Object.fromEntries(['wins','draws','games','nights','hp','enemyHp','hpWin','hpDecision','ms'].map(k=>[k,sum(xs.map(r=>r[k]))]))
  return {...data,player:add('player'),enemy:add('enemy')}
}
// Group both seats and all reused fixtures by seed before estimating uncertainty.
function ci(xs, baseline){
  const total=sum(xs.map(r=>r.games))
  const seeds=xs[0].pairWins.length
  const paired=Array.from({length:seeds},(_,i)=>sum(xs.map(row=>row.pairWins[i]-(baseline?.find(b=>b.name===row.name).pairWins[i]??0))))
  const mean=sum(paired)/seeds
  const half=1.96*Math.sqrt(seeds*sum(paired.map(v=>(v-mean)**2))/Math.max(1,seeds-1))/total
  const estimate=sum(paired)/total
  const limits=[estimate-half,estimate+half].map(x=>100*(baseline?x:Math.max(0,Math.min(1,x))))
  return '['+limits.map(x=>x.toFixed(2)).join('〜')+']'
}
function wdl(xs,baseline){
  const m=collect(xs)
  const diff=baseline?m.wins-sum(baseline.map(x=>x.wins)):0
  return [m.games,m.wins,m.games-m.wins-m.draws,m.draws,pct(m.wins,m.games)+' '+ci(xs),pct(m.draws,m.games),
    baseline?(100*diff/m.games).toFixed(2)+'pt '+ci(xs,baseline):'—']
}
const table=(header,lines)=>{
  console.log('| '+ header.join(' | ')+' |')
  console.log('| '+ header.map(()=> '---').join(' | ')+' |')
  for(const line of lines)console.log('| '+line.join(' | ')+' |')
  console.log()
}
const vsA=leader=>rows.filter(x=>x.leader===leader&&x.rival==='A')
const baseline=vsA('A')
const headers=['試合','勝','負','分','勝率［95%区間］','引分率','A/Aとの差']
console.log('## 標準NPCとの全比較\n')
table(['方式',...headers],leaders.map(id=>[id,...wdl(vsA(id),id==='A'?null:baseline)]))
console.log('## デッキの組合せ別\n')
table(['候補側／相手側',...leaders],fixtures.map(name=>[name,...leaders.map(id=>{
  const xs=vsA(id).filter(x=>x.name===name)
  const data=wdl(xs)
  return data[4]+' ／ 分'+data[5]
})]))
console.log('各セルは384試合。A/Aには異なるデッキ同士も含むため、その総合値は50%前後に固定されない。\n')
console.log('## 攻撃が通る割合と対戦進行\n')
const combat=xs=>{
  const m=collect(xs),p=m.player,e=m.enemy
  return [pct(p.attack,p.nights),pct(p.raider,p.nights),pct(p.guardUsed,p.nights),pct(p.one,p.nights),pct(p.two,p.nights),
    pct(p.dualAttack,p.nights),avg(p.damage,m.games),avg(p.guard,m.games),pct(e.raidHit,e.raid),
    avg(e.raidPower,e.raid),avg(m.nights,m.games),avg(m.hp-m.enemyHp,m.games),pct(m.hpDecision,m.games),
    pct(m.hpWin,m.hpDecision),avg(m.ms,m.games,3)]
}
const combatHeader=['攻撃札の夜','襲撃札の夜','防御札の夜','1枚','2枚','攻撃2枚','与ダメ／試合','防いだ量／試合','相手の襲撃成功率','相手の通過襲撃値','平均夜','最終HP差','双方生存15夜','HP判定時勝率','シミュレーターms／試合']
table(['方式・条件',...combatHeader],[
  ...leaders.map(id=>[id+' 全体',...combat(vsA(id))]),
  ...leaders.map(id=>[id+' ランダム同士',...combat(vsA(id).filter(x=>x.name==='random'))]),
])
console.log('## 回復・情報・境界条件\n')
table(['方式','魔女の提出枚数／試合','実回復した夜／100夜','HP回復量／試合','占い師枚数／試合','預言者枚数／試合','暗殺者の予想設定／提出','満タン時の魔女／提出夜','HP4以下の大狼の夜','致死コストの商人の夜','回収対象なしの回収札の夜','再利用','上限破棄','夜末補充','1枚制限'],leaders.map(id=>{
  const m=collect(vsA(id)),p=m.player
  return [id,avg(p.witch,m.games),pct(p.healed,p.nights),avg(p.healAmount,m.games),avg(p.seer,m.games),
    avg(p.prophet,m.games),pct(p.assassinGuess,p.assassin),pct(p.witchFull,p.nights),p.direLow,p.merchantLethal,
    p.noTargetRecovery,p.recycles,p.overflow,p.refills,p.limited]
}))
console.log('## やさしい候補間の総当たり\n')
table(['候補（左の方式の勝率）','デッキ',...headers.slice(0,-1)],rows.filter(x=>x.rival!=='A').map(x=>[x.leader+' vs '+x.rival,x.name,...wdl([x]).slice(0,-1)]))
console.log('最終評価 '+sum(rows.map(x=>x.games))+'試合、シミュレーター計 '+avg(sum(rows.map(x=>x.ms)),1000,1)+' 秒。')
