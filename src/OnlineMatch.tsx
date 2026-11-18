import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { playEffects, setMusic } from './audio.ts'
import { battleTrack } from './soundEvents.ts'
import { useOnlineDuelSound } from './useOnlineDuelSound.ts'
import { onlineRequestLifetime } from './onlineRequestLifetime.ts'
import { ROLES, RULES, STARTER, card, validDeck, type Role } from './cards.ts'
import { AssassinPrediction } from './AssassinPrediction.tsx'
import { CardDetail } from './CardDetail.tsx'
import { CardTile } from './CardTile.tsx'
import { DeckCardList } from './DeckCardList.tsx'
import { DeckViewer } from './DeckViewer.tsx'
import type { MatchDeck } from './decks.ts'
import type { Play, Side } from './duel.ts'
import { DECK_TYPES, PROFILES, generateDeck, type DeckType } from './generateDeck.ts'
import { InvestigationPanel } from './InvestigationPanel.tsx'
import { cardsForMatch } from './matchDeck.ts'
import { OnlineError, onlineClient } from './onlineClient.ts'
import { spyDrawRulesVersion, type Command, type OnlineView } from './onlineProtocol.ts'
import { copyLobbyField, formatRoomCodeInput, isRoomCode, roomInvitationUrl } from './roomClipboard.ts'
import { DeckComposition, Sheet } from './Sheet.tsx'
import { TyrantLimitNotice } from './TyrantLimitNotice.tsx'

const activeRoom = 'jinro-online-room'
const logPreference = (id: string) => 'jinro-online-log:' + id
function readLogPreference(id: string | null) {
  try { return !id || sessionStorage.getItem(logPreference(id)) !== 'closed' } catch { return true }
}
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
type RequestPayload = Record<string, unknown>
type DeckSnapshot = { type: DeckType; cards: Role[] }
type PendingRequest = [payload: RequestPayload, preparation?: RequestPayload, snapshot?: DeckSnapshot]
type RoomDecks = { id: string; decks: Partial<Record<DeckType, Role[]>> }
const roomDeckKey = 'jinro-online-generated-decks'
function restoreRoomDecks(id: string): RoomDecks {
  const result: RoomDecks = { id, decks: {} }
  try {
    const saved = JSON.parse(localStorage.getItem(roomDeckKey) ?? 'null')
    if (saved?.id === id) for (const type of DECK_TYPES) {
      const cards = saved.decks?.[type]
      if (Array.isArray(cards) && validDeck(cards)) result.decks[type] = cards
    }
  } catch { /* unavailable */ }
  return result
}
function rememberRoomDeck(snapshot: RoomDecks) {
  try { localStorage.setItem(roomDeckKey, JSON.stringify(snapshot)) } catch { /* unavailable */ }
}

type Prompt = NonNullable<NonNullable<OnlineView['game']>['prompt']>

function RoomInvitation({ code }: { code: string }) {
  const codeField = useRef<HTMLInputElement>(null)
  const urlField = useRef<HTMLInputElement>(null)
  const copying = useRef(false)
  const [feedback, setFeedback] = useState<{ success: boolean; text: string }>()
  const invite = roomInvitationUrl(code)

  async function copy(kind: 'code' | 'url', field: HTMLInputElement | null) {
    if (!field || copying.current) return
    copying.current = true
    setFeedback(undefined)
    const label = kind === 'code' ? 'ルームコード' : '招待URL'
    const select = () => {
      field.focus({ preventScroll: true })
      field.select()
    }
    try {
      const success = await copyLobbyField(kind, field.value, navigator.clipboard, () => {
        select()
        return document.execCommand('copy')
      })
      if (!success) select()
      setFeedback({ success, text: success ? label + 'をコピーしました。'
        : label + 'をコピーできませんでした。選択した文字列を手動でコピーしてください。' })
    } finally {
      copying.current = false
    }
  }

  return <div className="online-form">
    <label htmlFor="room-code">ルームコード</label>
    <input id="room-code" ref={codeField} readOnly value={code} />
    <label htmlFor="invite-url">招待URL</label>
    <input id="invite-url" ref={urlField} readOnly value={invite} />
    <div className="online-actions">
      <button className="quiet" disabled={!isRoomCode(code)} onClick={() => void copy('code', codeField.current)}>コードをコピー</button>
      <button className="quiet" disabled={!invite} onClick={() => void copy('url', urlField.current)}>招待URLをコピー</button>
      {navigator.share && <button className="quiet" disabled={!invite}
        onClick={() => void navigator.share({ title: '人狼デュエル', url: invite }).catch(() => {})}>共有</button>}
    </div>
    {feedback && <p className="notice" role={feedback.success ? 'status' : 'alert'}>{feedback.text}</p>}
  </div>
}

