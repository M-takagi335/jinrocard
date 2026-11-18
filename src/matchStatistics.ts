import type { Duel } from './duel.ts'

export const statisticsEnabled = import.meta.env?.VITE_MATCH_STATS_ENABLED === 'true'
export const statisticsCategories = ['npc_easy','npc_standard','npc_strong','npc_strongest','online'] as const
export type StatisticsCategory = typeof statisticsCategories[number]
type Result = 'win' | 'loss' | 'draw'
type Report = { id: string; category: StatisticsCategory; result: Result }
type Pending = { report: Report; attempts: number; due: number }
type StatisticsRow = { category: StatisticsCategory; finished: number; wins: number; losses: number; draws: number }

const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const retention = 72 * 60 * 60 * 1000
const prefix = 'jinro-statistics:'
const reported = new WeakSet<Duel>()
const localPending = new Map<string, Pending>()
let draining = false
let timer: number | undefined

export function reportId(now: number, random: string) {
  const time = now.toString(16).padStart(12,'0')
  return time.slice(0,8) + '-' + time.slice(8) + '-7' + random.slice(15)
}

export function completedNpcReport(duel: Pick<Duel, 'phase' | 'winner' | 'npcDifficulty'>,
  id: string): Report | undefined {
  if (duel.phase !== 'finished' || duel.winner === null) return
  return { id, category: 'npc_' + duel.npcDifficulty as StatisticsCategory,
    result: duel.winner === 'draw' ? 'draw' : duel.winner === 0 ? 'win' : 'loss' }
}

function savePending(entry: Pending) {
  try {
    localStorage.setItem(prefix + entry.report.id, JSON.stringify(entry))
    localPending.delete(entry.report.id)
  } catch { localPending.set(entry.report.id, entry) }
}

function removePending(id: string) {
  localPending.delete(id)
  try { localStorage.removeItem(prefix + id) } catch { /* RAM fallback */ }
}

function listPending() {
  const entries = new Map(localPending)
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix))) {
      try {
        const entry = JSON.parse(localStorage.getItem(key) ?? 'null') as Pending | null
        if (entry?.report?.id === key.slice(prefix.length) && uuid7.test(entry.report.id)
          && Number.isInteger(entry.attempts) && Number.isFinite(entry.due) && !entries.has(entry.report.id)) {
          entries.set(entry.report.id, entry)
        }
      } catch { /* Ignore an invalid queue entry. */ }
    }
  } catch { /* RAM fallback */ }
  return [...entries.values()].filter(entry => {
    const timestamp = parseInt(entry.report.id.slice(0,13).replace('-', ''), 16)
    if (Date.now() - timestamp < retention && entry.attempts < 3) return true
    removePending(entry.report.id)
    return false
  }).sort((a,b) => a.due - b.due)
}

async function drain() {
  if (draining || !navigator.onLine) return
  draining = true
  try {
    const entry = listPending()[0]
    if (!entry || entry.due > Date.now()) return
    entry.attempts++
    entry.due = Date.now() + (entry.attempts === 1 ? 30_000 : 300_000)
    savePending(entry)
    const { onlineClient } = await import('./onlineClient.ts')
    const client = onlineClient()
    try {
      if (await client.reportNpcMatch(entry.report)) removePending(entry.report.id)
    } finally { client.dispose() }
  } catch { /* Reporting must never reject a game action. */ }
  finally {
    draining = false
    schedule()
  }
}

function schedule() {
  if (!statisticsEnabled || draining) return
  window.clearTimeout(timer)
  if (!navigator.onLine) return
  const next = listPending()[0]
  if (next) timer = window.setTimeout(() => void drain(), Math.max(0, next.due - Date.now()))
}

export function startMatchStatistics() {
  if (!statisticsEnabled) return () => {}
  window.addEventListener('online', schedule)
  schedule()
  return () => { window.removeEventListener('online', schedule); window.clearTimeout(timer) }
}

export function queueNpcStatistics(duel: Duel) {
  if (!statisticsEnabled || reported.has(duel)) return
  try {
    const now = Date.now()
    const report = completedNpcReport(duel, reportId(now, crypto.randomUUID()))
    if (!report) return
    reported.add(duel)
    const queue = listPending()
    for (const entry of queue.slice(0, Math.max(0, queue.length - 31))) removePending(entry.report.id)
    savePending({ report, attempts: 0, due: now })
    schedule()
  } catch { /* A result must render even when storage or reporting is unavailable. */ }
}

export function parseStatistics(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid statistics')
  const { startedAt, rows } = value as { startedAt?: string; rows?: StatisticsRow[] }
  if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))
    || !Array.isArray(rows) || rows.length !== statisticsCategories.length) throw new Error('Invalid statistics')
  const seen = new Set<StatisticsCategory>()
  for (const row of rows) {
    if (!row || !statisticsCategories.includes(row.category) || seen.has(row.category)
      || ![row.finished, row.wins, row.losses, row.draws].every(n => Number.isSafeInteger(n) && n >= 0)
      || (row.category === 'online'
        ? row.wins !== 0 || row.losses !== 0 || row.draws > row.finished
        : row.finished !== row.wins + row.losses + row.draws)) throw new Error('Invalid statistics')
    seen.add(row.category)
  }
  return { startedAt, rows }
}
