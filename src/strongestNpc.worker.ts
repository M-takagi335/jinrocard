import { chooseStrongestNpc, strongestRandom } from './strongestNpc.ts'
import type { StrongestRequest } from './strongestNpcClient.ts'

self.addEventListener('message', ({ data }: MessageEvent<StrongestRequest>) => {
  const { id, view, seed } = data
  try { self.postMessage({ id, night: view.night, plays: chooseStrongestNpc(view, strongestRandom(seed)) }) }
  catch { self.postMessage({ id, night: view.night, plays: null }) }
})
