import { runOptimizedNpc, type NpcWorkerRequest } from './optimizedNpcWorker.ts'

self.addEventListener('message', (event: MessageEvent<NpcWorkerRequest>) => {
  try { self.postMessage(runOptimizedNpc(event.data)) }
  catch { self.postMessage(null) }
})
