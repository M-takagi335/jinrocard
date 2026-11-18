import assert from 'node:assert/strict'
import test from 'node:test'
import { completedNpcReport, parseStatistics, reportId, statisticsCategories } from '../src/matchStatistics.ts'
import { NPC_DIFFICULTIES, type NpcDifficulty } from '../src/strongNpc.ts'
import handler from '../api/match-statistics.js'

const random = '01234567-89ab-4fed-8f00-abcdef012345'
const id = reportId(0x019abc56de78, random)
const valid = () => ({
  startedAt: '2026-11-18T00:00:00Z',
  rows: statisticsCategories.map(category => category === 'online'
    ? { category, finished: 2, wins: 0, losses: 0, draws: 1 }
    : { category, finished: 4, wins: 2, losses: 1, draws: 1 }),
})

test('match report UUID encodes its immutable expiration anchor', () => {
  assert.equal(id, '019abc56-de78-7fed-8f00-abcdef012345')
  assert.notEqual(reportId(0x019abc56de79, random), id)
})

test('completed NPC reports preserve the player outcome for all four difficulties', () => {
  for (const npcDifficulty of Object.keys(NPC_DIFFICULTIES) as NpcDifficulty[]) {
    for (const [winner, result] of [[0,'win'],[1,'loss'],['draw','draw']] as const) {
      assert.deepEqual(completedNpcReport({ phase: 'finished', winner, npcDifficulty }, id),
        { id, category: 'npc_' + npcDifficulty, result })
    }
  }
})

test('a cancelled or active NPC match has no report', () => {
  assert.equal(completedNpcReport({ phase: 'select', winner: null, npcDifficulty: 'easy' }, id), undefined)
  assert.equal(completedNpcReport({ phase: 'finished', winner: null, npcDifficulty: 'easy' }, id), undefined)
})

test('public statistics reject missing, duplicate, inconsistent and unsafe totals', () => {
  assert.deepEqual(parseStatistics(valid()), valid())
  const bad = [
    { ...valid(), startedAt: 'not a date' },
    { ...valid(), rows: valid().rows.slice(0,4) },
    { ...valid(), rows: Array(5).fill(valid().rows[0]) },
    { ...valid(), rows: valid().rows.map(row => ({ ...row, wins: 8 })) },
    { ...valid(), rows: valid().rows.map(row => ({ ...row, finished: Number.MAX_SAFE_INTEGER + 1 })) },
  ]
  for (const value of bad) assert.throws(() => parseStatistics(value), /Invalid statistics/)
})

async function request(method = 'GET', url = '/api/match-statistics') {
  const response = { status: 0, headers: {} as Record<string,string>, data: undefined as unknown }
  const res = {
    setHeader(name: string, value: string) { response.headers[name] = value },
    status(code: number) { response.status = code; return res },
    json(data: unknown) { response.data = data },
    end() {},
  }
  await handler({ method, url }, res)
  return response
}

test('the read proxy caches only successful public aggregates and excludes extra fields', async t => {
  t.mock.method(globalThis,'fetch',async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://stats.test/rest/v1/rpc/read_match_statistics')
    assert.deepEqual(init.headers, { apikey: 'sb_publishable_test', 'Content-Type': 'application/json' })
    const source = valid()
    return Response.json({ ...source, user: 'unexpected', rows: source.rows.map(row => ({...row, private: 'unexpected'})) })
  })
  const keys = { VITE_SUPABASE_URL:'https://stats.test', VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',
    VITE_MATCH_STATS_ENABLED:'true' }
  for (const [key,value] of Object.entries(keys)) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const result = await request()
  assert.equal(result.status,200)
  assert.deepEqual(result.data,valid())
  assert.match(result.headers['Vercel-CDN-Cache-Control'], /s-maxage=60/)
  assert.equal((await request('POST')).status,405)
  assert.equal((await request('GET','/api/match-statistics?cache=off')).status,400)
})

test('a statistics access while rollout is disabled does not call Supabase', async t => {
  const before = process.env.VITE_MATCH_STATS_ENABLED
  process.env.VITE_MATCH_STATS_ENABLED = 'false'
  t.after(() => {
    if (before === undefined) delete process.env.VITE_MATCH_STATS_ENABLED
    else process.env.VITE_MATCH_STATS_ENABLED = before
  })
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected statistics request'))
  const result = await request()
  assert.equal(result.status,503)
  assert.deepEqual(result.headers, { 'Cache-Control': 'no-store' })
})
