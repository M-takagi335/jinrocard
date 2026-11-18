import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

const project = Deno.env.get('SUPABASE_URL')!
const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_ANON_KEY')
const secret = Deno.env.get('JINRO_SERVER_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
  ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const auth = createClient(project, publishable, options)
const db = createClient(project, secret, options)

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type' }
const reply = (status: number) => new Response(null, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })
const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const categories = new Set(['npc_easy', 'npc_standard', 'npc_strong', 'npc_strongest'])
const results = new Set(['win', 'loss', 'draw'])

async function parse(req: Request) {
  const reader = req.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let length = 0, text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 512) { await reader.cancel(); return }
    text += decoder.decode(value, { stream: true })
  }
  const input = JSON.parse(text + decoder.decode())
  if (!input || typeof input !== 'object' || Object.keys(input).length !== 3) return
  if (typeof input.id !== 'string' || !uuid7.test(input.id) ||
      !categories.has(input.category) || !results.has(input.result)) return
  return input as { id: string; category: string; result: string }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return reply(204)
  if (req.method !== 'POST') return reply(405)
  const token = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if (!token) return reply(401)
  const input = await parse(req).catch(() => undefined)
  if (!input) return reply(400)
  try {
    const { data, error } = await auth.auth.getUser(token)
    if (error?.status && error.status >= 500) return reply(503)
    if (error || !data.user?.is_anonymous) return reply(401)
    const { data: result, error: dbError } = await db.rpc('report_npc_match', {
      p_uid: data.user.id, p_id: input.id, p_category: input.category, p_result: input.result,
    })
    if (dbError) return reply(503)
    switch (result) {
      case 'accepted': case 'duplicate': return reply(204)
      case 'conflict': return reply(409)
      case 'invalid': return reply(400)
      case 'limited': return reply(429)
      default: return reply(503)
    }
  } catch { return reply(503) }
})
