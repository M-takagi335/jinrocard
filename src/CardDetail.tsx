import { Art } from './CardTile.tsx'
import { card, CATEGORY, type Role } from './cards.ts'
import { Sheet } from './Sheet.tsx'

export function CardDetail({ role, action, onClose }: {
  role: Role
  action?: { label: string; run: () => void }
  onClose: () => void
}) {
  const spec = card(role)
  return (
    <Sheet title={spec.name} onClose={onClose}
      footer={action && <button className="primary" onClick={action.run}>{action.label}</button>}>
      <div className="card-inspection">
        <Art role={role} eager />
        <div>
          <span className="card-inspection-category">{CATEGORY[spec.category]}</span>
          <p>{spec.text}</p>
        </div>
      </div>
    </Sheet>
  )
}
