import { useEffect, useState } from 'react'
import { parseStatistics, statisticsCategories } from './matchStatistics.ts'
import { NPC_DIFFICULTIES } from './strongNpc.ts'

let cached: { data: ReturnType<typeof parseStatistics>; time: number } | undefined
const quantity = new Intl.NumberFormat('ja-JP')
const percent = new Intl.NumberFormat('ja-JP', { style: 'percent', maximumFractionDigits: 1 })
const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'long' })

export function MatchStatisticsPanel() {
  const [data, setData] = useState(cached?.data)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (refresh === 0 && cached && Date.now() - cached.time < 300_000) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void fetch('/api/match-statistics', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
    }).then(async response => {
      if (!response.ok) throw new Error('Statistics unavailable')
      const result = parseStatistics(await response.json())
      if (controller.signal.aborted) return
      cached = { data: result, time: Date.now() }
      setData(result)
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [refresh])

  const online = data?.rows.find(row => row.category === 'online')
  const npc = data?.rows.filter(row => row.category !== 'online').reduce((total, row) => total + row.finished, 0)
  return <div className="match-statistics">
    <button className="quiet" disabled={loading} onClick={() => setRefresh(value => value + 1)}>戦績を更新</button>
    {loading && <p role="status">戦績を読み込んでいます。</p>}
    {failed && <p className="notice" role="status">現在、みんなの戦績を取得できません。{data && '前回取得した戦績を表示しています。'}</p>}
    {data && online && npc !== undefined && <>
      <dl className="statistics-metrics">
        <div><dt>累計対戦数</dt><dd>{quantity.format(npc + online.finished)}試合</dd></div>
        <div><dt>NPC対戦</dt><dd>{quantity.format(npc)}試合</dd></div>
        <div><dt>オンライン対戦</dt><dd>{quantity.format(online.finished)}試合</dd></div>
        <div><dt>集計開始日</dt><dd>{date.format(new Date(data.startedAt))}</dd></div>
      </dl>
      <h3>NPC難易度別</h3>
      {statisticsCategories.slice(0,4).map(category => {
        const row = data.rows.find(row => row.category === category)!
        const difficulty = category.slice(4) as keyof typeof NPC_DIFFICULTIES
        return <section className="statistics-difficulty" key={category} aria-label={NPC_DIFFICULTIES[difficulty]}>
          <h4>{NPC_DIFFICULTIES[difficulty]}</h4>
          <dl className="statistics-metrics">
            <div><dt>試合数</dt><dd>{quantity.format(row.finished)}</dd></div>
            <div><dt>勝ち</dt><dd>{quantity.format(row.wins)}</dd></div>
            <div><dt>負け</dt><dd>{quantity.format(row.losses)}</dd></div>
            <div><dt>引き分け</dt><dd>{quantity.format(row.draws)}</dd></div>
            <div><dt>勝率</dt><dd>{row.finished ? percent.format(row.wins / row.finished) : '—'}</dd></div>
          </dl>
        </section>
      })}
      <p className="hint">NPC戦の戦績はブラウザから報告された参考値です。</p>
      <h3>オンライン対戦</h3>
      <dl className="statistics-metrics">
        <div><dt>終了した対戦数</dt><dd>{quantity.format(online.finished)}</dd></div>
        <div><dt>引き分け</dt><dd>{quantity.format(online.draws)}</dd></div>
      </dl>
      <p className="hint">集計開始日以降に終了した試合を表示しています。オンライン戦の反映には数分かかります。</p>
    </>}
  </div>
}
