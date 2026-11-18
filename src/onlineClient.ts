import { createClient, type Session } from '@supabase/supabase-js'
import type { OnlineView } from './onlineProtocol.ts'

const unavailable = '現在オンライン対戦を利用できません。NPC対戦は引き続き遊べます。'
let guestSession: Promise<Session> | undefined
export class OnlineError extends Error {
  constructor(message: string, readonly gone = false, readonly retry = false) { super(message) }
}
export function onlineClient() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key?.startsWith('sb_publishable_')) throw new OnlineError(unavailable)
  const client = createClient(url, key, {
    auth: { storageKey: 'jinro-online-auth', detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }) },
  })
  async function findSession(allowGuest: boolean) {
    const current = await client.auth.getSession()
    if (current.data.session) return current.data.session
    if (!allowGuest) throw new OnlineError('このブラウザで元のゲスト認証を確認できません。', true)
    const { data, error } = await client.auth.signInAnonymously()
    if (error || !data.session) throw new OnlineError('ゲスト認証に失敗しました。時間をおいて再試行してください。', false, true)
    return data.session
  }
  async function session(allowGuest: boolean) {
    if (!allowGuest) return findSession(false)
    const pending = guestSession ??= findSession(true)
    try { return await pending }
    finally { if (guestSession === pending) guestSession = undefined }
  }
  return {
    dispose() { void client.auth.dispose() },
    async reportNpcMatch(payload: { id: string; category: string; result: string }) {
      const credentials = await session(true)
      const response = await fetch(url.replace(/\/$/, '') + '/functions/v1/match-statistics', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key,
          Authorization: 'Bearer ' + credentials.access_token },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
      })
      return response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)
    },
    async request(payload: Record<string, unknown>): Promise<OnlineView> {
      try {
        const credentials = await session(payload.op === 'create' || payload.op === 'join')
        const response = await fetch(url.replace(/\/$/, '') + '/functions/v1/online-duel', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key,
            Authorization: 'Bearer ' + credentials.access_token },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
        })
        const result = await response.json()
        if (!response.ok) throw new OnlineError(result.message ?? unavailable, !!result.gone, response.status >= 500 || response.status === 429)
        return result
      } catch (failure) {
        if (failure instanceof OnlineError) throw failure
        throw new OnlineError(unavailable, false, true)
      }
    },
    subscribe(id: string, refresh: () => void) {
      const channel = client.channel('duel:' + id, { config: { private: true } })
      let disposed = false
      void (async () => {
        try {
          const credentials = await session(false)
          await client.realtime.setAuth(credentials.access_token)
          if (disposed) return
          channel.on('broadcast', { event: 'changed' }, refresh).subscribe(status => {
            if (status === 'SUBSCRIBED') refresh()
          })
        } catch { /* The status poll also works without a WebSocket. */ }
      })()
      return () => { disposed = true; void client.removeChannel(channel) }
    },
  }
}
