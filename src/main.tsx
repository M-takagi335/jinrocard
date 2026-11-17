import { useEffect, useReducer, useRef, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { card, CATEGORY, ROLES, RULES, STARTER, validDeck, type Role } from './cards.ts'
import { Duel, type Instance, type Play, type Side } from './duel.ts'
import { deckCardsError, deckNameLimit, exportDeck, importDeck, inspectSavedDecks, loadSavedDecks, matchDecks, storeSavedDecks, type MatchDeck, type NamedDeck, type SavedDeck } from './decks.ts'
import { CardTile } from './CardTile.tsx'
import { CardDetail } from './CardDetail.tsx'
import { DeckViewer } from './DeckViewer.tsx'
import { InvestigationPanel } from './InvestigationPanel.tsx'
import { DeckCardList } from './DeckCardList.tsx'
import { DeckGenerator } from './DeckGenerator.tsx'
import { MatchSetup } from './MatchSetup.tsx'
import { NPC_DIFFICULTIES, type NpcDifficulty } from './strongNpc.ts'
import type { DeckType } from './generateDeck.ts'
import { cardsForMatch, generatedMatchType } from './matchDeck.ts'
import { DeckComposition, Sheet } from './Sheet.tsx'
import { AssassinPrediction } from './AssassinPrediction.tsx'
import { Tutorial } from './Tutorial.tsx'
import { HpChanges } from './HpChanges.tsx'
import { initAudio, playEffects, setMusic } from './audio.ts'
import { battleTrack } from './soundEvents.ts'
import { SoundSettings } from './SoundSettings.tsx'
import { OpenSoundSettings, SoundSettingsButton } from './SoundSettingsButton.tsx'
import { localSoundFrame, useDuelSound } from './useDuelSound.ts'
import './style.css'
import './card-art.css'

function loadDeck():Role[] {
  try { const data:unknown=JSON.parse(localStorage.getItem('jinro-deck')??'null'); if(Array.isArray(data) && data.length<=RULES.deckSize && data.every(r=>ROLES.includes(r)) && ROLES.every(r=>data.filter(x=>x===r).length<=card(r).limit))return data } catch { /* storage unavailable */ }
  return [...STARTER]
}
function newDeckId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
    byte.toString(16).padStart(2, '0')).join('')
}

function readLibrary(): { decks: SavedDeck[]; issues: string[] } {
  try {
    return inspectSavedDecks(localStorage)
  } catch {
    return { decks: [], issues: ['保存データを読み込めませんでした。標準デッキで対戦できます。'] }
  }
}

type Overlay = { type: 'start' | 'generate' | 'investigations' | 'library' | 'other' | 'save' } | { type: 'deck' | 'discard'; side: Side } | { type: 'guess'; id: number } | { type: 'delete'; deck: SavedDeck }

const rolesByName = new Map(ROLES.map(role => [card(role).name, role]))
const roleMention = new RegExp('(' + [...rolesByName.keys()].sort((a, b) => b.length - a.length).join('|') + ')', 'g')

function CardLog({ text, onInspect }: { text: string; onInspect: (role: Role) => void }) {
  return text.split(roleMention).map((part, index) => {
    const role = rolesByName.get(part)
    return role ? <button type="button" className="log-card-link" key={index}
      onClick={() => onInspect(role)} aria-haspopup="dialog">{part}</button> : part
  })
}

function sameComposition(first: readonly Role[], second: readonly Role[]) {
  return [...first].sort().join() === [...second].sort().join()
}

