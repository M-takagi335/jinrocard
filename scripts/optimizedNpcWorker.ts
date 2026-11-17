import type { Play } from '../src/duel.ts'
import { chooseStrongNpc } from '../src/strongNpc.ts'
import { experimentalStrongNpc, type ExperimentalView } from './experimentalStrongNpc.ts'

export type NpcWorkerRequest = Readonly<{ view: ExperimentalView; seed: number }>
export function npcRandom(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000
}

// Each request gets its own worker and immutable public snapshot. Integrators
// must recheck the night/token and canLock when applying an async response.
export function requestOptimizedNpc(request: NpcWorkerRequest, create: () => Worker, timeoutMs = 1500): Promise<Play[]> {
  return new Promise(resolve => {
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false
    const complete = (result?: Play[]) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker?.terminate()
      resolve(result ?? chooseStrongNpc(request.view, npcRandom(request.seed)))
    }
    try {
      worker = create()
      worker.onmessage = (event: MessageEvent<Play[] | null>) => complete(event.data ?? undefined)
      worker.onerror = () => complete()
      worker.onmessageerror = () => complete()
      timer = setTimeout(complete, timeoutMs)
      worker.postMessage(request)
    } catch {
      complete()
    }
  })
}

export function runOptimizedNpc({ view, seed }: NpcWorkerRequest): Play[] {
  return experimentalStrongNpc(view, npcRandom(seed), {
    assassin: true, assassinIntel: true, lookahead: true, accurateFuture: true, fast: true,
  })
}
