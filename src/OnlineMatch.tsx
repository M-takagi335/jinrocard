import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ROLES, RULES, STARTER, card, validDeck, type Role } from './cards.ts'
import { CardDetail } from './CardDetail.tsx'
import { CardTile } from './CardTile.tsx'
import { DeckCardList } from './DeckCardList.tsx'
import { DeckViewer } from './DeckViewer.tsx'
import type { MatchDeck } from './decks.ts'
import type { Play, Side } from './duel.ts'
import { DECK_TYPES, PROFILES, generateDeck, type DeckType } from './generateDeck.ts'
import { InvestigationPanel } from './InvestigationPanel.tsx'
import { OnlineError, onlineClient } from './onlineClient.ts'
import type { Command, OnlineView } from './onlineProtocol.ts'
import { DeckComposition, Sheet } from './Sheet.tsx'

const activeRoom = 'jinro-online-room'
const getRoom = () => { try { return localStorage.getItem(activeRoom) } catch { return null } }
function remember(id: string | null) {
  try { if (id) localStorage.setItem(activeRoom, id); else localStorage.removeItem(activeRoom) } catch { /* unavailable */ }
}
function clearInvite() {
  const url = new URL(location.href)
  if (!url.searchParams.has('room')) return
  url.searchParams.delete('room')
  history.replaceState(null, '', url)
}
const formatCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '').slice(0, 10)
type RequestPayload = Record<string, unknown>
type PendingRequest = [payload: RequestPayload, preparation?: RequestPayload]

