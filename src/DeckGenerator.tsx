import { useState } from 'react'
import type { NamedDeck } from './decks.ts'
import { DECK_TYPES, PROFILES, generateDecks, type DeckType } from './generateDeck.ts'
import { Sheet } from './Sheet.tsx'

export function DeckGenerator({ usedNames, onClose, onEdit }: {
  usedNames: string[]
  onClose: () => void
  onEdit: (deck: NamedDeck) => void
}) {
  const [type, setType] = useState<DeckType>('balanced')
  const [error, setError] = useState('')

  function generate() {
    try {
      const [deck] = generateDecks([type], 1, usedNames)
      onEdit(deck)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'デッキを作成できませんでした。')
    }
  }

  return (
    <Sheet title="おまかせ生成" onClose={onClose}
      footer={<button className="primary" onClick={generate}>生成して編集</button>}>
      <div className="generator-types" role="group" aria-label="デッキタイプ">
        {DECK_TYPES.map(entry => (
          <button key={entry} className="quiet" aria-pressed={entry === type} onClick={() => { setType(entry); setError('') }}>
            <strong>{PROFILES[entry].label}</strong>
            <span>{PROFILES[entry].description}</span>
          </button>
        ))}
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
    </Sheet>
  )
}
