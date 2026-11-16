import { useState } from 'react'
import { DeckCardList } from './DeckCardList.tsx'
import { card, ROLES, RULES, type Role } from './cards.ts'
import { deckCardsError, type MatchDeck } from './decks.ts'
import { DECK_TYPES, PROFILES, type DeckType } from './generateDeck.ts'
import { Sheet } from './Sheet.tsx'

function entriesFor(deck: MatchDeck) {
  return ROLES.flatMap(role => {
    const count = deck.cards.filter(id => id === role).length
    return count ? [{ role, count }] : []
  })
}

export function MatchSetup({ options, selectedId, onSelect, npcType, onNpcType, onStart, onInspect,
  onClose, error, issues, onGenerate }: {
  options: MatchDeck[]
  selectedId: string
  onSelect: (id: string) => void
  npcType: DeckType | 'default'
  onNpcType: (type: DeckType | 'default') => void
  onStart: (deck: MatchDeck) => void
  onInspect: (role: Role) => void
  onClose: () => void
  error: string
  issues: string[]
  onGenerate: (type: DeckType, label: string) => void
}) {
  const [showTypes, setShowTypes] = useState(selectedId.startsWith('quick:'))
  const selected = options.find(deck => deck.id === selectedId)
  const problem = selected ? deckCardsError(selected.cards) : '使用するデッキを選択してください。'
  return (
    <Sheet
      title="対戦デッキを選択"
      className="match-sheet"
      onClose={onClose}
      footer={<div className="match-footer">
        <span className="match-status" role={problem || error ? 'alert' : 'status'}>
          {error || problem || selected?.name}
        </span>
        <button className="primary" disabled={!selected || !!problem} onClick={() => selected && onStart(selected)}>
          このデッキで対戦開始
        </button>
      </div>}
    >
      <div className="match-layout">
        <div>
          <label className="npc-deck-type">対戦相手のデッキ
            <select value={npcType} onChange={event => onNpcType(event.target.value as DeckType | 'default')}>
              <option value="default">NPC標準デッキ</option>
              {DECK_TYPES.map(type => <option key={type} value={type}>おまかせ・{PROFILES[type].label}</option>)}
            </select>
          </label>
          <h3>自分のデッキ</h3>
          <div className="match-quick">
            <button className="quiet" aria-expanded={showTypes} onClick={() => setShowTypes(value => !value)}>おまかせデッキ</button>
            {showTypes && <div className="match-types" aria-label="デッキタイプ">
              {DECK_TYPES.map(type => <button key={type} className="quiet" aria-pressed={selectedId === 'quick:' + type}
                onClick={() => onGenerate(type, PROFILES[type].label)}>{PROFILES[type].label}</button>)}
            </div>}
          </div>
          <ul className="match-options">
            {options.filter(deck => deck.source !== 'おまかせ').map(deck => (
              <li key={deck.id}>
                <button className="quiet match-option" disabled={!!deckCardsError(deck.cards)} aria-pressed={deck.id === selectedId} onClick={() => onSelect(deck.id)}>
                  <strong>{deck.source === '編集中' ? '編集中のデッキ' : deck.name}</strong>
                  <span>{deck.source} · {deck.cards.length}枚</span>
                  <small>{deckCardsError(deck.cards) ? (deck.cards.length < RULES.deckSize ? 'あと' + (RULES.deckSize - deck.cards.length) + '枚必要です。' : deckCardsError(deck.cards)) : entriesFor(deck).sort((a, b) => b.count - a.count).slice(0, 3)
                    .map(({ role }) => card(role).name).join('・') || 'カードなし'}</small>
                </button>
              </li>
            ))}
          </ul>
          {!options.some(deck => deck.source === '保存済み') && <p className="hint">保存済みのデッキはありません。</p>}
          {!!issues.length && <details className="match-load-issues">
            <summary>読み込めない保存デッキがあります</summary>
            <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
          </details>}
        </div>
        {selected && <section className="match-preview" aria-label="選択中のデッキ内容">
          <h3>{selected.name} <small>{selected.cards.length}枚</small></h3>
          <DeckCardList cards={selected.cards} onInspect={onInspect} />
        </section>}
      </div>
    </Sheet>
  )
}
