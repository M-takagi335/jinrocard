import { useEffect, useId, useRef, type ReactNode } from 'react'
import { card, type Role } from './cards.ts'
import type { DeckEntry } from './duel.ts'

export function Sheet({ title, onClose, children, footer, className }: {
  title: string
  onClose?: () => void
  footer?: ReactNode
  className?: string
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className={className ? 'sheet ' + className : 'sheet'}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose?.() }}
      onClick={event => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <div className="sheet-content">
        <header className="sheet-header">
          <h2 id={titleId}>{title}</h2>
          {onClose && <button className="quiet" onClick={onClose}>閉じる</button>}
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </div>
    </dialog>
  )
}

export function DeckComposition({ entries, onSelect, selected }: {
  entries: readonly DeckEntry[]
  onSelect?: (role: Role) => void
  selected?: Role
}) {
  return (
    <ul className="composition">
      {entries.map(({ role, count }) => {
        const label = <><span>{card(role).name}</span><strong>{count}枚</strong></>
        return (
          <li key={role}>
            {onSelect
              ? <button className="quiet" aria-pressed={role === selected} onClick={() => onSelect(role)}>{label}</button>
              : <div>{label}</div>}
          </li>
        )
      })}
    </ul>
  )
}
