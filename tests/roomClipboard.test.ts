import assert from 'node:assert/strict'
import test from 'node:test'
import { copyLobbyField, formatRoomCodeInput, isRoomCode } from '../src/roomClipboard.ts'

const code = 'ABCD234567'
const second = 'EFGH987654'
const url = 'https://jinrocard.vercel.app/?room=' + code

test('lobby copies the exact current code or URL using its own field', async () => {
  const writes: string[] = []
  const clipboard = { async writeText(value: string) { writes.push(value) } }
  const fallback = () => assert.fail('Clipboard API succeeded')
  assert.equal(await copyLobbyField('url', url, clipboard, fallback), true)
  assert.equal(await copyLobbyField('code', code, clipboard, fallback), true)
  assert.equal(await copyLobbyField('code', second, clipboard, fallback), true)
  assert.deepEqual(writes, [url, code, second])
})

test('invalid code values never reach either clipboard path or enable joining', async () => {
  const forbidden = () => assert.fail('Invalid clipboard input')
  for (const value of ['', url, code + '\n', ' ' + code, code + '?', 'ABCD234561']) {
    assert.equal(await copyLobbyField('code', value, { writeText: forbidden }, forbidden), false)
  }
  assert.equal(formatRoomCodeInput(' abcd-234567\n'), code)
  assert.equal(isRoomCode(formatRoomCodeInput(url)), false)
})

test('clipboard denial or lack of an API falls back, and reports only successful writes', async () => {
  const denied = { async writeText() { throw new Error('NotAllowedError') } }
  assert.equal(await copyLobbyField('code', code, undefined, () => true), true)
  assert.equal(await copyLobbyField('code', code, denied, () => true), true)
  assert.equal(await copyLobbyField('code', code, denied, () => false), false)
  assert.equal(await copyLobbyField('code', code, undefined, () => { throw new Error('copy unsupported') }), false)
})
