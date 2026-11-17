import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAudioSettings } from '../src/audio.ts'
import { battleTrack, newSoundCues, soundCues, type SoundFrame } from '../src/soundEvents.ts'

const start: SoundFrame = { night: 1, revealed: false, hp: [{ lost: 0, gained: 0 }], log: [
  { night: 1, text: 'プレイヤーAは1枚引いた。' },
  { night: 1, text: 'プレイヤーBは1枚引いた。' },
] }
const reveal = { ...start, revealed: true }

test('music transitions from ordinary to late nights and uses the result track', () => {
  assert.deepEqual([1, 10, 11, 15].map(night => battleTrack(night)), [2, 2, 3, 3])
  assert.equal(battleTrack(5, true), 4)
  assert.equal(battleTrack(15, true), 4)
})

test('cues follow confirmed effects, not card use, zero healing or normal draws', () => {
  assert.deepEqual(soundCues(start), ['night'])
  const defended = { ...reveal, log: [...start.log, { night: 1, text: 'プレイヤーAの狩人が襲撃を防いだ。' }] }
  assert.deepEqual(newSoundCues(defended, reveal, true, false), ['defense'])
  const frame = { ...defended, hp: [{ lost: 3, gained: 2 }], log: [...defended.log,
    { night: 1, text: 'プレイヤーBの密偵は条件を満たさなかった。' },
    { night: 1, text: 'プレイヤーAの占い師が確認：人狼' },
    { night: 1, text: 'プレイヤーAは2枚引いた。' },
  ] }
  assert.deepEqual(newSoundCues(frame, defended, false, false), ['damage', 'heal', 'special'])
  const publicOnly = { ...reveal, log: [...start.log, { night: 1, text: 'プレイヤーAの魔女を使用した。' },
    { night: 1, text: 'プレイヤーAはHPを0回復した。' }, { night: 1, text: 'プレイヤーAの占い師が確認：対象なし' }] }
  assert.deepEqual(newSoundCues(publicOnly, reveal, false, false), [])
})

test('duplicates, reloads and catch-up sound frames stay quiet', () => {
  const end: SoundFrame = { ...reveal, hp: [{ lost: 2, gained: 0 }], result: 'victory' }
  assert.deepEqual(newSoundCues(end, reveal, false, false), ['damage', 'victory'])
  assert.deepEqual(newSoundCues(end, structuredClone(end), false, false), [])
  assert.deepEqual(newSoundCues(end, undefined, false, false), [])
  assert.deepEqual(newSoundCues(end, reveal, false, true), [])
  assert.deepEqual(newSoundCues({ ...end, night: 4 }, end, false, false), [])
  assert.deepEqual(newSoundCues({ ...start, night: 2 }, end, false, false), ['night'])
  assert.ok(!soundCues({ ...end, result: 'draw' }).some(cue => cue === 'defeat' || cue === 'victory'))
  assert.ok(soundCues({ ...end, result: 'defeat' }).includes('defeat'))
})

test('audio settings restore volumes and mute flags and normalize malformed values', () => {
  assert.deepEqual(loadAudioSettings({ getItem: () => null }), { music: .3, effects: .65, musicOn: true, effectsOn: true })
  assert.deepEqual(loadAudioSettings({ getItem: () => '{"music":0.27,"effects":0.9,"musicOn":false,"effectsOn":false}' }),
    { music: .27, effects: .9, musicOn: false, effectsOn: false })
  assert.deepEqual(loadAudioSettings({ getItem: () => '{"music":2,"effects":-1,"musicOn":0}' }),
    { music: 1, effects: 0, musicOn: true, effectsOn: true })
})
