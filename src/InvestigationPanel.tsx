import { Art } from './CardTile.tsx'
import { card, type Role } from './cards.ts'
import type { Investigation } from './duel.ts'
import { Sheet } from './Sheet.tsx'

const titles = { seer: '占い師の透視結果', prophet: '預言者の透視結果' }
const prophetLabels = { observed: '確認済み', old: '順番不明', unknown: '順番不明', drawn: 'ドロー済み', used: '使用済み' }
const seerLabels = { observed: '確認時に所持', old: '確認時に所持・現在は不明', unknown: '現在は不明', drawn: '現在は不明', used: '使用済み' }

export function InvestigationPanel({ records, onConfirm, onClose, onInspect, tutorial = false }: {
  records: Investigation[]
  onConfirm?: () => void
  onClose?: () => void
  onInspect?: (role: Role) => void
  tutorial?: boolean
}) {
  const title = tutorial ? '占い師の調査結果' : onConfirm && records[0] ? titles[records[0].kind] : '調査記録'

  return (
    <Sheet
      title={title}
      onClose={onClose}
      className="investigation-sheet"
      footer={onConfirm && <button className="primary" onClick={onConfirm}>{tutorial ? '確認した' : '確認しました'}</button>}
    >
      {!records.length && <p className="hint">この対戦の調査記録はまだありません。</p>}
      {records.map(({ sourceId, night, kind, cards }) => (
        <section className="investigation-record" key={night + '-' + sourceId}>
          {!onConfirm && <h3>{titles[kind]}</h3>}
          <p className="investigation-meta">第{night}夜 · {kind === 'seer' ? '相手の残り手札' : '相手の山札（上から順）'} · {cards.length}枚</p>
          <p className="hint">{tutorial && cards.length ? '相手の手札から、このカードが判明しました。'
            : kind === 'prophet' ? '調査時の並びです。追跡できるカードには現在の位置も表示します。' : '調査した時点の情報です。'}</p>
          {cards.length === 0 ? <p>確認できるカードがありません。</p> : (
            <ul className="investigation-cards" style={{ gridTemplateColumns: 'repeat(' + cards.length + ', minmax(0, 1fr))' }}>
              {cards.map(({ role, status, position }, index) => {
                const spec = card(role)
                const badge = (kind === 'prophet' ? prophetLabels : seerLabels)[status]
                return (
                  <li key={index} className={'card insight-card ' + spec.category}>
                    {onInspect ? <button className="art-inspect" aria-label={spec.name + 'を拡大'} aria-haspopup="dialog" onClick={() => onInspect(role)}>
                      <Art role={role} />
                    </button> : <div className="art-inspect"><Art role={role} eager /></div>}
                    <details open={kind === 'seer'}>
                      <summary>
                        {kind === 'prophet' && <span className="insight-order">調査時：上から{index + 1}枚目</span>}

                        <strong className="card-name">{spec.name}</strong>
                        <span className={'insight-status ' + status}>{badge}{position !== undefined && '（現在 ' + position + '枚目）'}</span>
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
