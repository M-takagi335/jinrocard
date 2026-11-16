import { useState } from 'react'
import { card, CARD_SUMMARY, CATEGORY, type Role } from './cards.ts'

const reported = new Set<string>()

export function CardCategory({ category }: { category: keyof typeof CATEGORY }) {
  return <span className={'card-type ' + category}>{CATEGORY[category]}</span>
}

export function Art({ role, eager = false }: { role: Role; eager?: boolean }) {
  const spec = card(role)
  return <RoleImage key={role} name={spec.name} path={spec.imagePath} eager={eager} />
}

function RoleImage({ name, path, eager }: { name: string; path: string; eager: boolean }) {
  const [stage, setStage] = useState(0)
  if (stage === 2) return <span className="art art-fallback" aria-hidden="true">{name}</span>
  const source = stage === 0 ? path : 'cards/fallback.svg'

  return (
    <img
      className="art"
      src={import.meta.env.BASE_URL + source}
      width={1086}
      height={1448}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => {
        if (!reported.has(source)) {
          console.warn('カード画像を読み込めませんでした', decodeURIComponent(source))
          reported.add(source)
        }
        setStage(stage + 1)
      }}
    />
  )
}

export function CardTile({ role, selected = false, disabled = false, onClick, onInspect, detail, glowing = false, compact = false }: {
  role: Role
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
  onInspect?: () => void
  detail?: string
  glowing?: boolean
  compact?: boolean
}) {
  const spec = card(role)
  const body = (
    <>
      <Art role={role} />
      <CardCategory category={spec.category} />
      <span className="card-caption">
        <span className="card-name">{spec.name}</span>
        {compact && <span className="compact-effect">{CARD_SUMMARY[role]}</span>}
        {detail && <span className="card-detail">{detail}</span>}
      </span>
    </>
  )
  const className = ['card', 'card-face', spec.category, compact && 'is-compact', selected && 'selected', disabled && 'inactive', glowing && 'insight-glow'].filter(Boolean).join(' ')
  const faceAction = onInspect ?? onClick
  const face = faceAction ? (
    <button type="button" className={className} onClick={faceAction}
      aria-haspopup={onInspect ? 'dialog' : undefined} aria-pressed={!onInspect && onClick ? selected : undefined}>
      {body}
    </button>
  ) : <div className={className}>{body}</div>

  return (
    <div className={compact ? 'card-slot compact-slot' : 'card-slot'}>
      {face}
      {onClick && onInspect && (
        <button type="button" className="card-quick" aria-label={spec.name + (selected ? 'の選択を解除' : 'を選択')}
          aria-pressed={selected} onClick={onClick}>{selected ? '解除' : '選択'}</button>
      )}
    </div>
  )
}
