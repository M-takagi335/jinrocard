export function HpChanges({ lost, gained }: { lost: number; gained: number }) {
  return <span className="hp-changes" aria-live="polite">
    {lost > 0 && <span className="hp-loss" aria-label={'今夜のHP減少 ' + lost}>−{lost}</span>}
    {gained > 0 && <span className="hp-gain" aria-label={'今夜のHP回復 ' + gained}>+{gained}</span>}
  </span>
}
