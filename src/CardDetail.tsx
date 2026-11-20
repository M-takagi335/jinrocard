import { Art } from './CardTile.tsx'
import { CATEGORY, type Role } from './cards.ts'
import { useRuleCards } from './CardRules.tsx'
import { Sheet } from './Sheet.tsx'

export function CardDetail({ role, effect, action, onClose }: {
  role: Role
  effect?: string
  action?: { label: string; run: () => void }
  onClose: () => void
}) {
  const { card } = useRuleCards()
  const spec = card(role)
  return (
    <Sheet title={spec.name} onClose={onClose}
      footer={action && <button className="primary" onClick={action.run}>{action.label}</button>}>
      <div className="card-inspection">
        <Art role={role} eager />
        <div>
          <span className="card-inspection-category">{CATEGORY[spec.category]}</span>
          <p>{effect ?? spec.text}</p>
        </div>
      </div>
    </Sheet>
  )
}
