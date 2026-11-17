export function HpChanges({ lost, gained, animate = false }: { lost: number; gained: number; animate?: boolean }) {
  return <span className={animate ? 'hp-changes hp-changes-animated' : 'hp-changes'} aria-live="polite">
    {lost > 0 && <span className="hp-loss" aria-label={'今夜のHP減少 ' + lost}>−{lost}</span>}
    {gained > 0 && <span className="hp-gain" aria-label={'今夜のHP回復 ' + gained}>+{gained}</span>}
  </span>
}
