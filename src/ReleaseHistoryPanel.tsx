import { releaseHistory } from './releaseHistory.ts'

export function ReleaseHistoryPanel() {
  return <div className="release-history">{releaseHistory.map(entry => <article key={entry.id}>
    <time dateTime={entry.date}>{entry.date.replaceAll('-', '/')}</time>
    <p className="hint">{entry.category}</p>
    <h3>{entry.title}</h3>
    <dl><dt>変更前</dt><dd>{entry.before}</dd><dt>変更後</dt><dd>{entry.after}</dd></dl>
    <p className="hint">作成済みのオンラインルームは、作成時のルールで継続します。</p>
  </article>)}</div>
}
