export function TyrantLimitNotice({ limited }: { limited: boolean }) {
  if (!limited) return null
  return (
    <p className="tyrant-limit-notice" role="status">
      <strong>独裁者の効果適用中</strong>
      <span>今夜はカードを1枚しか使用できません。</span>
    </p>
  )
}
