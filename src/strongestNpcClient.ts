import { ROLES, type Role } from './cards.ts'
import type { Play } from './duel.ts'
import { chooseStrongNpc } from './strongNpc.ts'
import { strongestRandom, type StrongestNpcView } from './strongestNpc.ts'

export type StrongestRequest = Readonly<{
  id: number
  view: StrongestNpcView
  seed: number
}>

function isPlayList(value: unknown): value is Play[] {
  if (!Array.isArray(value) || value.length > 2) return false
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.id) ||
        (entry.guess !== undefined && !ROLES.includes(entry.guess as Role))) return false
  }
  return true
}

let lastRequest = 0
export function requestStrongestNpc(view: StrongestNpcView, seed: number, signal: AbortSignal,
  submit: (moves: Play[]) => boolean,
  create = () => new Worker(new URL('./strongestNpc.worker.ts', import.meta.url), { type: 'module' }),
  timeoutMs = 1500): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  const id = ++lastRequest
  return new Promise(resolve => {
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const finish = (response?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      clearTimeout(timer)
      worker?.terminate()
      if (signal.aborted) {
        resolve(false)
        return
      }
      if (isPlayList(response) && submit(response)) {
        resolve(true)
        return
      }
      // The same fair snapshot is used even if the player selected cards while waiting.
      resolve(submit(chooseStrongNpc(view, strongestRandom(seed))))
    }
    const abort = () => finish()
    signal.addEventListener('abort', abort, { once: true })
    try {
      worker = create()
      worker.onmessage = ({ data }) => {
        if (data?.id === id && data?.night === view.night) finish(data.plays)
      }
      worker.onerror = () => finish()
      worker.onmessageerror = () => finish()
      timer = setTimeout(finish, timeoutMs)
      worker.postMessage({ id, view, seed } satisfies StrongestRequest)
    } catch {
      finish()
    }
  })
}
