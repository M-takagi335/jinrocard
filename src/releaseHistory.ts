export const releaseHistory = [{
  id: 'trap-raid-reduction-3',
  date: '2026-11-20',
  category: 'ゲームバランス調整',
  title: '罠師の能力を変更しました。',
  before: '襲撃をすべて無効化し、特殊2ダメージで反撃',
  after: '襲撃を合計3軽減し、特殊2ダメージで反撃',
}] as const
const storageKey = 'jinro-release-history-read'
export function hasUnreadHistory(storage?: Pick<Storage, 'getItem'>) {
  try { return (storage ?? globalThis.localStorage).getItem(storageKey) !== releaseHistory[0].id } catch { return true }
}
export function markHistoryRead(storage?: Pick<Storage, 'setItem'>) {
  try { (storage ?? globalThis.localStorage).setItem(storageKey, releaseHistory[0].id) } catch { /* Reading works without storage. */ }
}
