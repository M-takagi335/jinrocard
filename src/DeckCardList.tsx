import { Art } from './CardTile.tsx'
import { card, ROLES, type Role } from './cards.ts'

export function DeckCardList({ cards, onInspect }: { cards: readonly Role[]; onInspect: (role: Role) => void }) {
  return (
    <ul className="match-card-list">
      {ROLES.map(role => {
        const count = cards.filter(id => id === role).length
        if (!count) return null
        const spec = card(role)
        return (
          <li key={role}>
            <button className="art-inspect" aria-label={spec.name + 'を拡大'} aria-haspopup="dialog" onClick={() => onInspect(role)}>
              <Art role={role} />
            </button>
            <div>
              <strong>{spec.name} <span>×{count}</span></strong>
              <p>{spec.text}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
