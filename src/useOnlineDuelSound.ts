import { useLayoutEffect, useRef, type RefObject } from 'react'
import { audioEpoch, playPresentedEffects } from './audio.ts'
import { presentOnlineSound, soundCues, type Effect, type PresentedSound, type SoundFrame } from './soundEvents.ts'

export function useOnlineDuelSound(roomId: string | undefined, frame: SoundFrame | undefined,
  panel: RefObject<HTMLElement | null>, resyncing: boolean) {
  const last = useRef<{ roomId: string; epoch: number; state: PresentedSound } | undefined>(undefined)
  const resyncPending = useRef(false)
  const night = frame?.night
  const signature = frame && soundCues(frame).join(',')

  useLayoutEffect(() => {
    if (!roomId || night === undefined || signature === undefined) {
      last.current = undefined
      resyncPending.current = false
      return
    }
    if (resyncing) resyncPending.current = true
    const cues = signature.split(',') as Effect[]
    let afterPaint = 0
    // The first callback is before paint. The second runs after the browser
    // has had a frame to show the committed battle UI.
    const beforePaint = requestAnimationFrame(() => {
      afterPaint = requestAnimationFrame(() => {
        const element = panel.current
        if (!element?.getClientRects().length || (cues.includes('reveal') && !element.querySelector('.reveal'))) return
        const previous = last.current?.roomId === roomId ? last.current : undefined
        const epoch = audioEpoch()
        const quiet = resyncPending.current || document.hidden || !!previous && previous.epoch !== epoch
        const { state, play } = presentOnlineSound(night, cues, previous?.state, quiet)
        last.current = { roomId, epoch, state }
        resyncPending.current = resyncing
        playPresentedEffects(play)
      })
    })
    return () => {
      cancelAnimationFrame(beforePaint)
      cancelAnimationFrame(afterPaint)
    }
  }, [roomId, night, signature, panel, resyncing])
}