function App() {
  const [online, setOnline] = useState(() => {
    if (new URLSearchParams(location.search).has('room')) return true
    try { return Boolean(localStorage.getItem('jinro-online-room')) } catch { return false }
  })
  const [Online, setOnlineComponent] = useState<ComponentType<{ options: MatchDeck[]; onClose: () => void }>>()
  const [onlineLoadError, setOnlineLoadError] = useState(false)
  useEffect(() => {
    if (!online || Online) return
    let mounted = true
    setOnlineLoadError(false)
    void import('./OnlineMatch.tsx').then(module => { if (mounted) setOnlineComponent(() => module.default) },
      () => { if (mounted) setOnlineLoadError(true) })
    return () => { mounted = false }
  }, [online, Online])
  const [deck,setDeck]=useState(loadDeck)
  const [library, setLibrary] = useState(readLibrary)
  const saved = library.decks
  const [name, setName] = useState('')
  const [saveName, setSaveName] = useState('')
  const [saveMode, setSaveMode] = useState<'new' | 'copy' | 'overwrite'>('new')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftBaseline, setDraftBaseline] = useState<readonly Role[]>(STARTER)
  const savedEntry = saved.find(entry => entry.id === editingId)
  const unchanged = !!savedEntry && sameComposition(deck, savedEntry.cards)
  const saveStatus = !savedEntry ? '未保存' : unchanged ? '保存済み' : '変更あり・未保存'
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<(() => void) | null>(null)
  const [notice, setNotice] = useState('')
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [npcDeck, setNpcDeck] = useState<{ type: DeckType | 'default'; cards: Role[] }>({
    type: 'default', cards: [...STARTER],
  })
  const [npcDifficulty, setNpcDifficulty] = useState<NpcDifficulty>('standard')
  const [battleName, setBattleName] = useState('')
  const lastMatch = useRef<{ selected: MatchDeck; npc: typeof npcDeck } | null>(null)
  const [myMatchId, setMyMatchId] = useState<string>()
  const [quickMatchId, setQuickMatchId] = useState('standard')
  const [page, setPage] = useState<'home' | 'builder' | 'tutorial'>('home')
  const [quickDecks, setQuickDecks] = useState<Partial<Record<DeckType, MatchDeck>>>({})
  const [matchError, setMatchError] = useState('')
  const [duel,setDuel]=useState<Duel|null>(null)
  const insightCue = useRef<HTMLParagraphElement>(null)
  const [readCount, setReadCount] = useState(0)
  const [showInvestigation, setShowInvestigation] = useState(false)
  const [plays,setPlays]=useState<Play[]>([])
  const [tab,setTab]=useState<'log'|'self'|'enemy'>('log')
  const [logOpen, setLogOpen] = useState(true)
  const [preview, setPreview] = useState<{ role: Role; action?: { label: string; run: () => void } } | null>(null)
  const [rules,setRules]=useState(false)
  const [soundSettings, setSoundSettings] = useState(false)
  const [,refresh]=useReducer((n:number)=>n+1,0)
  useEffect(()=>{try{localStorage.setItem('jinro-deck',JSON.stringify(deck))}catch{/* unavailable */}},[deck])
  const phase=duel?.phase, night=duel?.night
  useEffect(() => {
    if (!online) setMusic(page === 'tutorial' ? 2 : duel ? battleTrack(duel.night, duel.phase === 'finished') : 1)
  }, [online, page, duel, night, phase])
  useDuelSound(duel ?? undefined, duel ? localSoundFrame(duel, true) : undefined, true)
  useEffect(()=>{
    if(!duel||phase!=='reveal')return
    const timer=window.setTimeout(()=>{duel.resolve();refresh()},550)
    return ()=>window.clearTimeout(timer)
  },[duel,phase,night])
  const guessOptions = phase === 'select' ? (duel?.remainingComposition(1) ?? []) : []
  const investigations = duel?.investigationsFor(0) ?? []
  const pending = investigations[readCount]
  const pendingSource = pending?.sourceId
  useEffect(() => {
    if (pendingSource === undefined) {
      setShowInvestigation(false)
      return
    }
    setOverlay(null)
    setPreview(null)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShowInvestigation(true)
      return
    }
    insightCue.current?.scrollIntoView({ block: 'nearest' })
    const timer = window.setTimeout(() => setShowInvestigation(true), 450)
    return () => window.clearTimeout(timer)
  }, [duel, readCount, pendingSource])

  const inspect = (role: Role, action?: { label: string; run: () => void }) => setPreview({
    role,
    action: action && {
      label: action.label,
      run: () => {
        setPreview(null)
        action.run()
      },
    },
  })
  const discardEntries = (side: Side) => ROLES.flatMap(role => {
    const count = duel?.players[side].discard.filter(entry => entry.role === role).length ?? 0
    return count ? [{ role, count }] : []
  })
  const closeOverlay = () => setOverlay(null)
  const options = [...matchDecks(deck, name, saved), ...Object.values(quickDecks)]
  const openMatchSetup = () => {
    const eligible = options.filter(entry => (entry.source === '編集中' || entry.source === '保存済み')
      && !deckCardsError(entry.cards))
    setMyMatchId(id => eligible.some(entry => entry.id === id) ? id : eligible[0]?.id)
    setMatchError('')
    setOverlay({ type: 'start' })
  }
  const selectQuickDeck = (type: DeckType, label: string) => {
    const id = 'quick:' + type
    try {
      if (!quickDecks[type]) {
        const generated: MatchDeck = { id, source: 'おまかせ', name: label, cards: [] }
        setQuickDecks(previous => ({ ...previous, [type]: generated }))
      }
      setQuickMatchId(id)
      setMatchError('')
    } catch (failure) {
      setMatchError(failure instanceof Error ? failure.message : 'デッキを作成できませんでした。')
    }
  }
  const selectNpcDeck = (type: DeckType | 'default') => {
    setMatchError('')
    if (type === npcDeck.type) return
    try {
      setNpcDeck({ type, cards: type === 'default' ? [...STARTER] : [] })
    } catch (failure) {
      setMatchError(failure instanceof Error ? failure.message : 'NPCのデッキを作成できませんでした。')
    }
  }
  const start = (cards: Role[], enemy: Role[], deckName: string) => {
    const error = deckCardsError(cards)
    if (error) throw new Error(error)
    const nextDuel = new Duel([...cards], [...enemy], { npcDifficulty })
    setReadCount(0)
    setShowInvestigation(false)
    setBattleName(deckName)
    setMatchError('')
    setPlays([])
    setTab('log')
    setLogOpen(true)
    setDuel(nextDuel)
    closeOverlay()
    window.scrollTo(0, 0)
  }
  const startPrepared = (selected: MatchDeck, npc = npcDeck) => {
    try {
      start(cardsForMatch(selected.cards, generatedMatchType(selected.id)),
        cardsForMatch(npc.cards, npc.type === 'default' ? undefined : npc.type), selected.name)
      lastMatch.current = { selected, npc }
    } catch (failure) {
      setMatchError(failure instanceof Error ? failure.message : '対戦を開始できませんでした。')
    }
  }
  const persist = (update: (current: SavedDeck[]) => SavedDeck[], message: string) => {
    try {
      const next = update(loadSavedDecks(localStorage))
      storeSavedDecks(localStorage, next)
      setLibrary(readLibrary())
      setNotice(message)
      return true
    } catch {
      setNotice('デッキを保存できませんでした。ブラウザの保存設定と空き容量を確認してください。')
      return false
    }
  }
  const editDeck = (entry: SavedDeck) => {
    setEditingId(entry.id)
    setName(entry.name)
    setDeck([...entry.cards])
    setDraftBaseline([])
  }
  const replaceDraft = (apply: () => void) => {
    if (savedEntry ? !unchanged : !!name || !sameComposition(deck, draftBaseline)) {
      setReplacement(() => apply)
    } else {
      apply()
    }
  }
  const loadDraft = (entry: NamedDeck, id: string | null = null) => {
    setEditingId(id)
    setName(entry.name)
    setDeck([...entry.cards])
    setDraftBaseline([])
    setNotice('')
    closeOverlay()
    requestAnimationFrame(() => document.getElementById('deck-builder-title')?.focus())
  }
  const openSaveDeck = (mode: 'new' | 'copy' | 'overwrite') => {
    setSaveMode(mode)
    setSaveName(mode === 'copy' ? name.slice(0, deckNameLimit - 4) + 'のコピー' : name)
    setNotice('')
    setOverlay({ type: 'save' })
  }
  const saveDeck = () => {
    if (!validDeck(deck)) return
    const target = saveMode === 'overwrite' ? savedEntry : undefined
    if (saveMode === 'overwrite' && (!target || unchanged)) return
    const label = target?.name ?? saveName.trim()
    if (!label || label.length > deckNameLimit) return
    const entry = { id: target?.id ?? newDeckId(), name: label, cards: [...deck] }
    if (persist(current => {
      if (!target) return [...current, entry]
      if (!current.some(item => item.id === target.id)) throw new Error('保存先のデッキがありません。')
      return current.map(item => item.id === target.id ? entry : item)
    }, '「' + entry.name + '」を保存しました。')) {
      editDeck(entry)
      closeOverlay()
    }
  }
  const duplicateDeck = (entry: SavedDeck) => {
    const copy = {
      id: newDeckId(),
      name: entry.name.slice(0, deckNameLimit - 4) + 'のコピー',
      cards: [...entry.cards],
    }
    persist(current => [...current, copy], '「' + copy.name + '」を作成しました。')
  }
  const deleteDeck = (entry: SavedDeck) => {
    if (persist(current => current.filter(item => item.id !== entry.id), '「' + entry.name + '」を削除しました。')) {
      if (editingId === entry.id) setEditingId(null)
    }
    setOverlay({ type: 'library' })
  }
  const downloadDeck = (entry: SavedDeck) => {
    const blob = new Blob([exportDeck(entry)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = entry.name.replace(/[\\/:*?"<>|]/g, '_') + '.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const uploadDeck = async (file: File) => {
    try {
      const entry = { ...importDeck(await file.text()), id: newDeckId() }

      persist(current => [...current, entry], '「' + entry.name + '」をインポートしました。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。')
    }
  }
  const home = () => { setDuel(null); setPlays([]); setPage('home'); setRules(false); window.scrollTo(0, 0) }
  const toggle = (entry: Instance) => {
    if (plays.some(play => play.id === entry.id)) setPlays(plays.filter(play => play.id !== entry.id))
    else if (plays.length < (duel?.max(0) ?? 0)) {
      setPlays([...plays, { id: entry.id }])
      playEffects(['select'])
    }
  }
  const tally=(r:Role)=>deck.filter(x=>x===r).length
  const deckError = deckCardsError(deck)
  const missing = RULES.deckSize - deck.length
  const libraryPreview = saved.find(entry => entry.id === libraryId)
  return <OpenSoundSettings.Provider value={() => setSoundSettings(true)}>
    <header className="top"><div className="wrap top-inner"><span className="brand"><span className="sigil">◈</span> 人狼デュエル</span>
      <div className="top-actions">
        {page === 'builder' && <button className="quiet" onClick={home}>ホームへ戻る</button>}
        <SoundSettingsButton />
      </div>
    </div></header>
    <main className="wrap">
      {online ? Online ? <Online options={matchDecks(deck, name, saved)} onClose={() => setOnline(false)} />
        : <Sheet title="オンライン対戦" onClose={() => setOnline(false)}><p role="status">{onlineLoadError
          ? '現在オンライン対戦を利用できません。NPC対戦は引き続き遊べます。' : 'オンライン対戦を読み込んでいます…'}</p></Sheet>
        : page === 'tutorial' ? <Tutorial onHome={home} />
        : !duel ? <>
        {page === 'home' ? <>
          <section className="hero">
            <div className="moon" aria-hidden="true"/>
            <div className="hero-copy">
              <div className="eyebrow">✦　月夜の決闘</div>
              <h1>人狼デュエル</h1>
              <p>役職を選び、相手の手を読む。<br/>十五夜のうちに、決着をつけろ。</p>
              <div className="home-actions">
                <button className="primary" onClick={openMatchSetup}>NPCと対戦</button>
                <button className="quiet" onClick={() => { setOnline(true); window.scrollTo(0, 0) }}>オンライン対戦</button>
                <button className="quiet" onClick={() => { setPage('builder'); window.scrollTo(0, 0) }}>デッキを作る</button>
                <button className="quiet" onClick={() => { setPage('tutorial'); window.scrollTo(0, 0) }}>チュートリアル</button>
              </div>
              <div className="home-links">
                <button className="quiet" aria-expanded={rules} onClick={() => setRules(value => !value)}>遊び方</button>
              </div>
            </div>
            <div className="hero-index" aria-hidden="true">Ⅰ <span>／</span> ⅩⅤ</div>
          </section>
          {rules && (
            <section className="panel guide">
              <h2>遊び方</h2>
              <h3>基本ルール</h3>
              <ul>
                <li>{RULES.deckSize}枚のデッキで対戦します。初期HPは{RULES.hp}、初期手札は{RULES.opening}枚です。</li>
                <li>毎夜の開始時に{RULES.nightlyDraw}枚引き、お互いが手札から1〜{RULES.maxPlays}枚を選んで確定すると同時公開します。</li>
                <li>妨害、防御、攻撃・反撃、HP0の勝敗判定、回復、ドロー・回収の順に処理します。</li>
                <li>夜終了時、手札が{RULES.handRefill}枚未満なら{RULES.handRefill}枚まで補充します。手札の上限は{RULES.handLimit}枚です。</li>
                <li>引くときに山札が空なら、捨て札をシャッフルして山札に戻します。</li>
                <li>HPが0になった側が敗北します。第{RULES.finalNight}夜の処理後も双方が生き残っていれば、HPが多い側の勝ちです。同時にHP0になった場合や、最終夜のHPが同じ場合は引き分けです。</li>
              </ul>
              <h3>カードの種類</h3>
              <dl className="guide-types">
                <dt>{CATEGORY.attack}</dt><dd>相手にダメージを与えます。</dd>
                <dt>{CATEGORY.guard}</dt><dd>ダメージを防いだり、HPを回復したりします。</dd>
                <dt>{CATEGORY.intel}</dt><dd>相手の手札や山札を調べたり、相手の行動に応じてカードを引いたりします。</dd>
                <dt>{CATEGORY.supply}</dt><dd>カードを引いたり、捨て札から回収したりします。</dd>
                <dt>{CATEGORY.hex}</dt><dd>相手のカード効果を無効にしたり、行動を制限したりします。</dd>
              </dl>
              <h3>カードの例</h3>
              <p>カードをタップすると詳細が見れます。20種類すべての効果は下のカード一覧で確認できます。</p>
              <div className="guide-cards">
                <div><CardTile role="wolf" onInspect={() => inspect('wolf')} /><p>相手にダメージを与える。</p></div>
                <div><CardTile role="hunter" onInspect={() => inspect('hunter')} /><p>相手の襲撃を防ぐ。</p></div>
                <div><CardTile role="seer" onInspect={() => inspect('seer')} /><p>相手の手札を調べる。</p></div>
              </div>
            </section>
          )}
          <section className="home-catalog" aria-labelledby="home-catalog-title">
            <div className="section-title"><h2 id="home-catalog-title">カード一覧</h2></div>
            <div className="catalog">
              {ROLES.map(role => (
                <article className="deck-item" key={role}>
                  <CardTile role={role} onInspect={() => inspect(role)} />
                  <p className="card-text">{card(role).text}</p>
                </article>
              ))}
            </div>
          </section>
        </> : (
        <section className="builder" aria-labelledby="deck-builder-title">
          <div className="section-title builder-heading"><div><div className="eyebrow">01 / DECK BUILDER</div><h2 id="deck-builder-title" tabIndex={-1}>デッキ構築</h2></div></div>
          <section className="panel builder-summary" aria-label="編集中のデッキ">
            <div className="builder-deck">
              <strong>{name.trim() || '新規デッキ'}</strong>
              <span className="builder-count">{deck.length} / {RULES.deckSize}枚</span>
              <span className="builder-save-status" role="status" data-saved={unchanged}>{saveStatus}</span>
            </div>
            <div className="builder-actions">
              <button className="primary" aria-haspopup="dialog" disabled={!!deckError || unchanged}
                onClick={() => openSaveDeck(savedEntry ? 'overwrite' : 'new')}>デッキを保存</button>
              {savedEntry && <button className="quiet" aria-haspopup="dialog" disabled={!!deckError}
                onClick={() => openSaveDeck('copy')}>別名で保存</button>}
            </div>
            {deckError && <p className="builder-missing" role="status">{missing > 0
              ? 'あと' + missing + '枚追加すると保存できます。' : deckError}</p>}
          </section>
          <div className="builder-launchers">
            <button className="quiet" aria-haspopup="dialog" onClick={() => setOverlay({ type: 'generate' })}>おまかせ生成</button>
            <button className="quiet" aria-haspopup="dialog" onClick={() => { setLibraryId(editingId); setNotice(''); setOverlay({ type: 'library' }) }}>保存済みデッキ</button>
          </div>
          <div className="builder-actions builder-secondary">
            <button className="quiet" onClick={() => replaceDraft(() => loadDraft({ name: '', cards: [] }))}>新規作成</button>
            <button className="quiet" aria-haspopup="dialog" onClick={() => { setNotice(''); setOverlay({ type: 'other' }) }}>その他</button>
          </div>
          {notice && <p className="notice builder-notice" role="status">{notice}</p>}
          <p className="hint">カードの下の ＋ / − で投入枚数を変更。20枚揃えると保存できます。</p>
          <div className="catalog">{ROLES.map(r=><article className="deck-item" key={r}><CardTile role={r} onInspect={() => inspect(r)} /><div className="quantity"><button aria-label={card(r).name+'を減らす'} disabled={!tally(r)} onClick={()=>setDeck(d=>{const copy=[...d];copy.splice(copy.indexOf(r),1);return copy})}>−</button><span>{tally(r)} <small>/ {card(r).limit}</small></span><button aria-label={card(r).name+'を増やす'} disabled={deck.length>=RULES.deckSize||tally(r)>=card(r).limit} onClick={()=>setDeck(d=>[...d,r])}>＋</button></div><p className="card-text builder-effect">{card(r).text}</p></article>)}</div>
        </section>)}
      </>:<>
        <div className="section-title battle-title"><div><div className="eyebrow">02 / THE DUEL</div><h1>第{duel.night}夜 <small>/ {duel.rules.finalNight}</small></h1><p className="battle-deck-name">使用デッキ：{battleName}</p></div><button className="quiet" disabled={!!pending} onClick={home}>{phase==='finished'?'ホームへ戻る':'対戦を終了して戻る'}</button></div>
        <div className="fighters">{([0, 1] as const).map(side => {
          const player = duel.players[side]
          const { lost, gained } = duel.nightHpChange(side)
          const name = side === 0 ? 'あなた' : 'NPC（' + NPC_DIFFICULTIES[duel.npcDifficulty] + '）'
          return (
            <section className={'panel fighter side' + side} key={side} aria-label={name}>
              <div className="fighter-line">
                <strong>{name}</strong>
                <div className="fighter-hp">
                  <span><b>{player.hp}</b> / {duel.rules.hp} HP</span>
                  <HpChanges lost={lost} gained={gained} />
                </div>
              </div>
              <progress value={player.hp} max={duel.rules.hp} aria-label={name + 'のHP'} />
              <div className="stats">山札 {player.deck.length}　手札 {player.hand.length}　捨て札 {player.discard.length}</div>
              <div className="status">
                {player.status.noHeal && <span>回復無効</span>}
                {player.status.limited && <span>使用は1枚まで</span>}
              </div>
            </section>
          )
        })}</div>
        <div className="battle-tools">
          <button className="quiet" aria-haspopup="dialog" disabled={!!pending} onClick={() => setOverlay({ type: 'deck', side: 0 })}>自分のデッキ</button>
          <button className="quiet" aria-haspopup="dialog" disabled={!!pending} onClick={() => setOverlay({ type: 'deck', side: 1 })}>相手のデッキ</button>
          <button className="quiet" aria-haspopup="dialog" disabled={!!pending} onClick={() => setOverlay({ type: 'investigations' })}>調査記録</button>
        </div>
        <div className="battle-layout"><section className="panel play-area">
          {pending && !showInvestigation && <p ref={insightCue} className="insight-cue" role="status">{pending.kind === 'seer' ? '占い師が相手の手札を透視！' : '預言者が相手の山札を透視！'}</p>}
          {duel.revealed.some(row=>row.length>0)&&<div className={'reveal '+(phase==='reveal'?'flipping':'')} aria-label="同時公開"><div className="eyebrow">✦　同時公開</div><div className="reveal-columns">{duel.revealed.map((row,i)=><div key={i}><h3>{i===0?'あなた':'NPC'}</h3><div className="duel-cards">{row.map(c=><CardTile compact role={c.role} key={c.id} onInspect={() => inspect(c.role)} glowing={i===0 && pending?.kind===c.role && pending.sourceId===c.id && !showInvestigation} disabled={c.disabled} detail={c.disabled?'効果無効':c.guess?'予想：'+card(c.guess).name:undefined}/>)}{!row.length&&<p>パス</p>}</div></div>)}</div></div>}
          {phase==='select'&&<><div className="hand-heading"><h2>手札を選択</h2><span>{plays.length} / {duel.max(0)} 枚</span></div><p className="hint">{duel.players[0].hand.length?'カードをタップすると詳細が見れます。選択後に確定すると同時公開します。':'手札がないため、この夜はパスします。'}</p><div className="duel-cards hand-cards" aria-label="手札">{duel.players[0].hand.map(c => {
              const selected = plays.some(play => play.id === c.id)
              return <CardTile compact key={c.id} role={c.role} selected={selected} onClick={() => toggle(c)}
                onInspect={() => inspect(c.role, selected || plays.length < duel.max(0)
                  ? { label: selected ? '選択を解除' : 'このカードを選択', run: () => toggle(c) }
                  : undefined)} />
            })}</div>
            {plays.filter(p => duel.players[0].hand.find(c => c.id === p.id)?.role === 'assassin').map((p, i) => (
              <div className="prediction" key={p.id}>
                <span>暗殺者 {i + 1} の予想</span>
                <button className="quiet" aria-haspopup="dialog" disabled={!guessOptions.length} onClick={() => setOverlay({ type: 'guess', id: p.id })}>
                  {p.guess ? card(p.guess).name + '（変更）' : guessOptions.length ? '役職を選ぶ' : '予想できる役職なし'}
                </button>
              </div>
            ))}
            <div className="hand-actions"><button className="primary action" disabled={(duel.players[0].hand.length>0&&!plays.length)||plays.some(p=>duel.players[0].hand.find(c=>c.id===p.id)?.role==='assassin'&&guessOptions.length>0&&!guessOptions.some(entry=>entry.role===p.guess))} onClick={()=>{if(duel.lock(plays)){playEffects(['confirm']);setPlays([]);refresh()}}}>{duel.players[0].hand.length?'選択を確定':'パスを確定'} →</button></div></>}

          {!pending && phase==='choice'&&duel.prompt&&<div className="choice"><h2>{duel.prompt.title}</h2><div className="duel-cards">{duel.prompt.options.map(c=><CardTile compact key={c.id} role={c.role} onClick={()=>{duel.answer(c.id);refresh()}} onInspect={() => inspect(c.role, { label: 'このカードを選択', run: () => { duel.answer(c.id); refresh() } })} />)}</div></div>}
          {!pending && phase==='end'&&<button className="primary action" onClick={()=>{duel.nextNight();refresh()}}>次の夜へ →</button>}
          {!pending && phase==='finished'&&<div className="result" role="status"><div className="eyebrow">✦　決着</div><h2>{duel.winner==='draw'?'引き分け':duel.winner===0?'あなたの勝利':'NPCの勝利'}</h2><p>{duel.reason}　あなた {duel.players[0].hp} HP / NPC {duel.players[1].hp} HP</p>
            <button className="primary" onClick={() => {
              const previous = lastMatch.current
              if (previous) startPrepared(previous.selected, previous.npc)
            }}>もう一度対戦</button>
            {matchError && <p role="alert">{matchError}</p>}
          </div>}
        </section><aside className="panel chronicle">
          <h2>対戦記録</h2><div className="filters tabs">{([['log','ログ'],['self','自分の捨て札'],['enemy','NPCの捨て札']] as const).map(([k,name])=><button key={k} className={k===tab?'active':''} aria-pressed={tab===k} onClick={()=>setTab(k)}>{name}</button>)}</div>
          {tab === 'log' ? (
            <details open={logOpen} onToggle={event => setLogOpen(event.currentTarget.open)}><summary>対戦ログ</summary>
            <ol className="log" aria-label="対戦ログ">{duel.log.filter(entry => entry.privateTo !== 1).map((entry, index) => (
              <li key={index}><span>第{entry.night}夜</span>{entry.privateTo === 0 && <em>自分のみ</em>}
                <CardLog text={entry.text} onInspect={inspect} />
              </li>
            )).reverse()}</ol></details>
          ) : (
            <div className="discard-art">
              <button className="quiet" onClick={() => setOverlay({ type: 'discard', side: tab === 'self' ? 0 : 1 })}>捨て札を拡大</button>
              {discardEntries(tab === 'self' ? 0 : 1).length
                ? <DeckComposition entries={discardEntries(tab === 'self' ? 0 : 1)} onInspect={inspect} />
                : <p className="hint">捨て札はありません。</p>}
            </div>
          )}
        </aside></div>
      </>}
      {pending && showInvestigation && (
        <InvestigationPanel
          key={readCount}
          records={[pending]}
          onInspect={inspect}
          onConfirm={() => {
            setShowInvestigation(false)
            setReadCount(count => count + 1)
          }}
        />
      )}
      {overlay?.type === 'investigations' && !pending && (
        <InvestigationPanel records={[...investigations].reverse()} onClose={closeOverlay} onInspect={inspect} />
      )}
      {overlay?.type === 'generate' && (
        <DeckGenerator usedNames={saved.map(entry => entry.name)} onClose={closeOverlay} onBeforeGenerate={replaceDraft} onEdit={loadDraft} />
      )}
      {overlay?.type === 'library' && (
        <Sheet title="保存済みデッキ" onClose={closeOverlay} className="builder-sheet builder-library"
          footer={libraryPreview && <button className="primary" onClick={() => replaceDraft(() => loadDraft(libraryPreview, libraryPreview.id))}>編集する</button>}>
          {saved.length ? <ul className="match-options">
            {saved.map(entry => (
              <li key={entry.id}>
                <button className="quiet match-option" aria-pressed={entry.id === libraryId} onClick={() => setLibraryId(entry.id)}>
                  <strong>{entry.name}</strong><span>{entry.cards.length} / {RULES.deckSize}枚</span>
                </button>
              </li>
            ))}
          </ul> : <p className="hint">保存済みデッキはありません。</p>}
          {libraryPreview && <section>
            <div className="library-heading">
              <h3>{libraryPreview.name}</h3>
              <div className="deck-tools">
                <button className="quiet" onClick={() => duplicateDeck(libraryPreview)}>複製</button>
                <button className="quiet" onClick={() => setOverlay({ type: 'delete', deck: libraryPreview })}>削除</button>
              </div>
            </div>
            <DeckCardList cards={libraryPreview.cards} onInspect={inspect} />
          </section>}
          {notice && <p className="notice" role="status">{notice}</p>}
        </Sheet>
      )}
      {overlay?.type === 'other' && (
        <Sheet title="その他" className="builder-sheet" onClose={closeOverlay}>
          <label className="quiet import-button">
            JSONをインポート
            <input type="file" accept=".json,application/json" aria-label="JSONをインポート" onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void uploadDeck(file)
            }} />
          </label>
          <h3 className="json-export-heading">JSONエクスポート</h3>
          {saved.length ? <ul className="saved-decks">
            {saved.map(entry => (
              <li key={entry.id}>
                <strong>{entry.name}</strong>
                <button className="quiet" onClick={() => downloadDeck(entry)}>JSON出力</button>
              </li>
            ))}
          </ul> : <p className="hint">エクスポートできる保存済みデッキはありません。</p>}
          {notice && <p className="notice" role="status">{notice}</p>}
        </Sheet>
      )}
      {replacement && (
        <Sheet title="編集中のデッキを置き換えますか？" className="builder-sheet" onClose={() => setReplacement(null)}
          footer={<button className="primary" onClick={() => { setReplacement(null); replacement() }}>置き換える</button>}>
          <p>現在の未保存の変更は失われます。</p>
        </Sheet>
      )}
      {overlay?.type === 'save' && (
        <Sheet title={saveMode === 'overwrite' ? '上書き保存' : saveMode === 'copy' ? '別名で保存' : 'デッキを保存'}
          className="builder-sheet" onClose={closeOverlay}>
          <form className="deck-editor save-deck-form" onSubmit={event => { event.preventDefault(); saveDeck() }}>
            {saveMode === 'overwrite' ? (
              <p>「{savedEntry?.name}」を現在のカード構成で上書きします。</p>
            ) : (
              <>
                <label htmlFor="save-deck-name">デッキ名</label>
                <input id="save-deck-name" value={saveName} maxLength={deckNameLimit} placeholder="例：月夜の狩人"
                  onChange={event => setSaveName(event.target.value)} />
              </>
            )}
            <button className="primary" type="submit"
              disabled={!!deckError || (saveMode === 'overwrite' ? !savedEntry || unchanged : !saveName.trim())}>
              {saveMode === 'overwrite' ? '上書きする' : '保存する'}
            </button>
          </form>
          {notice && <p className="notice" role="alert">{notice}</p>}
        </Sheet>
      )}
      {overlay?.type === 'start' && (
        <MatchSetup
          options={options} quickId={quickMatchId} myId={myMatchId}
          onSelect={id => { setMyMatchId(id); setMatchError('') }}
          npcDeck={npcDeck} onNpcType={selectNpcDeck}
          npcDifficulty={npcDifficulty} onDifficulty={setNpcDifficulty}
          onStart={startPrepared} onInspect={inspect} onClose={closeOverlay}
          error={matchError} issues={library.issues}
          onStandard={() => { setQuickMatchId('standard'); setMatchError('') }} onGenerate={selectQuickDeck} onClearError={() => setMatchError('')}
        />
      )}
      {overlay?.type === 'deck' && duel && !pending && (
        <DeckViewer
          title={overlay.side === 0 ? '自分のデッキ' : '相手のデッキ'}
          night={duel.night}
          hp={duel.players[overlay.side].hp}
          initial={duel.deckComposition(overlay.side)}
          remaining={duel.remainingComposition(overlay.side)}
          onInspect={inspect}
          onClose={closeOverlay}
        />
      )}
      {overlay?.type === 'guess' && duel && (
        <AssassinPrediction
          entries={guessOptions}
          initial={plays.find(play => play.id === overlay.id)?.guess}
          onConfirm={role => {
            setPlays(old => old.map(play => play.id === overlay.id ? { ...play, guess: role } : play))
            closeOverlay()
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay?.type === 'delete' && (
        <Sheet title="保存したデッキを削除" className="builder-sheet" onClose={() => setOverlay({ type: 'library' })}>
          <p>「{overlay.deck.name}」を削除しますか？</p>
          <button className="quiet action" onClick={() => deleteDeck(overlay.deck)}>削除する</button>
        </Sheet>
      )}
      {overlay?.type === 'discard' && (
        <Sheet title={overlay.side === 0 ? '自分の捨て札' : 'NPCの捨て札'} onClose={closeOverlay}>
          {discardEntries(overlay.side).length
            ? <DeckComposition entries={discardEntries(overlay.side)} onInspect={inspect} />
            : <p className="hint">捨て札はありません。</p>}
        </Sheet>
      )}
      {preview && <CardDetail {...preview} onClose={() => setPreview(null)} />}
      {soundSettings && <SoundSettings onClose={() => setSoundSettings(false)} />}
    </main><footer className="wrap footer">◈　人狼デュエル <span>WEREWOLF DUEL</span></footer>
  </OpenSoundSettings.Provider>
}
initAudio()
createRoot(document.getElementById('root')!).render(<App/>)
