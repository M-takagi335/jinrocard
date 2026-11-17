import assert from 'node:assert/strict'
import test from 'node:test'
import { onlineRequestLifetime } from '../src/onlineRequestLifetime.ts'

test('closing invalidates pending writes and reads before a new room remembers its ID', async () => {
  const requests = onlineRequestLifetime()
  let finishCreate!: (id: string) => void
  let finishStatus!: (id: string | null) => void
  let remembered = 'existing'
  const createIsCurrent = requests.capture()
  const statusIsCurrent = requests.capture()
  const create = new Promise<string>(resolve => { finishCreate = resolve }).then(id => {
    if (createIsCurrent()) remembered = id
  })
  const status = new Promise<string | null>(resolve => { finishStatus = resolve }).then(id => {
    if (statusIsCurrent()) remembered = id ?? ''
  })
  requests.invalidate()
  assert.equal(remembered, 'existing')
  assert.ok(requests.capture()())
  remembered = 'new-room'
  finishCreate('abandoned-room')
  finishStatus(null)
  await Promise.all([create, status])
  assert.equal(remembered, 'new-room')
})