export default function OnlineMatch({ options, onClose }: { options: MatchDeck[]; onClose: () => void }) {
  const [client] = useState(() => { try { return onlineClient() } catch { return null } })
  const [room, setRoom] = useState<OnlineView | null>(null)
  const [connectedRoom, setConnectedRoom] = useState(() => new URLSearchParams(location.search).has('room') ? null : getRoom())
  const [code, setCode] = useState(() => formatCode(new URLSearchParams(location.search).get('room') ?? ''))
  const [mode, setMode] = useState<'create' | 'join'>(() => code ? 'join' : 'create')
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<PendingRequest | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [peek, setPeek] = useState<Role>()
  const [deckPreview, setDeckPreview] = useState(false)
  const [mine, setMine] = useState(false)
  const [selected, setSelected] = useState('standard')
  const [generated, setGenerated] = useState<Partial<Record<DeckType, Role[]>>>({})
  const [plays, setPlays] = useState<Play[]>([])
  const [dialog, setDialog] = useState<'investigations' | 'own' | 'enemy' | 'own-discard' | 'enemy-discard'>()
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set())
  const writeInFlight = useRef(false)
  const refreshing = useRef(false)
  const refreshQueued = useRef(false)
  const refreshFailures = useRef(0)
  const closedRooms = useRef(new Set<string>())
  const game = room?.game
  const chosen = (selected === 'room-current' ? room?.ownDeck : generated[selected as DeckType])
    ?? options.find(deck => deck.id === selected)?.cards ?? STARTER
  const deckMatches = room?.ownDeck?.join(',') === chosen.join(',')
  const opponent = (room ? 1 - room.side : 1) as Side
  const invite = useMemo(() => {
    if (!room) return ''
    const url = new URL(location.pathname, location.origin)
    url.searchParams.set('room', room.code)
    return url.href
  }, [room?.code])

  const accept = useCallback((update: OnlineView) => {
    if (closedRooms.current.has(update.id)) return
    setRoom(previous => previous?.id === update.id && previous.revision > update.revision ? previous : update)
    refreshFailures.current = 0
    setDegraded(false)
  }, [])

  const reload = useCallback(async () => {
    if (!client || !connectedRoom || closedRooms.current.has(connectedRoom) || refreshFailures.current >= 3) return
    if (refreshing.current) {
      refreshQueued.current = true
      return
    }
    refreshing.current = true
    try {
      const update = await client.request({ op: 'status', id: connectedRoom })
      if (!closedRooms.current.has(connectedRoom)) {
        accept(update)
        setSyncError('')
      }
    } catch (failure) {
      if (closedRooms.current.has(connectedRoom)) return
      if (failure instanceof OnlineError && failure.gone) {
        closedRooms.current.add(connectedRoom)
        remember(null)
        setConnectedRoom(null)
        setRoom(null)
        setRetry(null)
        setError(failure.message)
      } else {
        refreshFailures.current++
        setDegraded(true)
      }
      setSyncError(failure instanceof Error ? failure.message : '通信エラーです。')
    } finally {
      refreshing.current = false
      if (refreshQueued.current) {
        refreshQueued.current = false
        void reload()
      }
    }
  }, [client, connectedRoom, accept])
  const reconnect = useCallback(() => { refreshFailures.current = 0; void reload() }, [reload])

  useEffect(() => () => client?.dispose(), [client])
  useEffect(() => {
    if (!client || !connectedRoom) return
    const sync = () => { if (document.visibilityState === 'visible') void reload() }
    const wake = () => { if (document.visibilityState === 'visible') reconnect() }
    void reload()
    const unsubscribe = client.subscribe(connectedRoom, sync)
    const timer = window.setInterval(sync, 12_000)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('pageshow', wake)
    return () => {
      unsubscribe()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('pageshow', wake)
    }
  }, [client, connectedRoom, reload, reconnect])
  useEffect(() => { setPlays([]) }, [game?.night, room?.id])
  useEffect(() => {
    if (room?.ownDeck && !generated[selected as DeckType] && room.ownDeck.join(',') !== chosen.join(',')) {
      const saved = options.find(option => option.cards.join(',') === room.ownDeck?.join(','))
      setSelected(saved?.id ?? 'room-current')
    }
    // Restore the room's applied deck once when entering from a saved browser session.
  }, [room?.id])

  async function send(payload: RequestPayload, preparation?: RequestPayload) {
    if (!client || writeInFlight.current) return
    writeInFlight.current = true
    setBusy(true)
    setError('')
    setSyncError('')
    setFeedback('')
    try {
      if (preparation) {
        const registered = await client.request(preparation)
        accept(registered)
      }
      const update = await client.request(payload)
      setRetry(null)
      if ((payload.command as Command | undefined)?.kind === 'leave') {
        closedRooms.current.add(update.id)
        remember(null)
        setConnectedRoom(null)
        setRoom(null)
        clearInvite()
        onClose()
      } else {
        closedRooms.current.delete(update.id)
        accept(update)
        remember(update.id)
        setConnectedRoom(update.id)
        if (payload.op === 'join') clearInvite()
      }
    } catch (failure) {
      const issue = failure instanceof OnlineError ? failure : new OnlineError('通信エラーです。', false, true)
      setRetry(issue.retry && payload.op !== 'join' ? [payload, preparation] : null)
      setDegraded(issue.retry)
      setError(issue.message)
      if (issue.gone && room) {
        closedRooms.current.add(room.id)
        remember(null)
        setConnectedRoom(null)
        setRoom(null)
      }
    } finally {
      setBusy(false)
      writeInFlight.current = false
      if (payload.op === 'command') void reload()
    }
  }
  function prepare() {
    if (!room || !validDeck(chosen)) return
    const request = (command: Command) => ({ op: 'command', id: room.id, request: crypto.randomUUID(), command })
    void send(request({ kind: 'ready' }), deckMatches ? undefined : request({ kind: 'deck', cards: [...chosen] }))
  }
  function command(action: Command) {
    if (room) void send({ op: 'command', id: room.id, request: crypto.randomUUID(), command: action })
  }
  function chooseType(type: DeckType) {
    try {
      if (!generated[type]) setGenerated({ ...generated, [type]: generateDeck(type) })
      setSelected(type)
      setError('')
    } catch { setError('デッキを作成できませんでした。') }
  }
  function toggle(id: number) {
    setPlays(previous => previous.some(play => play.id === id)
      ? previous.filter(play => play.id !== id) : previous.length < (game?.max ?? 0) ? [...previous, { id }] : previous)
  }
  const blocked = busy || degraded || retry !== null
  const canEdit = !room || room.phase === 'lobby' && !room.left.some(Boolean) && !room.ready[room.side]
  const deckPicker = (
    <section className="online-picker">
      <h3>自分のデッキ</h3>
      <div className="match-tabs" role="group" aria-label="デッキの選び方">
        <button className="quiet" aria-pressed={!mine} onClick={() => setMine(false)}>おまかせ</button>
        <button className="quiet" aria-pressed={mine} onClick={() => setMine(true)}>マイデッキ</button>
      </div>
      {mine ? <div className="online-actions">
        {options.filter(deck => deck.id !== 'standard' && validDeck(deck.cards)).map(deck => (
          <button className="quiet match-option" aria-pressed={selected === deck.id} key={deck.id}
            onClick={() => setSelected(deck.id)}>{deck.name} · {deck.source}</button>
        ))}
        {!options.some(deck => deck.id !== 'standard' && validDeck(deck.cards)) && <p className="hint">使用できるマイデッキがありません。</p>}
      </div> : <div className="match-types">
        <button className="quiet match-option" aria-pressed={selected === 'standard'} onClick={() => setSelected('standard')}>標準デッキ</button>
        {DECK_TYPES.map(type => <button className="quiet match-option" aria-pressed={selected === type}
          key={type} onClick={() => chooseType(type)}>{PROFILES[type].label}</button>)}
      </div>}
      <div className="online-actions">
        {room?.ownDeck && selected !== 'room-current' && !deckMatches && <button className="quiet" onClick={() => setSelected('room-current')}>登録済みの構成に戻す</button>}
        <button className="quiet" onClick={() => setDeckPreview(true)}>選択したデッキを確認</button>
      </div>
    </section>
  )
  const freshInvestigation = game?.investigations.find(record => record.night === game.night
    && !confirmed.has(record.night + ':' + record.sourceId))
  const guesses = game?.players[opponent].remaining ?? []
  const hasGuesses = plays.every(play => game?.hand.find(card => card.id === play.id)?.role !== 'assassin' || !guesses.length || play.guess)
  const viewedSide = dialog === 'own' || dialog === 'own-discard' ? room?.side : opponent
  const viewed = viewedSide === undefined ? undefined : game?.players[viewedSide]
  if (!client) return <Sheet title="オンライン対戦" className="online-sheet" onClose={() => { clearInvite(); onClose() }}><p>現在オンライン対戦を利用できません。NPC対戦は引き続き遊べます。</p></Sheet>

  return <>
    {!game || !room ? (
      <Sheet title="オンライン対戦" className="online-sheet" onClose={() => { clearInvite(); onClose() }}>
        {!room && !connectedRoom && <>
          {mode === 'create' ? <>
            <button className="quiet" disabled={busy} onClick={() => { setMode('join'); setRetry(null); setError('') }}>ルームコードを入力</button>
            {deckPicker}
            <button className="primary" disabled={busy || !!retry} onClick={() => void send({ op: 'create', cards: chosen, request: crypto.randomUUID() })}>このデッキでルームを作成</button>
          </> : <form className="online-form" onSubmit={event => { event.preventDefault(); if (!busy && !retry && code.length === 10) void send({ op: 'join', code }) }}>
            <label htmlFor="invite-code">ルームコード</label>
            <input id="invite-code" autoCapitalize="characters" autoComplete="off" value={code}
              onChange={event => setCode(formatCode(event.target.value))} />
            <button className="primary" type="submit" disabled={busy || !!retry || code.length !== 10}>参加する</button>
            <button className="quiet" type="button" disabled={busy} onClick={() => { setMode('create'); setRetry(null); setError('') }}>作成画面へ</button>
          </form>}
        </>}
        {!room && connectedRoom && <p role="status">ルームに再接続中…</p>}
        {room && <>
          <p>ルームコード <strong>{room.code}</strong></p>
          <div className="online-form">
            <label htmlFor="invite-url">招待URL</label>
            <input id="invite-url" readOnly value={invite} />
            <div className="online-actions">
              <button className="quiet" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invite)
                  setFeedback('招待URLをコピーしました。')
                } catch { setFeedback('招待URLを選択してコピーしてください。') }
              }}>URLをコピー</button>
              {navigator.share && <button className="quiet" onClick={() => void navigator.share({ title: '人狼デュエル', url: invite }).catch(() => {})}>共有</button>}
            </div>
          </div>
          <p role="status">{room.left[opponent] ? '相手が退出しました。' : !room.joined ? '相手の参加待ち'
            : !room.connected[opponent] ? '相手は切断中です。' : room.ready[opponent] ? '相手は準備完了' : '相手の準備待ち'}</p>
          {canEdit && deckPicker}
          <div className="online-actions">
            {room.ready[room.side] ? <p role="status">準備完了・相手を待っています</p> :
              <button className="primary" disabled={blocked || !room.joined || room.left.some(Boolean) || !validDeck(chosen)}
                onClick={prepare}>{busy ? '送信中…' : '準備完了'}</button>}
            <button className="quiet" disabled={busy} onClick={() => command({ kind: 'leave' })}>ルーム退出</button>
          </div>
        </>}
        {feedback && <p className="notice" role="status">{feedback}</p>}
        {(error || syncError) && <p className="notice" role="alert">{error || syncError}</p>}
        {(retry || degraded && connectedRoom) && <button className="quiet" disabled={busy} onClick={() => retry ? void send(...retry) : reconnect()}>再試行</button>}
      </Sheet>
    ) : <section className="online-battle">
      <div className="section-title battle-title"><h1>第{game.night}夜 <small>/ {RULES.finalNight}</small></h1>
        <button className="quiet" disabled={busy} onClick={() => command({ kind: 'leave' })}>ルーム退出</button></div>
      <p role="status">{degraded ? '再接続中…' : !room.connected[opponent] && !room.left[opponent] ? '相手は切断中です。再接続をお待ちください。' : ''}</p>
      {(error || syncError) && <p className="notice" role="alert">{error || syncError}</p>}
      {(retry || degraded) && <button className="quiet" disabled={busy} onClick={() => retry ? void send(...retry) : reconnect()}>再試行</button>}
      <div className="fighters">
        {[room.side, opponent].map((side, index) => <section key={side} className={'panel fighter side' + index}>
          <div className="fighter-line"><strong>{index ? '相手' : 'あなた'}</strong><span><b>{game.players[side].hp}</b> / {RULES.hp} HP</span></div>
          <progress aria-label={(index ? '相手' : '自分') + 'のHP'} value={game.players[side].hp} max={RULES.hp} />
          <div className="stats">山札 {game.players[side].deckCount}　手札 {game.players[side].handCount}　捨て札 {game.players[side].discard.length}</div>
          <div className="hp-changes">{game.players[side].hpChange.lost > 0 && <span className="hp-loss">−{game.players[side].hpChange.lost}</span>}
            {game.players[side].hpChange.gained > 0 && <span className="hp-gain">+{game.players[side].hpChange.gained}</span>}</div>
        </section>)}
      </div>
      <div className="battle-tools">
        <button className="quiet" onClick={() => setDialog('own')}>自分のデッキ</button><button className="quiet" onClick={() => setDialog('enemy')}>相手のデッキ</button>
        <button className="quiet" onClick={() => setDialog('own-discard')}>自分の捨て札</button><button className="quiet" onClick={() => setDialog('enemy-discard')}>相手の捨て札</button>
        <button className="quiet" onClick={() => setDialog('investigations')}>調査記録</button>
      </div>
      <div className="battle-layout"><section className="panel play-area">
        {game.revealed.some(cards => cards.length) && <div className="reveal" aria-label="同時公開">
          <div className="reveal-columns">{[room.side, opponent].map((side, index) => <div key={side}>
            <h3>{index ? '相手' : 'あなた'}</h3><div className="duel-cards">{game.revealed[side].map((entry, i) => (
              <CardTile compact key={game.night + ':' + i} role={entry.role} onInspect={() => setPeek(entry.role)}
                disabled={entry.disabled} detail={entry.disabled ? '効果無効' : entry.guess ? '予想：' + card(entry.guess).name : undefined} />
            ))}</div>
          </div>)}</div>
        </div>}
        {game.phase === 'select' && (game.locked[room.side] ? <p role="status">確定済み · 相手のカード確定待ち</p> : <>
          <div className="hand-heading"><h2>手札を選択</h2><span>{plays.length} / {game.max}枚</span></div>
          <p className="hint">{game.locked[opponent] ? '相手は確定済み' : '相手は選択中'}</p>
          <div className="duel-cards hand-cards" aria-label="手札">{game.hand.map(entry => (
            <CardTile compact key={entry.id} role={entry.role} selected={plays.some(play => play.id === entry.id)}
              onInspect={() => setPeek(entry.role)} onClick={() => toggle(entry.id)} />
          ))}</div>
          {plays.filter(play => game.hand.find(card => card.id === play.id)?.role === 'assassin' && guesses.length).map(play => (
            <label className="prediction" key={play.id}>暗殺者の予想
              <select value={play.guess ?? ''} onChange={event => setPlays(previous => previous.map(item =>
                item.id === play.id ? { ...item, guess: event.target.value as Role || undefined } : item))}>
                <option value="">役職を選ぶ</option>
                {guesses.map(({ role, count }) => <option key={role} value={role}>{card(role).name} · {count}枚</option>)}
              </select>
            </label>
          ))}
          <div className="hand-actions"><button className="primary action" disabled={blocked || !hasGuesses || game.hand.length > 0 && !plays.length}
            onClick={() => command({ kind: 'lock', night: game.night, plays })}>{game.hand.length ? '選択を確定' : 'パスを確定'}</button></div>
        </>)}
        {game.phase === 'choice' && (game.prompt ? <div className="choice"><h2>{game.prompt.title}</h2>
          <div className="duel-cards">{game.prompt.options.map(entry => <CardTile compact key={entry.id} role={entry.role}
            onInspect={() => setPeek(entry.role)} onClick={blocked ? undefined : () => command({
              kind: 'answer', id: entry.id, night: game.night, step: game.prompt!.step,
            })} />)}</div></div> : <p role="status">相手がカードを選択しています。</p>)}
        {game.phase === 'end' && <button className="primary action" disabled={blocked || game.next[room.side]}
          onClick={() => command({ kind: 'next', night: game.night })}>{game.next[room.side] ? '相手の確認待ち' : '次の夜へ'}</button>}
        {game.phase === 'finished' && <div className="result" role="status">
          <h2>{game.winner === 'draw' ? '引き分け' : game.winner === room.side ? 'あなたの勝利' : '相手の勝利'}</h2><p>{game.reason}</p>
        </div>}
      </section><aside className="panel online-log"><details><summary>対戦ログ</summary>
        <ol className="log">{[...game.log].reverse().map((entry, index) => <li key={index}><span>第{entry.night}夜</span>{entry.text}</li>)}</ol>
      </details></aside></div>
    </section>}
    {deckPreview && <Sheet title="デッキの内容" className="online-sheet" onClose={() => setDeckPreview(false)}><DeckCardList cards={chosen} onInspect={setPeek} /></Sheet>}
    {game && dialog === 'investigations' && <InvestigationPanel records={[...game.investigations].reverse()} onClose={() => setDialog(undefined)} onInspect={setPeek} />}
    {game && viewed && (dialog === 'own' || dialog === 'enemy') && <DeckViewer title={dialog === 'own' ? '自分のデッキ' : '相手のデッキ'}
      night={game.night} hp={viewed.hp} initial={viewed.initial} remaining={viewed.remaining} onInspect={setPeek} onClose={() => setDialog(undefined)} />}
    {viewed && (dialog === 'own-discard' || dialog === 'enemy-discard') && <Sheet title={dialog === 'own-discard' ? '自分の捨て札' : '相手の捨て札'} onClose={() => setDialog(undefined)}>
      {viewed.discard.length ? <DeckComposition entries={ROLES.flatMap(role => {
        const count = viewed.discard.filter(card => card === role).length
        return count ? [{ role, count }] : []
      })} onInspect={setPeek} /> : <p>捨て札はありません。</p>}</Sheet>}
    {freshInvestigation && <InvestigationPanel records={[freshInvestigation]} onInspect={setPeek}
      onConfirm={() => setConfirmed(previous => new Set([...previous, freshInvestigation.night + ':' + freshInvestigation.sourceId]))} />}
    {peek && <CardDetail role={peek} onClose={() => setPeek(undefined)} />}
  </>
}
