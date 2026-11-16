import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { applyCommand, gameView, newRoom, parseCommand, RoomError, type OnlineView, type RoomState } from '../../../src/onlineProtocol.ts'
import type { Side } from '../../../src/duel.ts'

type Row = {
  id: string; code: string; host_id: string; guest_id: string | null; revision: number; state: RoomState
  host_seen: string; guest_seen: string | null; expires_at: string
}
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const codePattern = /^[A-HJ-NP-Z2-9]{10}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })
const project = Deno.env.get('SUPABASE_URL')!
const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_ANON_KEY')
const secret = Deno.env.get('JINRO_SERVER_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
  ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const auth = createClient(project, publishable, options)
const db = createClient(project, secret, options)
const member = (row: Row, id: string): Side | null => row.host_id === id ? 0 : row.guest_id === id ? 1 : null
function view(row: Row, side: Side): OnlineView {
  const { state } = row
  const fresh = (at: string | null) => !!at && Date.now() - Date.parse(at) < 45_000
  return { id: row.id, code: row.code, revision: row.revision, side, phase: state.phase,
    joined: row.guest_id !== null, ready: state.ready, left: state.left,
    connected: [!state.left[0] && fresh(row.host_seen), !state.left[1] && fresh(row.guest_seen)],
    ownDeck: state.decks[side], game: gameView(state, side) }
}
function live(row: Row) {
  if (Date.parse(row.expires_at) <= Date.now()) return false
  return row.state.phase !== 'playing'
    || [row.host_seen, row.guest_seen].every(at => at && Date.now() - Date.parse(at) < 1_845_000)
}
async function body(req: Request) {
  const reader = req.body?.getReader()
  if (!reader) throw new RoomError('操作が無効です。')
  const decoder = new TextDecoder()
  let text = '', length = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 4096) { await reader.cancel(); throw new RoomError('操作が大きすぎます。') }
    text += decoder.decode(value, { stream: true })
  }
  try { return JSON.parse(text + decoder.decode()) as Record<string, unknown> }
  catch { throw new RoomError('操作が無効です。') }
}
async function find(column: 'id' | 'code', value: string): Promise<Row | null> {
  const { data, error } = await db.from('online_rooms').select('*').eq(column, value).maybeSingle()
  if (error) throw error
  return data as Row | null
}
const unavailable = () => json({ message: 'ルームが見つからないか、有効期限が切れています。', gone: true }, 404)
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ message: '操作が無効です。' }, 405)
  try {
    const token = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token) return json({ message: 'ゲスト認証が必要です。' }, 401)
    const { data: { user }, error: authError } = await auth.auth.getUser(token)
    if (authError || !user?.is_anonymous) return json({ message: 'ゲスト認証を確認できません。' }, 401)
    const uid = user.id
    const input = await body(req)
    if (!input || typeof input !== 'object') throw new RoomError('操作が無効です。')
    const { op, request, id, code } = input
    const { data: allowed, error: rateError } = await db.rpc('online_rate_hit', {
      p_bucket: uid + (op === 'create' || op === 'join' ? ':entry' : ':game'),
      p_limit: op === 'create' || op === 'join' ? 8 : 100,
    })
    if (rateError) throw rateError
    if (!allowed) return json({ message: '操作が多すぎます。少し待って再試行してください。' }, 429)
    if (op === 'create') {
      if (typeof request !== 'string' || !uuid.test(request)) throw new RoomError('操作が無効です。')
      const deck = parseCommand({ kind: 'deck', cards: input.cards })
      if (deck.kind !== 'deck') throw new RoomError('デッキが無効です。')
      for (let attempt = 0; attempt < 6; attempt++) {
        const { data: previous, error: lookupError } = await db.from('online_rooms').select('*')
          .eq('host_id', uid).eq('request_id', request).maybeSingle()
        if (lookupError) throw lookupError
        if (previous) return live(previous) ? json(view(previous, 0)) : unavailable()
        const invite = Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => alphabet[byte & 31]).join('')
        const { data, error } = await db.from('online_rooms').insert({
          code: invite, host_id: uid, request_id: request, state: newRoom(deck.cards),
        }).select('*').single()
        if (!error) return json(view(data, 0))
        if (error.code !== '23505') throw error
      }
      return json({ message: 'ルームを作成できませんでした。再試行してください。' }, 503)
    }
    if (op === 'join' ? typeof code !== 'string' || !codePattern.test(code) : typeof id !== 'string' || !uuid.test(id))
      throw new RoomError('ルームコードまたはルームIDが無効です。')
    if (op !== 'join' && op !== 'status' && op !== 'command') throw new RoomError('操作が無効です。')
    const command = op === 'command' ? parseCommand(input.command) : null
    if (command && (typeof request !== 'string' || !uuid.test(request))) throw new RoomError('操作が無効です。')
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await (op === 'join' ? find('code', code as string) : find('id', id as string))
      if (!row || !live(row)) return unavailable()
      const side = member(row, uid)
      const joining = side === null && op === 'join'
      if (side === null && !joining) return unavailable()
      if (joining && (row.guest_id || row.state.phase !== 'lobby' || row.state.left.some(Boolean)))
        return json({ message: 'ルームが満員か、受付を終了しています。' }, 409)
      if (!joining && row.state.left[side!] && command?.kind !== 'leave') return unavailable()
      if (op === 'status' || op === 'join' && !joining) {
        const { data, error } = await db.rpc('online_touch', { p_id: row.id, p_uid: uid })
        if (error) throw error
        return data?.[0] ? json(view(data[0], side!)) : unavailable()
      }
      const actor = joining ? 1 : side!
      if (command) {
        if (row.state.receipts[actor].includes(request as string)) return json(view(row, actor))
        applyCommand(row.state, actor, command, row.guest_id !== null)
        row.state.receipts[actor].push(request as string)
      }
      const { data, error } = await db.rpc('online_commit', {
        p_id: row.id, p_revision: row.revision, p_uid: uid, p_join: joining, p_state: row.state,
      })
      if (error) throw error
      if (data?.[0]) return json(view(data[0], actor))
    }
    return json({ message: '操作が重なりました。再試行してください。' }, 409)
  } catch (failure) {
    if (failure instanceof RoomError) return json({ message: failure.message }, 400)
    return json({ message: '現在オンライン対戦を利用できません。NPC対戦は引き続き遊べます。' }, 503)
  }
})

