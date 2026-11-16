import { useId, useState } from 'react'
import { DeckCardList } from './DeckCardList.tsx'
import { RULES, type Role } from './cards.ts'
import { deckCardsError, type MatchDeck } from './decks.ts'
import { DECK_TYPES, PROFILES, type DeckType } from './generateDeck.ts'
import { Sheet } from './Sheet.tsx'

const tabs = ['おまかせ', 'マイデッキ'] as const
const quickLabels: Record<DeckType, string> = {
  balanced: 'バランス型',
  rush: '速攻型',
  defense: '耐久型',
  intel: '情報型',
  combo: 'コンボ型',
  random: 'ランダム型',
}

export function MatchSetup({ options, quickId, myId, onSelect, npcType, onNpcType, onStart, onInspect,
  onClose, error, issues, onGenerate, onClearError }: {
  options: MatchDeck[]
  quickId?: string
  myId: string
  onSelect: (id: string) => void
  npcType: DeckType | 'default'
  onNpcType: (type: DeckType | 'default') => void
  onStart: (deck: MatchDeck) => void
  onInspect: (role: Role) => void
  onClose: () => void
  error: string
  issues: string[]
  onGenerate: (type: DeckType, label: string) => void
  onClearError: () => void
}) {
  const [tab, setTab] = useState(0)
  const [showContents, setShowContents] = useState(false)
  const tabId = useId()
  const selectedId = tab === 0 ? quickId : myId
  const selected = options.find(deck => deck.id === selectedId)
  const problem = selected ? deckCardsError(selected.cards) : 'デッキタイプを選択してください。'

  const switchTab = (index: number) => {
    setTab(index)
    onClearError()
  }

  return (
    <>
      <Sheet title="対戦デッキを選択" className="match-sheet" onClose={onClose}
        footer={<div className="match-footer">
          <div className="match-selection">
            <span className="match-status" role={error ? 'alert' : 'status'}>
              {error || problem || (selected && selected.name + ' · ' + selected.cards.length + '枚')}
            </span>
            <button className="quiet" aria-haspopup="dialog" disabled={!selected || !!problem}
              onClick={() => setShowContents(true)}>デッキの内容を確認</button>
          </div>
          <button className="primary" disabled={!selected || !!problem} onClick={() => selected && onStart(selected)}>
            このデッキで対戦開始
          </button>
        </div>}
      >
        <div className="match-tabs" role="tablist" aria-label="デッキの選び方">
          {tabs.map((label, index) => (
            <button id={tabId + '-tab-' + index} key={label} className="quiet" role="tab" aria-selected={tab === index}
              aria-controls={tabId + '-panel-' + index} tabIndex={tab === index ? 0 : -1} onClick={() => switchTab(index)}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
                switchTab(next)
                document.getElementById(tabId + '-tab-' + next)?.focus()
              }}>
              {label}
            </button>
          ))}
        </div>
        <div className="match-panes">
          <div id={tabId + '-panel-0'} role="tabpanel" aria-labelledby={tabId + '-tab-0'} hidden={tab !== 0}>
            <div className="match-types">
              {DECK_TYPES.map(type => (
                <button key={type} className="quiet match-option" aria-pressed={quickId === 'quick:' + type}
                  onClick={() => onGenerate(type, quickLabels[type])}>
                  <strong>{quickLabels[type]}</strong>
                  <small>{PROFILES[type].description}</small>
                </button>
              ))}
            </div>
          </div>
          <div id={tabId + '-panel-1'} role="tabpanel" aria-labelledby={tabId + '-tab-1'} hidden={tab !== 1}>
            <ul className="match-options">
              {options.filter(deck => deck.source !== 'おまかせ').map(deck => {
                const invalid = deckCardsError(deck.cards)
                const missing = RULES.deckSize - deck.cards.length
                return (
                  <li key={deck.id}>
                    <button className="quiet match-option" disabled={!!invalid} aria-pressed={deck.id === myId} onClick={() => onSelect(deck.id)}>
                      <strong>{deck.name}</strong>
                      <span>{deck.source} · {deck.cards.length}枚</span>
                      {invalid && <small>{missing > 0 ? 'あと' + missing + '枚必要です。' : invalid}</small>}
                    </button>
                  </li>
                )
              })}
            </ul>
            {!!issues.length && <details className="match-load-issues">
              <summary>読み込めない保存デッキがあります</summary>
              <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            </details>}
          </div>
        </div>
        <label className="npc-deck-type">対戦相手のデッキ
          <select value={npcType} onChange={event => onNpcType(event.target.value as DeckType | 'default')}>
            <option value="default">NPC標準デッキ</option>
            {DECK_TYPES.map(type => <option key={type} value={type}>おまかせ・{PROFILES[type].label}</option>)}
          </select>
        </label>
      </Sheet>
      {showContents && selected && (
        <Sheet title={selected.name + ' · ' + selected.cards.length + '枚'} className="match-contents"
          onClose={() => setShowContents(false)}>
          <DeckCardList cards={selected.cards} onInspect={onInspect} />
        </Sheet>
      )}
    </>
  )
}
