import { Art } from './CardTile.tsx'
import { card, type Role } from './cards.ts'
import type { Investigation } from './duel.ts'
import { Sheet } from './Sheet.tsx'

const titles = { seer: '占い師の透視結果', prophet: '預言者の透視結果' }
const labels = { old: '情報が古い', used: '使用を確認' }

export function InvestigationPanel({ records, onConfirm, onClose, onInspect }: {
  records: Investigation[]
  onConfirm?: () => void
  onClose?: () => void
  onInspect: (role: Role) => void
}) {
  const title = onConfirm && records[0] ? titles[records[0].kind] : '調査記録'

  return (
    <Sheet
      title={title}
      onClose={onClose}
      className="investigation-sheet"
      footer={onConfirm && <button className="primary" onClick={onConfirm}>確認しました</button>}
    >
      {!records.length && <p className="hint">この対戦の調査記録はまだありません。</p>}
      {records.map(({ sourceId, night, kind, cards }) => (
        <section className="investigation-record" key={night + '-' + sourceId}>
          {!onConfirm && <h3>{titles[kind]}</h3>}
          <p className="investigation-meta">第{night}夜 · {kind === 'seer' ? '相手の残り手札' : '相手の山札（上から順）'} · {cards.length}枚</p>
          <p className="hint">調査した時点の情報です。</p>
          {cards.length === 0 ? <p>確認できるカードがありません。</p> : (
            <ul className="investigation-cards" style={{ gridTemplateColumns: 'repeat(' + cards.length + ', minmax(0, 1fr))' }}>
              {cards.map(({ role, status }, index) => {
                const spec = card(role)
                const badge = status === 'observed'
                  ? (kind === 'seer' ? '確認時に所持' : '確認時の山札')
                  : labels[status]
                return (
                  <li key={index} className={'card insight-card ' + spec.category}>
                    <button className="art-inspect" aria-label={spec.name + 'を拡大'} aria-haspopup="dialog" onClick={() => onInspect(role)}>
                      <Art role={role} />
                    </button>
                    <details open={kind === 'seer'}>
                      <summary>
                        {kind === 'prophet' && <span className="insight-order">上から{index + 1}枚目</span>}

                        <strong className="card-name">{spec.name}</strong>
                        <span className={'insight-status ' + status}>{badge}</span>
                        <span className="insight-detail-label">効果を見る</span>
                      </summary>
                      <p className="card-text">{spec.text}</p>
                    </details>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
    </Sheet>
  )
}
