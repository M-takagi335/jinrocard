export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).end()
  }
  if (new URL(req.url, 'https://localhost').search) return res.status(400).end()
  const base = process.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (process.env.VITE_MATCH_STATS_ENABLED !== 'true' || !base || !key?.startsWith('sb_publishable_')) return res.status(503).end()
  try {
    const origin = await fetch(base + '/rest/v1/rpc/read_match_statistics', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(4500),
    })
    if (!origin.ok) return res.status(503).end()
    const data = await origin.json()
    if (!data?.startedAt || !Array.isArray(data.rows) || data.rows.length !== 5) return res.status(503).end()
    const payload = {
      startedAt: data.startedAt,
      rows: data.rows.map(({ category, finished, wins, losses, draws }) => ({ category, finished, wins, losses, draws })),
    }
    res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=60')
    return res.status(200).json(payload)
  } catch { return res.status(503).end() }
}
