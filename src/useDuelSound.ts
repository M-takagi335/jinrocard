import { useEffect, useRef } from 'react'
import { audioEpoch, playEffects } from './audio.ts'
import type { Duel } from './duel.ts'
import { newSoundCues, type SoundFrame } from './soundEvents.ts'

export function localSoundFrame(duel: Duel, includeResult: boolean): SoundFrame {
  return {
    night: duel.night,
    revealed: duel.revealed.some(cards => cards.length > 0),
    hp: [duel.nightHpChange(0), duel.nightHpChange(1)],
    log: duel.log.filter(event => event.privateTo !== 1),
    result: includeResult && duel.phase === 'finished'
      ? duel.winner === 'draw' ? 'draw' : duel.winner === 0 ? 'victory' : 'defeat'
      : undefined,
  }
}

export function useDuelSound(identity: string | Duel | undefined, frame?: SoundFrame, fresh = false, silent = false) {
  const last = useRef<{ identity: typeof identity; frame?: SoundFrame; epoch: number; silent: boolean } | undefined>(undefined)
  useEffect(() => {
    const previous = last.current
    const epoch = audioEpoch()
    const same = !!identity && previous?.identity === identity
    last.current = { identity, frame, epoch, silent }
    if (!frame) return
    const resumed = !!same && (previous!.epoch !== epoch || previous!.silent)
    playEffects(newSoundCues(frame, same ? previous!.frame : undefined, fresh || !!same, silent || resumed))
  })
}
