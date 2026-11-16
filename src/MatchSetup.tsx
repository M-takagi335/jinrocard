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

export function MatchSetup({ options, quickId, myId, onSelect, npcDeck, onNpcType, onStart, onInspect,
  onClose, error, issues, onStandard, onGenerate, onClearError }: {
  options: MatchDeck[]
  quickId: string
  myId?: string
  onSelect: (id: string) => void
  npcDeck: { type: DeckType | 'default'; cards: Role[] }
  onNpcType: (type: DeckType | 'default') => void
  onStart: (deck: MatchDeck) => void
  onInspect: (role: Role) => void
  onClose: () => void
  error: string
  issues: string[]
  onStandard: () => void
  onGenerate: (type: DeckType, label: string) => void
  onClearError: () => void
}) {
  const [tab, setTab] = useState(0)
  const [previewSide, setPreviewSide] = useState<'player' | 'npc' | null>(null)
  const tabId = useId()
  const selectedId = tab === 0 ? quickId : myId
  const selected = options.find(deck => deck.id === selectedId)
  const problem = selected ? deckCardsError(selected.cards) : '使用するデッキを選択してください。'
  const previewDeck = previewSide === 'npc'
    ? { cards: npcDeck.cards, name: npcDeck.type === 'default' ? '標準デッキ' : quickLabels[npcDeck.type] }
    : selected
  const myDecks = options.filter(deck => deck.source === '保存済み' || deck.source === '編集中')

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
              onClick={() => setPreviewSide('player')}>デッキの内容を確認</button>
          </div>
          <button className="primary" disabled={!selected || !!problem} onClick={() => selected && onStart(selected)}>
            この設定でNPC戦を開始
          </button>
        </div>}
      >
        <h3 className="match-section-title">自分のデッキ</h3>
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
              <button className="quiet match-option" aria-pressed={quickId === 'standard'} onClick={onStandard}>
                <strong>標準デッキ</strong>
                <small>固定の20枚</small>
              </button>
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
              {myDecks.map(deck => {
                const invalid = deckCardsError(deck.cards)
                const missing = RULES.deckSize - deck.cards.length
                if (invalid) return <li key={deck.id} className="hint">
                  編集中のデッキ：{missing > 0 ? 'あと' + missing + '枚必要です。' : invalid}
                </li>
                return (
                  <li key={deck.id}>
                    <button className="quiet match-option" aria-pressed={deck.id === myId} onClick={() => onSelect(deck.id)}>
                      <strong>{deck.name}</strong>
                      <span>{deck.source} · {deck.cards.length}枚</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {!myDecks.some(deck => deck.source === '保存済み') && <p className="hint">保存済みのデッキはありません。</p>}
            {!!issues.length && <details className="match-load-issues">
              <summary>読み込めない保存デッキがあります</summary>
              <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            </details>}
          </div>
        </div>
        <section className="match-npc" aria-labelledby={tabId + '-npc'}>
          <label id={tabId + '-npc'} htmlFor={tabId + '-npc-select'}>NPCのデッキ</label>
          <div className="match-npc-actions">
            <select id={tabId + '-npc-select'} value={npcDeck.type} onChange={event => onNpcType(event.target.value as DeckType | 'default')}>
              <option value="default">標準デッキ</option>
              {DECK_TYPES.map(type => <option key={type} value={type}>{quickLabels[type]}</option>)}
            </select>
            <button className="quiet" aria-haspopup="dialog" onClick={() => setPreviewSide('npc')}>NPCの内容を確認</button>
          </div>
        </section>
      </Sheet>
      {previewSide && previewDeck && (
        <Sheet title={(previewSide === 'npc' ? 'NPC：' : '') + previewDeck.name + ' · ' + previewDeck.cards.length + '枚'} className="match-contents"
          onClose={() => setPreviewSide(null)}>
          <DeckCardList cards={previewDeck.cards} onInspect={onInspect} />
        </Sheet>
      )}
    </>
  )
}
