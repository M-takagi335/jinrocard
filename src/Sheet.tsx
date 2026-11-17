import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Art } from './CardTile.tsx'
import { card, type Role } from './cards.ts'
import type { DeckEntry } from './duel.ts'
import { SoundSettingsButton } from './SoundSettingsButton.tsx'

export function Sheet({ title, onClose, children, footer, className, soundControl = true }: {
  title: string
  onClose?: () => void
  footer?: ReactNode
  className?: string
  children: ReactNode
  soundControl?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement
    element.showModal()
    const soundSettings = document.querySelector<HTMLDialogElement>('.sound-sheet[open]')
    if (soundSettings && soundSettings !== element) {
      // An investigation can open while the settings are in use.
      soundSettings.close()
      soundSettings.showModal()
      if (previousFocus instanceof HTMLElement && soundSettings.contains(previousFocus)) previousFocus.focus()
    }
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
          <div className="sheet-header-actions">
            {onClose && <button className="quiet" onClick={onClose}>閉じる</button>}
            {soundControl && <SoundSettingsButton />}
          </div>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </div>
    </dialog>
  )
}

export function DeckComposition({ entries, onInspect }: {
  entries: readonly DeckEntry[]
  onInspect: (role: Role) => void
}) {
  return (
    <ul className="composition artwork-composition">
      {entries.map(({ role, count }) => (
        <li key={role}>
          <button className="quiet" onClick={() => onInspect(role)} aria-haspopup="dialog">
            <Art role={role} />
            <span>{card(role).name}</span>
            <strong>{count}枚</strong>
          </button>
        </li>
      ))}
    </ul>
  )
}
