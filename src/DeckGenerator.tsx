import { useEffect, useRef, useState } from 'react'
import { type Role } from './cards.ts'
import { DeckCardList } from './DeckCardList.tsx'
import { deckNameLimit, type NamedDeck } from './decks.ts'
import { DECK_TYPES, PROFILES, generateDecks, type DeckType, type GeneratedDeck } from './generateDeck.ts'
import { Sheet } from './Sheet.tsx'

type Props = {
  usedNames: string[]
  onClose: () => void
  onInspect: (role: Role) => void
  onEdit: (deck: NamedDeck) => void
  onSave: (decks: NamedDeck[]) => boolean
}

export function DeckGenerator({ usedNames, onClose, onInspect, onEdit, onSave }: Props) {
  const [size, setSize] = useState<1 | 3 | 5 | 10>(1)
  const [types, setTypes] = useState<DeckType[]>(['balanced'])
  const [results, setResults] = useState<GeneratedDeck[]>([])
  const [choosing, setChoosing] = useState(true)
  const [selected, setSelected] = useState(0)
  const [savedIndices, setSavedIndices] = useState<number[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [replace, setReplace] = useState(false)
  const [naming, setNaming] = useState<{ index: number; name: string }[]>([])
  const sectionTitle = useRef<HTMLHeadingElement>(null)
  const current = results[selected]
  const pending = results.flatMap((_, index) => savedIndices.includes(index) ? [] : [index])

  useEffect(() => {
    sectionTitle.current?.focus()
  }, [choosing, results.length, selected])

  function showResults(decks: GeneratedDeck[]) {
    setResults(decks)
    setSelected(0)
    setSavedIndices([])
    setChoosing(false)
    setError('')
    setMessage('')
  }

  function generate(requested = types) {
    try {
      if (requested.length > size) throw new Error('作成数以下のタイプを選択してください。')
      const candidates = generateDecks(requested, size, usedNames, results)
      showResults(candidates)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'デッキを作成できませんでした。')
    }
  }

  function selectType(type: DeckType) {
    setTypes(previous => {
      if (size === 1) return [type]
      return previous.includes(type) ? previous.filter(item => item !== type) : [...previous, type]
    })
    setError('')
  }

  function requestGenerate() {
    if (pending.length) setReplace(true)
    else generate()
  }

  function openSave(indices: number[]) {
    setError('')
    setNaming(indices.map(index => ({ index, name: results[index].name })))
  }

  function save() {
    if (!naming.length || naming.some(entry => !entry.name.trim())) return
    const updates = naming.map(({ index, name }) => ({ ...results[index], name: name.trim() }))
    if (!onSave(updates)) {
      setError('保存できませんでした。デッキ名、ブラウザの保存設定、空き容量を確認してください。')
      return
    }
    const next = [...results]
    naming.forEach(({ index }, offset) => { next[index] = updates[offset] })
    setResults(next)
    setSavedIndices([...savedIndices, ...naming.map(entry => entry.index)])
    setNaming([])
    setError('')
    setMessage(updates.length + '件のデッキを保存しました。')
  }

  return (
    <>
      <Sheet title="おまかせ作成" onClose={onClose}>
        <div className="generator">
          {choosing ? (
            <>
              <h3>作成方法</h3>
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
              <h3 tabIndex={-1} ref={sectionTitle}>デッキタイプ</h3>
              <div className="generator-types">
                {DECK_TYPES.map(type => (
                  <button key={type} className="quiet" aria-pressed={types.includes(type)} onClick={() => selectType(type)}>
                    <strong>{PROFILES[type].label}</strong>
                    <span>{PROFILES[type].description}</span>
                  </button>
                ))}
              </div>
              <div className="generator-buttons">
                <button className="primary" onClick={requestGenerate}>生成する</button>
                {!!results.length && <button className="quiet" onClick={() => { setChoosing(false); setError('') }}>前の結果に戻る</button>}
              </div>
            </>
          ) : (
            <>
              <h3 tabIndex={-1} ref={sectionTitle}>{current.name}</h3>
              <p className="hint">{PROFILES[current.type].label} ・ {current.cards.length}枚</p>
              <div className="generator-buttons">
                <button className="quiet" onClick={requestGenerate}>もう一度生成</button>
                <button className="quiet" onClick={() => { setChoosing(true); setError(''); setMessage('') }}>別のタイプを選ぶ</button>
                <button className="quiet" onClick={() => onEdit(current)}>編集する</button>
                <button className="quiet" disabled={savedIndices.includes(selected)} onClick={() => openSave([selected])}>
                  {savedIndices.includes(selected) ? '保存済み' : '保存する'}
                </button>
                {results.length > 1 && (
                  <button className="quiet" disabled={!pending.length} onClick={() => openSave(pending)}>
                    {pending.length ? '一括保存（' + pending.length + '件）' : '一括保存済み'}
                  </button>
                )}
              </div>
              {results.length > 1 && (
                <ul className="generator-results" aria-label="生成したデッキの一覧">
                  {results.map((deck, index) => (
                    <li key={index}>
                      <button className="quiet" aria-pressed={index === selected} onClick={() => { setSelected(index); setError('') }}>
                        <span>{deck.name}</span>
                        <small>{savedIndices.includes(index) ? '保存済み' : '詳細'}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <DeckCardList cards={current.cards} onInspect={onInspect} />
            </>
          )}
          {error && !naming.length && <p className="generator-feedback notice" role="alert">{error}</p>}
          {message && !error && <p className="generator-feedback notice" role="status">{message}</p>}
        </div>
      </Sheet>
      {replace && (
        <Sheet title="もう一度生成しますか？" onClose={() => setReplace(false)} footer={
          <button className="primary" onClick={() => { setReplace(false); generate() }}>生成し直す</button>
        }>
          <p>未保存の生成結果を新しいデッキに置き換えます。</p>
        </Sheet>
      )}
      {!!naming.length && (
        <Sheet title="生成したデッキを保存" onClose={() => { setNaming([]); setError('') }}>
          <form className="generator-save-form" onSubmit={event => { event.preventDefault(); save() }}>
            {naming.map(({ index, name }, offset) => (
              <label key={index}>{naming.length === 1 ? 'デッキ名' : 'デッキ名 ' + (offset + 1)}
                <input value={name} maxLength={deckNameLimit} onChange={event => {
                  setNaming(values => values.map(entry => entry.index === index ? { ...entry, name: event.target.value } : entry))
                }} />
              </label>
            ))}
            <button className="primary" type="submit" disabled={naming.some(entry => !entry.name.trim())}>保存する</button>
          </form>
          {error && <p className="notice" role="alert">{error}</p>}
        </Sheet>
      )}
    </>
  )
}
