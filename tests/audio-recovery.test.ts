import assert from 'node:assert/strict'
import test from 'node:test'
import { initAudio, playPresentedEffects } from '../src/audio.ts'

test('a failed SE preload retries on a new cue without replaying the missed cue', async t => {
  let now = 0
  let starts = 0
  let attempts = 0
  let finishFetch!: (response: Response) => void
  const events = new EventTarget()
  const replace = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : Reflect.deleteProperty(globalThis, name))
  }
  replace('document', events)
  replace('localStorage', { getItem: () => '{"musicOn":false}' })
  replace('cancelAnimationFrame', () => {})
  replace('performance', { now: () => now })
  replace('Audio', class { paused = true; pause() {} })
  replace('AudioContext', class {
    state = 'running'
    currentTime = 0
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} } }
    createMediaElementSource() { return { connect: () => ({ connect() {} }) } }
    async decodeAudioData() { return {} }
    createBufferSource() { return { connect() {}, start() { starts++ } } }
  })
  replace('fetch', async (url: string) => {
    if (!url.endsWith('03_card_reveal.mp3')) return new Response(new Uint8Array(1))
    attempts++
    if (attempts === 1) throw new TypeError('offline')
    return new Promise<Response>(resolve => { finishFetch = resolve })
  })
  const settle = () => new Promise(resolve => setImmediate(resolve))
  initAudio()
  events.dispatchEvent(new Event('click'))
  await settle()
  playPresentedEffects(['reveal'])
  assert.equal(attempts, 1)
  assert.equal(starts, 0)
  now = 501
  await settle()
  assert.equal(attempts, 1)
  playPresentedEffects(['reveal'])
  playPresentedEffects(['reveal'])
  assert.equal(attempts, 2)
  finishFetch(new Response(new Uint8Array(1)))
  await settle()
  assert.equal(starts, 0)
  playPresentedEffects(['reveal'])
  playPresentedEffects(['reveal'])
  assert.equal(starts, 2)
  assert.equal(attempts, 2)
})