function OnlineChoice({ prompt, blocked, onConfirm }: { prompt: Prompt; blocked: boolean; onConfirm: (id: number) => void }) {
  const [selected, setSelected] = useState<number>()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.scrollIntoView({ block: 'nearest' }) }, [])
  const discard = prompt.title.includes('捨てる')
  return <section className="choice" aria-label="カード効果の選択">
    <h2 ref={heading}>{prompt.title.startsWith('共有者：') ? '共有者：捨てるカードを1枚選んでください' : prompt.title}</h2>
    <div className="duel-cards hand-cards" aria-label="選択できるカード">
      {prompt.options.map(entry => <CardTile compact key={entry.id} role={entry.role} selected={selected === entry.id}
        onClick={() => { if (!blocked) setSelected(entry.id) }} />)}
    </div>
    <div className="hand-actions">
      <button className="primary action" disabled={blocked || !prompt.options.some(entry => entry.id === selected)}
        onClick={() => { if (selected !== undefined) onConfirm(selected) }}>
        {discard ? 'このカードを捨てる' : 'このカードを戻す'}
      </button>
    </div>
  </section>
}

export default function OnlineMatch({ options, onClose }: { options: MatchDeck[]; onClose: () => void }) {
  const [client] = useState(() => { try { return onlineClient() } catch { return null } })
  const [room, setRoom] = useState<OnlineView | null>(null)
  const [connectedRoom, setConnectedRoom] = useState(() => new URLSearchParams(location.search).has('room') ? null : getRoom())
  const [code, setCode] = useState(() => formatRoomCodeInput(new URLSearchParams(location.search).get('room') ?? ''))
  const [mode, setMode] = useState<'create' | 'join'>(() => code ? 'join' : 'create')
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [logOpen, setLogOpen] = useState(() => readLogPreference(getRoom()))
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<PendingRequest | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [peek, setPeek] = useState<Role>()
  const [deckPreview, setDeckPreview] = useState(false)
  const [mine, setMine] = useState(false)
  const [selected, setSelected] = useState('standard')
  const [roomDecks, setRoomDecks] = useState<RoomDecks>()
  const [plays, setPlays] = useState<Play[]>([])
  const [predictionId, setPredictionId] = useState<number>()
  const [dialog, setDialog] = useState<'investigations' | 'own' | 'enemy' | 'own-discard' | 'enemy-discard'>()
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set())
  const writeInFlight = useRef(false)
  const [requests] = useState(onlineRequestLifetime)
  const activeRoom = useRef(connectedRoom)
  useLayoutEffect(() => {
    return requests.invalidate
  }, [requests])
  const close = () => {
    requests.invalidate()
    clearInvite()
    onClose()
  }
  const refreshing = useRef(false)
  const refreshQueued = useRef(false)
  const closedRooms = useRef(new Set<string>())
  const playArea = useRef<HTMLElement>(null)
  const game = room?.game
  const legacySpy = !!game && room?.rulesVersion !== undefined && room.rulesVersion < spyDrawRulesVersion
  useEffect(() => { setMusic(game ? battleTrack(game.night, game.phase === 'finished') : 1) }, [game?.night, game?.phase])
  useOnlineDuelSound(room?.id, game && room ? {
    night: game.night,
    revealed: game.revealed.some(cards => cards.length > 0),
    hp: game.players.map(player => player.hpChange),
    log: game.log,
    result: game.phase === 'finished' ? game.winner === 'draw' ? 'draw' : game.winner === room.side ? 'victory' : 'defeat' : undefined,
  } : undefined, playArea, degraded)
  const prompt = game?.phase === 'choice' ? game.prompt : null
  const chosenType = DECK_TYPES.find(type => selected === type)
  const generated = room && roomDecks?.id === room.id ? roomDecks.decks : undefined
  const chosen = chosenType ? generated?.[chosenType] : (selected === 'room-current' ? room?.ownDeck : undefined)
    ?? options.find(deck => deck.id === selected)?.cards ?? STARTER
  const deckMatches = !!chosen && room?.ownDeck?.join(',') === chosen.join(',')
  const opponent = (room ? 1 - room.side : 1) as Side

  const accept = useCallback((update: OnlineView) => {
    if (closedRooms.current.has(update.id)) return
    setRoom(previous => previous?.id === update.id && previous.revision > update.revision ? previous : update)
    setDegraded(false)
  }, [])

  const reload = useCallback(async () => {
    if (!client || !connectedRoom || activeRoom.current !== connectedRoom || closedRooms.current.has(connectedRoom)) return
    const isOpen = requests.capture()
    const isCurrent = () => isOpen() && activeRoom.current === connectedRoom
    if (refreshing.current) {
      refreshQueued.current = true
      return
    }
    refreshing.current = true
    try {
      const update = await client.request({ op: 'status', id: connectedRoom })
      if (isCurrent() && !closedRooms.current.has(connectedRoom)) {
        accept(update)
        setSyncError('')
      }
    } catch (failure) {
      if (!isCurrent() || closedRooms.current.has(connectedRoom)) return
      if (failure instanceof OnlineError && failure.gone) {
        closedRooms.current.add(connectedRoom)
        remember(null)
        activeRoom.current = null
        setConnectedRoom(null)
        setRoom(null)
        setRetry(null)
        setError(failure.message)
      } else {
        setDegraded(true)
      }
      setSyncError(failure instanceof Error ? failure.message : '通信エラーです。')
    } finally {
      if (isOpen()) refreshing.current = false
      if (isCurrent() && refreshQueued.current) {
        refreshQueued.current = false
        void reload()
      }
    }
  }, [client, connectedRoom, accept, requests])
  const reconnect = reload

  useEffect(() => { setLogOpen(readLogPreference(connectedRoom)) }, [connectedRoom])

  useEffect(() => () => client?.dispose(), [client])
  useEffect(() => {
    if (!client || !connectedRoom) return
    const sync = () => { if (document.visibilityState === 'visible') void reload() }
    const wake = () => { if (document.visibilityState === 'visible') reconnect() }
    const disconnect = () => setDegraded(true)
    void reload()
    const unsubscribe = client.subscribe(connectedRoom, sync)
    const timer = window.setInterval(sync, 12_000)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('offline', disconnect)
    window.addEventListener('pageshow', wake)
    return () => {
      unsubscribe()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('offline', disconnect)
      window.removeEventListener('pageshow', wake)
    }
  }, [client, connectedRoom, reload, reconnect])
  useEffect(() => {
    setPlays([])
    setPredictionId(undefined)
  }, [game?.night, room?.id])
  const canSelect = !!room && game?.phase === 'select' && !game.locked[room.side]
  useEffect(() => {
    if (!canSelect) setPredictionId(undefined)
  }, [canSelect])
  useEffect(() => {
    if (room) {
      const restored = restoreRoomDecks(room.id)
      setRoomDecks(restored)
      const registeredType = DECK_TYPES.find(type => restored.decks[type]?.join(',') === room.ownDeck?.join(',') && restored.decks[type])
      if (registeredType) {
        setSelected(registeredType)
        return
      }
    }
    if (room?.ownDeck && room.ownDeck.join(',') !== chosen?.join(',')) {
      const saved = options.find(option => option.cards.join(',') === room.ownDeck?.join(','))
      setSelected(saved?.id ?? 'room-current')
    }
    // Restore the room's applied deck once when entering from a saved browser session.
  }, [room?.id])

  async function send(payload: RequestPayload, preparation?: RequestPayload, snapshot?: DeckSnapshot) {
    if (!client || writeInFlight.current) return
    const isCurrent = requests.capture()
    writeInFlight.current = true
    setBusy(true)
    setError('')
    setSyncError('')
    try {
      if (preparation) {
        const registered = await client.request(preparation)
        if (!isCurrent() || closedRooms.current.has(registered.id)) return
        accept(registered)
      }
      const update = await client.request(payload)
      if (!isCurrent() || closedRooms.current.has(update.id)) return
      if ((payload.command as Command | undefined)?.kind === 'lock') playEffects(['confirm'])
      setRetry(null)
      if ((payload.command as Command | undefined)?.kind === 'leave') {
        closedRooms.current.add(update.id)
        remember(null)
        activeRoom.current = null
        setConnectedRoom(null)
        setRoom(null)
        close()
      } else {
        if (snapshot) {
          const registered = { id: update.id, decks: { [snapshot.type]: snapshot.cards } }
          setRoomDecks(registered)
          rememberRoomDeck(registered)
        }
        accept(update)
        remember(update.id)
        activeRoom.current = update.id
        setConnectedRoom(update.id)
        if (payload.op === 'join') clearInvite()
      }
    } catch (failure) {
      if (!isCurrent() || (room && activeRoom.current !== room.id)) return
      const issue = failure instanceof OnlineError ? failure : new OnlineError('通信エラーです。', false, true)
      setRetry(issue.retry && payload.op !== 'join' ? [payload, preparation, snapshot] : null)
      setDegraded(issue.retry)
      setError(issue.message)
      if (issue.gone && room) {
        closedRooms.current.add(room.id)
        remember(null)
        activeRoom.current = null
        setConnectedRoom(null)
        setRoom(null)
      }
    } finally {
      if (isCurrent()) {
        setBusy(false)
        writeInFlight.current = false
        if (payload.op === 'command') void reload()
      }
    }
  }
  function prepare() {
    if (!room || !chosen || !validDeck(chosen)) return
    const request = (command: Command) => ({ op: 'command', id: room.id, request: crypto.randomUUID(), command })
    void send(request({ kind: 'ready' }), deckMatches ? undefined : request({ kind: 'deck', cards: [...chosen] }))
  }
  function createRoom() {
    if (writeInFlight.current) return
    try {
      const cards = cardsForMatch(chosen ?? [], chosenType)
      void send({ op: 'create', cards, request: crypto.randomUUID() }, undefined, chosenType ? { type: chosenType, cards } : undefined)
    } catch { setError('デッキを作成できませんでした。') }
  }
  function command(action: Command) {
    if (room) void send({ op: 'command', id: room.id, request: crypto.randomUUID(), command: action })
  }
  function chooseType(type: DeckType) {
    if (writeInFlight.current || retry) return
    try {
      setSelected(type)
      setError('')
      if (!room) return
      const remembered = restoreRoomDecks(room.id)
      const decks = { ...generated, ...remembered.decks }
      const cards = decks[type] ?? cardsForMatch([], type)
      const snapshot = { id: room.id, decks: { ...decks, [type]: cards } }
      setRoomDecks(snapshot)
      rememberRoomDeck(snapshot)
      if (room.ownDeck?.join(',') !== cards.join(',')) command({ kind: 'deck', cards })
    } catch { setError('デッキを作成できませんでした。') }
  }
  function toggle(id: number) {
    if (plays.some(play => play.id === id)) setPlays(plays.filter(play => play.id !== id))
    else if (plays.length < (game?.max ?? 0)) {
      setPlays([...plays, { id }])
      playEffects(['select'])
    }
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
        {chosen ? <button className="quiet" onClick={() => setDeckPreview(true)}>選択したデッキを確認</button>
          : <span className="hint">{room ? 'おまかせのタイプを選んで20枚を登録してください。' : 'ルーム作成時に20枚を抽選します。'}</span>}
      </div>
    </section>
  )
  const freshInvestigation = game?.investigations.find(record => record.night === game.night
    && !confirmed.has(record.night + ':' + record.sourceId))
  const guesses = game?.players[opponent].remaining ?? []
  const assassins = plays.filter(play => game?.hand.some(entry => entry.id === play.id && entry.role === 'assassin'))
  const hasGuesses = !guesses.length || assassins.every(play => guesses.some(entry => entry.role === play.guess))
  const prediction = canSelect ? assassins.find(play => play.id === predictionId) : undefined
  const viewedSide = dialog === 'own' || dialog === 'own-discard' ? room?.side : opponent
  const viewed = viewedSide === undefined ? undefined : game?.players[viewedSide]
  if (!client) return <Sheet title="オンライン対戦" className="online-sheet" onClose={close}><p>現在オンライン対戦を利用できません。NPC対戦は引き続き遊べます。</p></Sheet>

  return <>
    {!game || !room ? (
      <Sheet title="オンライン対戦" className="online-sheet" onClose={close}>
        {!room && !connectedRoom && <>
          {mode === 'create' ? <>
            <button className="quiet" disabled={busy} onClick={() => { setMode('join'); setRetry(null); setError('') }}>ルームコードを入力</button>
            {deckPicker}
            <button className="primary" disabled={busy || !!retry} onClick={createRoom}>このデッキでルームを作成</button>
          </> : <form className="online-form" onSubmit={event => { event.preventDefault(); if (!busy && !retry && isRoomCode(code)) void send({ op: 'join', code }) }}>
            <label htmlFor="invite-code">ルームコード</label>
            <input id="invite-code" autoCapitalize="characters" autoComplete="off" value={code}
              spellCheck={false} onChange={event => setCode(formatRoomCodeInput(event.target.value))} />
            {code.length >= 10 && !isRoomCode(code) && <p className="hint">ルームコードは英数字10文字です。</p>}
            <button className="primary" type="submit" disabled={busy || !!retry || !isRoomCode(code)}>参加する</button>
            <button className="quiet" type="button" disabled={busy} onClick={() => { setMode('create'); setRetry(null); setError('') }}>作成画面へ</button>
          </form>}
        </>}
        {!room && connectedRoom && <p role="status">ルームに再接続中…</p>}
        {room && <>
          <RoomInvitation key={room.id + ':' + room.code} code={room.code} />
          <p role="status">{room.left[opponent] ? '相手が退出しました。' : !room.joined ? '相手の参加待ち'
            : !room.connected[opponent] ? '相手は切断中です。' : room.ready[opponent] ? '相手は準備完了' : '相手の準備待ち'}</p>
          {canEdit && deckPicker}
          <div className="online-actions">
            {room.ready[room.side] ? <p role="status">準備完了・相手を待っています</p> :
              <button className="primary" disabled={blocked || !room.joined || room.left.some(Boolean) || !chosen || !validDeck(chosen)}
                onClick={prepare}>{busy ? '送信中…' : '準備完了'}</button>}
            <button className="quiet" disabled={busy} onClick={() => command({ kind: 'leave' })}>ルーム退出</button>
          </div>
        </>}
        {(error || syncError) && <p className="notice" role="alert">{error || syncError}</p>}
        {(retry || degraded && connectedRoom) && <button className="quiet" disabled={busy} onClick={() => retry ? void send(...retry) : reconnect()}>再試行</button>}
      </Sheet>
    ) : <section className="online-battle">
      <div className="section-title battle-title"><h1>第{game.night}夜 <small>/ {RULES.finalNight}</small></h1>
        <button className="quiet" disabled={busy} onClick={() => command({ kind: 'leave' })}>ルーム退出</button></div>
      <p role="status">{degraded ? '再接続中…' : !room.connected[opponent] && !room.left[opponent] ? '相手は切断中です。再接続をお待ちください。' : ''}</p>
      {(error || syncError) && <p className="notice" role="alert">{error || syncError}</p>}
      {(retry || degraded) && <button className="quiet" disabled={busy} onClick={() => retry ? void send(...retry) : reconnect()}>再試行</button>}
      {legacySpy && <p className="hint">
        この対戦は開始時のルールを使用します。密偵は条件成立時に1枚引きます。
        {room.rulesVersion && room.rulesVersion < 3 && '商人の消費は2HPです。'}
        {room.rulesVersion === 1 && '呪術師は相手の次の夜のHP回復を無効化します。'}
      </p>}
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
      <div className="battle-layout"><section ref={playArea} className="panel play-area">
        {game.phase === 'choice' && (prompt ? <OnlineChoice key={room.id + ':' + game.night + ':' + prompt.step}
          prompt={prompt} blocked={blocked} onConfirm={id => command({ kind: 'answer', id, night: game.night, step: prompt.step })} />
          : <p role="status">相手のカード効果の処理待ち</p>)}
        {game.revealed.some(cards => cards.length) && <div className="reveal" aria-label="同時公開">
          <div className="reveal-columns">{[room.side, opponent].map((side, index) => <div key={side}>
            <h3>{index ? '相手' : 'あなた'}</h3><div className="duel-cards">{game.revealed[side].map((entry, i) => (
              <CardTile compact key={game.night + ':' + i} role={entry.role} onInspect={() => setPeek(entry.role)}
                disabled={entry.disabled} recoveryBlocked={entry.recoveryBlocked} detail={entry.guess ? '予想：' + card(entry.guess).name : undefined} />
            ))}</div>
          </div>)}</div>
        </div>}
        {game.phase === 'select' && (game.locked[room.side] ? <p role="status">確定済み · 相手のカード確定待ち</p> : <>
          <div className="hand-heading"><h2>手札を選択</h2><span>{plays.length} / {game.max}枚</span></div>
          <TyrantLimitNotice limited={game.max === 1} />
          <p className="hint">{game.locked[opponent] ? '相手は確定済み' : '相手は選択中'}</p>
          <div className="duel-cards hand-cards" aria-label="手札">{game.hand.map(entry => (
            <CardTile compact key={entry.id} role={entry.role} selected={plays.some(play => play.id === entry.id)}
              onInspect={() => setPeek(entry.role)} onClick={() => toggle(entry.id)} />
          ))}</div>
          {assassins.map((play, index) => (
            <div className="prediction" key={play.id}>
              <span>暗殺者 {index + 1} の予想</span>
              <button className="quiet" aria-haspopup="dialog" disabled={busy || !!retry || !guesses.length}
                onClick={() => setPredictionId(play.id)}>
                {play.guess ? card(play.guess).name + '（変更）' : guesses.length ? '役職を選ぶ' : '予想できる役職なし'}
              </button>
            </div>
          ))}
          <div className="hand-actions"><button className="primary action" disabled={blocked || !hasGuesses || game.hand.length > 0 && !plays.length}
            onClick={() => command({ kind: 'lock', night: game.night, plays })}>{game.hand.length ? '選択を確定' : 'パスを確定'}</button></div>
        </>)}
        {game.phase === 'end' && <button className="primary action" disabled={blocked || game.next[room.side]}
          onClick={() => command({ kind: 'next', night: game.night })}>{game.next[room.side] ? '相手の確認待ち' : '次の夜へ'}</button>}
        {game.phase === 'finished' && <div className="result" role="status">
          <h2>{game.winner === 'draw' ? '引き分け' : game.winner === room.side ? 'あなたの勝利' : '相手の勝利'}</h2><p>{game.reason}</p>
        </div>}
      </section><aside className="panel online-log"><details open={logOpen} onToggle={event => {
        const open = event.currentTarget.open
        setLogOpen(open)
        try { sessionStorage.setItem(logPreference(room.id), open ? 'open' : 'closed') } catch { /* unavailable */ }
      }}><summary>対戦ログ</summary>
        <ol className="log">{[...game.log].reverse().map((entry, index) => <li key={index}><span>第{entry.night}夜</span>{entry.text}</li>)}</ol>
      </details></aside></div>
    </section>}
    {deckPreview && chosen && <Sheet title="デッキの内容" className="online-sheet" onClose={() => setDeckPreview(false)}><DeckCardList cards={chosen} onInspect={setPeek} /></Sheet>}
    {game && dialog === 'investigations' && <InvestigationPanel records={[...game.investigations].reverse()} onClose={() => setDialog(undefined)} onInspect={setPeek} />}
    {game && viewed && (dialog === 'own' || dialog === 'enemy') && <DeckViewer title={dialog === 'own' ? '自分のデッキ' : '相手のデッキ'}
      night={game.night} hp={viewed.hp} initial={viewed.initial} remaining={viewed.remaining} onInspect={setPeek} onClose={() => setDialog(undefined)} />}
    {viewed && (dialog === 'own-discard' || dialog === 'enemy-discard') && <Sheet title={dialog === 'own-discard' ? '自分の捨て札' : '相手の捨て札'} onClose={() => setDialog(undefined)}>
      {viewed.discard.length ? <DeckComposition entries={ROLES.flatMap(role => {
        const count = viewed.discard.filter(card => card === role).length
        return count ? [{ role, count }] : []
      })} onInspect={setPeek} /> : <p>捨て札はありません。</p>}</Sheet>}
    {game?.phase !== 'choice' && freshInvestigation && <InvestigationPanel records={[freshInvestigation]} onInspect={setPeek}
      onConfirm={() => setConfirmed(previous => new Set([...previous, freshInvestigation.night + ':' + freshInvestigation.sourceId]))} />}
    {prediction && <AssassinPrediction key={prediction.id} entries={guesses} initial={prediction.guess}
      onConfirm={role => {
        setPlays(previous => previous.map(play => play.id === prediction.id ? { ...play, guess: role } : play))
        setPredictionId(undefined)
      }}
      onClose={() => setPredictionId(undefined)} />}
    {peek && <CardDetail role={peek}
      effect={legacySpy && peek === 'spy' ? '相手が攻撃カードを出していれば、カードを1枚引く。' : undefined}
      onClose={() => setPeek(undefined)} />}
  </>
}
