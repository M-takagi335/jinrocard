import { useState } from 'react'
import { Art } from './CardTile.tsx'
import { card, type Role } from './cards.ts'
import type { DeckEntry } from './duel.ts'
import { Sheet } from './Sheet.tsx'

export function AssassinPrediction({ entries, initial, onConfirm, onClose }: {
  entries: readonly DeckEntry[]
  initial?: Role
  onConfirm: (role: Role) => void
  onClose: () => void
}) {
  const [selection, setSelection] = useState(initial)
  const selected = entries.find(entry => entry.role === selection)
  return (
    <Sheet
      title="暗殺者の予想"
      onClose={onClose}
      footer={
        <div className="guess-confirm">
          <span aria-live="polite">{selected ? '予想：' + card(selected.role).name : '役職を選択してください'}</span>
          <button className="primary" disabled={!selected} onClick={() => selected && onConfirm(selected.role)}>
            予想を確定
          </button>
        </div>
      }
    >
      <p className="hint">相手が今夜出すと思う役職を選んでください。</p>
      {entries.length ? (
        <ul className="guess-options">
          {entries.map(({ role, count }) => (
            <li key={role}>
              <button
                className={'card guess-option ' + card(role).category + (selected?.role === role ? ' selected' : '')}
                aria-pressed={selected?.role === role}
                onClick={() => setSelection(role)}
              >
                <Art role={role} />
                <strong className="card-name">{card(role).name}</strong>
                <span>残り{count}枚</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p>予想できる役職はありません。</p>}
    </Sheet>
  )
}
