import { useEffect, useRef, useState } from 'react'
import { ROLES } from './cards.ts'
import { deckNameLimit, type NamedDeck } from './decks.ts'
import { DECK_TYPES, PROFILES, generateDecks, type DeckType, type GeneratedDeck } from './generateDeck.ts'
import { DeckComposition, Sheet } from './Sheet.tsx'

type Props = {
  usedNames: string[]
  onClose: () => void
  onUse: (deck: NamedDeck) => void
  onEdit: (deck: NamedDeck) => void
  onSave: (decks: NamedDeck[]) => boolean
}

export function DeckGenerator({ usedNames, onClose, onUse, onEdit, onSave }: Props) {
  const [size, setSize] = useState<1 | 3 | 5 | 10>(1)
  const [types, setTypes] = useState<DeckType[]>(['balanced'])
  const [results, setResults] = useState<GeneratedDeck[]>([])
  const [choosing, setChoosing] = useState(true)
  const [selected, setSelected] = useState(0)
  const [savedIndices, setSavedIndices] = useState<number[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const sectionTitle = useRef<HTMLHeadingElement>(null)
  const current = results[selected]
  const pending = results.filter((_, index) => !savedIndices.includes(index))

  useEffect(() => {
    sectionTitle.current?.focus()
  }, [choosing, results.length, selected])

  function selectType(type: DeckType) {
    setTypes(previous => {
      if (size === 1) return [type]
      return previous.includes(type) ? previous.filter(item => item !== type) : [...previous, type]
    })
    setError('')
  }

  function generate() {
    try {
      if (types.length > size) throw new Error('作成数以下のタイプを選択してください。')
      const candidates = generateDecks(types, size, usedNames, results)
      setResults(candidates)
      setSelected(0)
      setSavedIndices([])
      setChoosing(false)
      setError('')
      setMessage('')
      sectionTitle.current?.focus()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'デッキを作成できませんでした。')
    }
  }

  function save(all: boolean) {
    const items = all ? pending : [current]
    if (items.some(deck => !deck.name.trim())) {
      setError('保存するデッキに名前を入力してください。')
      return
    }
    if (!onSave(items)) {
      setError('保存できませんでした。デッキ名、ブラウザの保存設定、空き容量を確認してください。')
      return
    }
    setSavedIndices(all ? results.map((_, index) => index) : [...savedIndices, selected])
    setError('')
    setMessage(items.length + '件のデッキを保存しました。')
  }

  const entries = current ? ROLES.flatMap(role => {
    const count = current.cards.filter(entry => entry === role).length
    return count ? [{ role, count }] : []
  }) : []

  return (
    <Sheet title="おまかせ作成" onClose={onClose}>
      <div className="generator">
        {choosing ? (
          <>
            <h3 tabIndex={-1} ref={sectionTitle}>作成方法</h3>
            <div className="generator-buttons" aria-label="作成方法">
              <button className="quiet" aria-pressed={size === 1} onClick={() => {
                setSize(1)
                setTypes(types.slice(0, 1))
                setError('')
              }}>1つ作成</button>
              <button className="quiet" aria-pressed={size !== 1} onClick={() => {
                if (size === 1) setSize(3)
                setError('')
              }}>まとめて作成</button>
            </div>
            {size !== 1 && (
              <div className="generator-buttons" aria-label="作成するデッキ数">
                {([3, 5, 10] as const).map(count => (
                  <button key={count} className="quiet" aria-pressed={size === count} onClick={() => {
                    setSize(count)
                    setError('')
                  }}>{count}個</button>
                ))}
              </div>
            )}
            <h3>デッキタイプ</h3>
            <p className="hint">{size === 1 ? 'タイプを1つ選んでください。' : '複数のタイプを選ぶと、順番に組み合わせて作成します。'}</p>
            <div className="generator-types">
              {DECK_TYPES.map(type => (
                <button key={type} className="quiet" aria-pressed={types.includes(type)} onClick={() => selectType(type)}>
                  <strong>{PROFILES[type].label}</strong>
                  <span>{PROFILES[type].description}</span>
                </button>
              ))}
            </div>
            <div className="generator-buttons">
              <button className="primary" onClick={generate}>生成する</button>
              {!!results.length && <button className="quiet" onClick={() => { setChoosing(false); setError('') }}>前の結果に戻る</button>}
            </div>
          </>
        ) : (
          <>
            <h3 tabIndex={-1} ref={sectionTitle}>生成したデッキ {results.length}件</h3>
            <div className="generator-buttons">
              <button className="quiet" onClick={generate}>もう一度生成する</button>
              <button className="quiet" onClick={() => { setChoosing(true); setError(''); setMessage('') }}>別のタイプを選ぶ</button>
              {results.length > 1 && (
                <button className="quiet" disabled={!pending.length} onClick={() => save(true)}>
                  {pending.length ? '一括保存（' + pending.length + '件）' : '一括保存済み'}
                </button>
              )}
            </div>
            {results.length > 1 && (
              <ul className="generator-results" aria-label="生成したデッキの一覧">
                {results.map((deck, index) => (
                  <li key={index}>
                    <button className="quiet" aria-pressed={index === selected} onClick={() => {
                      setSelected(index)
                      setError('')
                    }}>
                      <span>{deck.name.trim() || PROFILES[deck.type].label + ' ' + (index + 1)}</span>
                      <small>{savedIndices.includes(index) ? '保存済み' : '詳細'}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="generator-preview">
              <label htmlFor="generated-deck-name">デッキ名</label>
              <input
                id="generated-deck-name"
                value={current.name}
                disabled={savedIndices.includes(selected)}
                maxLength={deckNameLimit}
                onChange={event => {
                  const name = event.target.value
                  setResults(previous => previous.map((deck, index) => index === selected ? { ...deck, name } : deck))
                  setError('')
                }}
              />
              <p className="hint">{PROFILES[current.type].label} ・ {current.cards.length}枚</p>
              <div className="generator-buttons">
                <button className="primary" onClick={() => onUse(current)}>このデッキを使う</button>
                <button className="quiet" disabled={savedIndices.includes(selected)} onClick={() => save(false)}>
                  {savedIndices.includes(selected) ? '保存済み' : '保存する'}
                </button>
                <button className="quiet" onClick={() => onEdit(current)}>編集する</button>
              </div>
              <DeckComposition entries={entries} />
            </div>
          </>
        )}
        {error && <p className="generator-feedback notice" role="alert">{error}</p>}
        {message && !error && <p className="generator-feedback notice" role="status">{message}</p>}
      </div>
    </Sheet>
  )
}
