import { useId, useRef, useState } from 'react'
import { Art } from './CardTile.tsx'
import { card } from './cards.ts'
import type { DeckEntry } from './duel.ts'
import { Sheet } from './Sheet.tsx'

const tabs = [
  { id: 'initial', label: 'デッキ全体' },
  { id: 'remaining', label: '残っているカード' },
] as const
type Tab = typeof tabs[number]['id']

export function DeckViewer({ title, night, hp, initial, remaining, onClose }: {
  title: string
  night: number
  hp: number
  initial: readonly DeckEntry[]
  remaining: readonly DeckEntry[]
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('initial')
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const entries = tab === 'initial' ? initial : remaining
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="deck-viewer-context">第{night}夜 · {hp} HP</p>
      <div className="filters deck-viewer-tabs" role="tablist" aria-label={title + '情報'}>
        {tabs.map(({ id: tabId, label }, index) => (
          <button
            key={tabId}
            ref={element => { buttons.current[index] = element }}
            type="button"
            role="tab"
            id={id + '-' + tabId}
            aria-selected={tab === tabId}
            aria-controls={id + '-panel'}
            className={tab === tabId ? 'active' : undefined}
            tabIndex={tab === tabId ? 0 : -1}
            onClick={() => setTab(tabId)}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
              setTab(tabs[next].id)
              buttons.current[next]?.focus()
            }}
          >{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={id + '-panel'} aria-labelledby={id + '-' + tab} tabIndex={0}>
        <p className="hint">{tab === 'initial' ? '対戦開始時の構成' : '捨て札以外の構成'} · {total}枚</p>
        {entries.length === 0 ? <p>残っているカードはありません。</p> : (
          <ul className="deck-viewer-list" key={tab}>
            {entries.map(({ role, count }) => {
              const spec = card(role)
              return (
                <li key={role}>
                  <details>
                    <summary><strong>{spec.name}</strong><span>{count}枚</span></summary>
                    <div className="deck-viewer-detail">
                      <Art role={role} />
                      <p>{spec.text}</p>
                    </div>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
