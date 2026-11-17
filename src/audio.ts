import { effects, type Effect, type Track } from './soundEvents.ts'

export type AudioSettings = { music: number; effects: number; musicOn: boolean; effectsOn: boolean }
const storageKey = 'jinro-audio-settings'
const defaults: AudioSettings = { music: .3, effects: .65, musicOn: true, effectsOn: true }
const volume = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
export function loadAudioSettings(storage: Pick<Storage, 'getItem'>): AudioSettings {
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? 'null')
    return {
      music: volume(value?.music, defaults.music),
      effects: volume(value?.effects, defaults.effects),
      musicOn: typeof value?.musicOn === 'boolean' ? value.musicOn : defaults.musicOn,
      effectsOn: typeof value?.effectsOn === 'boolean' ? value.effectsOn : defaults.effectsOn,
    }
  } catch { return { ...defaults } }
}

let settings = { ...defaults }
let desired: Track = 1
let current: Track | undefined
let player: HTMLAudioElement | undefined
let context: AudioContext | undefined
let musicGain: GainNode | undefined
let effectGain: GainNode | undefined
let fadeFrame = 0
let gain = 1
let enabled = false
let initialized = false
let cueTime = 0
let lastSelect = -Infinity
let epoch = 0
const buffers = new Map<Effect, Promise<AudioBuffer | undefined>>()
const retryEffectAfter = new Map<Effect, number>()
const readyBuffers = new Map<Effect, AudioBuffer>()
const base = './audio/'
const soundUrl = (effect: Effect) => base + 'se/' + effects[effect] + '.mp3'
export const audioEpoch = () => epoch
export const audioSettings = () => settings

function loadEffect(effect: Effect, preload = false) {
  const audioContext = context
  if (!audioContext) return
  const retryAfter = retryEffectAfter.get(effect)
  if (retryAfter !== undefined && (preload || performance.now() < retryAfter)) return Promise.resolve(undefined)
  if (!buffers.has(effect)) {
    buffers.set(effect, fetch(soundUrl(effect), retryAfter === undefined ? undefined : { cache: 'reload' }).then(response => {
      if (!response.ok) throw new Error('Sound unavailable')
      return response.arrayBuffer()
    }).then(data => audioContext.decodeAudioData(data)).then(buffer => {
      retryEffectAfter.delete(effect)
      readyBuffers.set(effect, buffer)
      return buffer
    }).catch(() => {
      buffers.delete(effect)
      retryEffectAfter.set(effect, performance.now() + 500)
      return undefined
    }))
  }
  return buffers.get(effect)
}

function applyLevel(level: number) {
  gain = level
  const result = level * settings.music
  if (musicGain) musicGain.gain.value = result
  else if (player) player.volume = result
}

function fade(to: number, duration: number, done?: () => void) {
  cancelAnimationFrame(fadeFrame)
  const from = gain
  const start = performance.now()
  const frame = (time: number) => {
    const fraction = Math.min(1, (time - start) / duration)
    applyLevel(from + (to - from) * fraction)
    if (fraction < 1) fadeFrame = requestAnimationFrame(frame)
    else done?.()
  }
  fadeFrame = requestAnimationFrame(frame)
}

function updateMusic() {
  const audio = player
  if (!audio) return
  cancelAnimationFrame(fadeFrame)
  if (!enabled || !settings.musicOn || document.hidden) {
    audio.pause()
    return
  }
  if (current === desired) {
    if (!audio.ended && audio.paused) void audio.play().catch(() => {})
    applyLevel(1)
    return
  }
  const switchTrack = () => {
    audio.pause()
    current = desired
    audio.src = base + 'bgm/BGM' + current + '.mp3'
    audio.loop = current !== 4
    applyLevel(0)
    void audio.play().catch(() => {})
    fade(1, 400)
  }
  if (!audio.paused && !audio.ended) fade(0, 350, switchTrack)
  else switchTrack()
}

export function setMusic(track: Track) {
  if (desired === track) return
  desired = track
  updateMusic()
}

export function saveAudioSettings(next: AudioSettings) {
  const previous = settings
  settings = next
  try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* unavailable */ }
  if (effectGain) effectGain.gain.value = next.effectsOn ? next.effects : 0
  if (previous.effectsOn && !next.effectsOn) {
    epoch++
    cueTime = 0
  }
  if (!previous.effectsOn && next.effectsOn) {
    for (const effect of Object.keys(effects) as Effect[]) void loadEffect(effect, true)
  }
  if (previous.musicOn !== next.musicOn) updateMusic()
  else applyLevel(gain)
}

export function initAudio() {
  if (initialized) return
  initialized = true
  try { settings = loadAudioSettings(localStorage) } catch { /* unavailable */ }

  const unlock = () => {
    if (!player) {
      player = new Audio()
      player.preload = 'auto'
      try {
        context = new AudioContext()
        musicGain = context.createGain()
        effectGain = context.createGain()
        effectGain.gain.value = settings.effectsOn ? settings.effects : 0
        context.createMediaElementSource(player).connect(musicGain).connect(context.destination)
        effectGain.connect(context.destination)
        if (settings.effectsOn) for (const effect of Object.keys(effects) as Effect[]) void loadEffect(effect, true)
      } catch { /* Native media playback remains available. */ }
    }
    if (context?.state !== 'running') void context?.resume().catch(() => {})
    if (!enabled || player.paused && !player.ended) {
      enabled = true
      updateMusic()
    }
  }
  // Click also covers keyboard activation and iOS releases after a tap.
  document.addEventListener('click', unlock, true)
  document.addEventListener('keydown', unlock, true)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      epoch++
      cueTime = 0
    } else if (enabled && context?.state !== 'running') void context?.resume().catch(() => {})
    updateMusic()
  })
}

export function playEffects(cues: readonly Effect[]) {
  if (!enabled || !settings.effectsOn || document.hidden) return
  const token = epoch
  const now = performance.now()
  for (const effect of cues) {
    if (effect === 'select' && now - lastSelect < 90) continue
    if (effect === 'select') lastSelect = now
    const at = effect === 'select' ? now : Math.max(now, cueTime)
    if (effect !== 'select') cueTime = at + 170
    const decoded = loadEffect(effect)
    const valid = () => token === epoch && !document.hidden && settings.effectsOn && performance.now() < at + 450
    window.setTimeout(() => {
      if (!valid()) return
      if (context && effectGain && decoded) {
        void decoded.then(buffer => {
          if (!buffer || !valid() || context?.state !== 'running' || !effectGain) return
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(effectGain)
          source.start()
        })
      } else {
        const media = new Audio(soundUrl(effect))
        media.volume = settings.effects
        void media.play().catch(() => {})
      }
    }, at - now)
  }
}

// Screen-bound cues share an onset. Waiting for decoding or the operation
// sound queue here would separate the audio from the already painted screen.
export function playPresentedEffects(cues: readonly Effect[]) {
  if (!enabled || !settings.effectsOn || document.hidden || context?.state !== 'running' || !effectGain) return
  const ready = cues.flatMap(effect => {
    const buffer = readyBuffers.get(effect)
    if (!buffer) void loadEffect(effect)
    return buffer ? [buffer] : []
  })
  if (!ready.length) return
  const mix = context.createGain()
  mix.gain.value = 1 / Math.sqrt(ready.length)
  mix.connect(effectGain)
  let remaining = ready.length
  const at = context.currentTime
  for (const buffer of ready) {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(mix)
    source.onended = () => { if (--remaining === 0) mix.disconnect() }
    source.start(at)
  }
}
