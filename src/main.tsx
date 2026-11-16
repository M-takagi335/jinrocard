import { useEffect, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { card, CATEGORY, NPC_DECK, ROLES, RULES, STARTER, validDeck, type Role } from './cards.ts'
import { Duel, type Instance, type Play, type Side } from './duel.ts'
import { deckCardsError, deckNameLimit, exportDeck, importDeck, inspectSavedDecks, loadSavedDecks, matchDecks, storeSavedDecks, type MatchDeck, type NamedDeck, type SavedDeck } from './decks.ts'
import { CardTile } from './CardTile.tsx'
import { CardDetail } from './CardDetail.tsx'
import { DeckViewer } from './DeckViewer.tsx'
import { InvestigationPanel } from './InvestigationPanel.tsx'
import { DeckGenerator, type QuickEntry } from './DeckGenerator.tsx'
import { MatchSetup } from './MatchSetup.tsx'
import { generateDeck, type DeckType } from './generateDeck.ts'
import { DeckComposition, Sheet } from './Sheet.tsx'
import { AssassinPrediction } from './AssassinPrediction.tsx'
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

type Overlay = { type: 'start' | 'generate' | 'investigations' | 'catalog' | 'manage' | 'save' | 'quick-deck' } | { type: 'deck' | 'discard'; side: Side } | { type: 'guess'; id: number } | { type: 'delete'; deck: SavedDeck }

const rolesByName = new Map(ROLES.map(role => [card(role).name, role]))
const roleMention = new RegExp('(' + [...rolesByName.keys()].sort((a, b) => b.length - a.length).join('|') + ')', 'g')

function CardLog({ text, onInspect }: { text: string; onInspect: (role: Role) => void }) {
  return text.split(roleMention).map((part, index) => {
    const role = rolesByName.get(part)
    return role ? <button type="button" className="log-card-link" key={index}
      onClick={() => onInspect(role)} aria-haspopup="dialog">{part}</button> : part
  })
}

function App() {
  const [deck,setDeck]=useState(loadDeck)
  const [library, setLibrary] = useState(readLibrary)
  const saved = library.decks
  const [name, setName] = useState('')
  const [saveName, setSaveName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [battleDeck, setBattleDeck] = useState<Role[]>([])
  const [battleEnemy, setBattleEnemy] = useState<Role[]>([])
  const [npcType, setNpcType] = useState<DeckType | 'default'>('default')
  const [battleName, setBattleName] = useState('')
  const [matchSelection, setMatchSelection] = useState('standard')
  const [quickDecks, setQuickDecks] = useState<Partial<Record<DeckType, QuickEntry>>>({})
  const [quickType, setQuickType] = useState<DeckType>()
  const [matchError, setMatchError] = useState('')
  const [filter,setFilter]=useState<string>('all')
  const [duel,setDuel]=useState<Duel|null>(null)
  const insightCue = useRef<HTMLParagraphElement>(null)
  const [readCount, setReadCount] = useState(0)
  const [showInvestigation, setShowInvestigation] = useState(false)
  const [plays,setPlays]=useState<Play[]>([])
  const [tab,setTab]=useState<'log'|'self'|'enemy'>('log')
  const [preview, setPreview] = useState<{ role: Role; action?: { label: string; run: () => void } } | null>(null)
  const [rules,setRules]=useState(false)
  const [,refresh]=useReducer((n:number)=>n+1,0)
  useEffect(()=>{try{localStorage.setItem('jinro-deck',JSON.stringify(deck))}catch{/* unavailable */}},[deck])
  const phase=duel?.phase, night=duel?.night
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
  const options = overlay?.type === 'start' ? matchDecks(deck, name, saved) : []
  const openMatchSetup = () => {
    const entries = matchDecks(deck, name, saved)
    setMatchSelection(id => entries.some(entry => entry.id === id) ? id : 'standard')
    setMatchError('')
    setOverlay({ type: 'start' })
  }
  const start = (cards: Role[], enemy: Role[], deckName: string) => {
    const error = deckCardsError(cards)
    if (error) throw new Error(error)
    const playerCards = [...cards]
    const nextDuel = new Duel(playerCards, enemy)
    setReadCount(0)
    setShowInvestigation(false)
    setBattleDeck(playerCards)
    setBattleEnemy([...enemy])
    setBattleName(deckName)
    setMatchError('')
    setPlays([])
    setTab('log')
    setDuel(nextDuel)
    closeOverlay()
    window.scrollTo(0, 0)
  }
  const startPrepared = (selected: MatchDeck) => {
    try {
      start(selected.cards, npcType === 'default' ? NPC_DECK : generateDeck(npcType), selected.name)
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
  }
  const saveGenerated = (decks: NamedDeck[]) => {
    if (!decks.length || decks.some(entry => !validDeck(entry.cards) ||
      !entry.name.trim() || entry.name.trim().length > deckNameLimit)) return false
    const additions = decks.map(entry => ({
      id: newDeckId(),
      name: entry.name.trim(),
      cards: [...entry.cards],
    }))
    return persist(current => [...current, ...additions], additions.length + '件のデッキを保存しました。')
  }
  const editGenerated = (entry: NamedDeck) => {
    setEditingId(null)
    setName(entry.name.trim())
    setDeck([...entry.cards])
    setFilter('all')
    setNotice('')
    closeOverlay()
    requestAnimationFrame(() => document.getElementById('builder-play')?.focus())
  }
  const openSaveDeck = () => {
    setSaveName(name)
    setNotice('')
    setOverlay({ type: 'save' })
  }
  const saveDeck = () => {
    if (!validDeck(deck) || !saveName.trim()) return
    const entry = { id: editingId ?? newDeckId(), name: saveName.trim(), cards: [...deck] }
    if (persist(current => current.some(item => item.id === entry.id)
      ? current.map(item => item.id === entry.id ? entry : item)
      : [...current, entry], '「' + entry.name + '」を保存しました。')) {
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
    closeOverlay()
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
  const home=()=>{setDuel(null);setPlays([]);window.scrollTo(0,0)}
  const toggle=(c:Instance)=>setPlays(old=>old.some(x=>x.id===c.id)?old.filter(x=>x.id!==c.id):old.length<(duel?.max(0)??0)?[...old,{id:c.id}]:old)
  const tally=(r:Role)=>deck.filter(x=>x===r).length
  const deckError = deckCardsError(deck)
  const missing = RULES.deckSize - deck.length
  const resetTools = (
    <div className="deck-tools">
      <button className="quiet" onClick={() => { setDeck([...STARTER]); closeOverlay() }}>初期デッキに戻す</button>
      <button className="quiet" disabled={!deck.length} onClick={() => { setDeck([]); closeOverlay() }}>空にする</button>
    </div>
  )
  const startDraft = () => {
    if (deckCardsError(deck)) return
    try {
      start(deck, NPC_DECK, name.trim() || '編集中のデッキ')
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : '対戦を開始できませんでした。')
    }
  }
  const deckManagement = (
    <>
      <div className="deck-editor">
        <button className="primary" disabled={!!deckError} aria-haspopup="dialog" onClick={openSaveDeck}>
          {editingId ? '変更を保存' : 'デッキを保存'}
        </button>
        <button className="quiet" onClick={() => {
          setEditingId(null); setName(''); setDeck([]); setNotice(''); closeOverlay()
        }}>新規デッキ</button>
        <button className="quiet" aria-haspopup="dialog" onClick={() => setOverlay({ type: 'generate' })}>おまかせ作成</button>
      </div>
      <div className="library-heading">
        <h3>保存済みデッキ</h3>
        <label className="quiet import-button">
          JSONをインポート
          <input type="file" accept=".json,application/json" aria-label="JSONをインポート" onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void uploadDeck(file)
          }} />
        </label>
      </div>
      {saved.length ? (
        <ul className="saved-decks">
          {saved.map(entry => (
            <li key={entry.id}>
              <strong>{entry.name}{editingId === entry.id && <small>編集中</small>}</strong>
              <div className="deck-tools">
                <button className="quiet" onClick={() => { editDeck(entry); setNotice(''); closeOverlay() }}>編集</button>
                <button className="quiet" onClick={() => duplicateDeck(entry)}>複製</button>
                <button className="quiet" onClick={() => downloadDeck(entry)}>JSON出力</button>
                <button className="quiet" onClick={() => setOverlay({ type: 'delete', deck: entry })}>削除</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="hint">保存済みのデッキはありません。</p>}
    </>
  )
  return <>
    <header className="top"><div className="wrap top-inner"><span className="brand"><span className="sigil">◈</span> 人狼デュエル</span><span className="top-caption">WEREWOLF DUEL</span><button className="quiet" aria-expanded={rules} onClick={()=>setRules(v=>!v)}>{rules?'ルールを閉じる':'遊び方'}</button></div></header>
    <main className="wrap">
      {rules&&<section className="panel guide"><h2>遊び方</h2><p>20枚のデッキでNPCと対戦します。初期HPは20、初期手札は5枚。毎夜の開始時に1枚引き、手札から1～2枚を選んで確定すると、双方のカードが同時に公開されます。</p><p>妨害、防御、攻撃・反撃、勝敗判定、回復、ドロー・回収の順に処理します。夜終了時に手札が{RULES.handRefill}枚未満なら、{RULES.handRefill}枚になるまで補充します。手札の上限は7枚。山札が空なら捨て札を混ぜて引きます。</p><p>先にHPが0になった側が敗北。同時に0なら引き分け。第15夜の効果をすべて処理しても双方が生き残っていれば、HPが多い側の勝利です。</p>
        <p>{card('hunter').name}：{card('hunter').text}<br/>{card('knight').name}：{card('knight').text}</p>
        <div className="guide-cards">{(['wolf', 'hunter', 'seer'] as const).map(role => (
          <CardTile key={role} role={role} onInspect={() => inspect(role)} />
        ))}</div>
      </section>}
      {!duel ? <>
        <section className="hero"><div className="moon" aria-hidden="true"/><div className="hero-copy"><div className="eyebrow">✦　月夜の決闘</div><h1>人狼デュエル</h1><p>役職を選び、相手の手を読む。<br/>十五夜のうちに、決着をつけろ。</p><button className="primary" onClick={openMatchSetup}>NPC戦を開始 <span aria-hidden="true">→</span></button> <button className="quiet catalog-launch" onClick={() => setOverlay({ type: 'catalog' })}>カード一覧</button></div><div className="hero-index" aria-hidden="true">Ⅰ <span>／</span> ⅩⅤ</div></section>
        <section className="builder" id="deck-builder" tabIndex={-1}>
          <div className="section-title builder-heading"><div><div className="eyebrow">01 / DECK BUILDER</div><h2>デッキ構築</h2></div></div>
          <div className="builder-summary">
            <div className="builder-deck">
              <strong>{name.trim() || '編集中のデッキ'}</strong>
              <span className="builder-count">{deck.length}/{RULES.deckSize}枚</span>
            </div>
            <div className="builder-actions">
              <button id="builder-play" className="primary" disabled={!!deckError} onClick={startDraft}>このデッキでNPC戦</button>
              <button className="quiet manage-launch" aria-haspopup="dialog" onClick={() => setOverlay({ type: 'manage' })}>管理</button>
            </div>
            {deckError && <p className="builder-missing" role="status">{missing > 0 ? 'あと' + missing + '枚で対戦できます。' : deckError}</p>}
          </div>
          {notice && <p className="notice builder-notice" role="status">{notice}</p>}
          <section className="panel deck-library builder-desktop" aria-label="デッキ管理">
            {deckManagement}
          </section>
          <div className="controls"><div className="filters" aria-label="カード分類">{[['all','すべて'],...Object.entries(CATEGORY)].map(([key,label])=><button key={key} className={filter===key?'active':''} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div><div className="builder-desktop">{resetTools}</div></div>
          <p className="hint">カードの下の ＋ / − で投入枚数を変更。20枚揃えると対戦できます。</p>
          <div className="catalog">{ROLES.filter(r=>filter==='all'||card(r).category===filter).map(r=><article className="deck-item" key={r}><CardTile role={r} onInspect={() => inspect(r)} /><div className="quantity"><button aria-label={card(r).name+'を減らす'} disabled={!tally(r)} onClick={()=>setDeck(d=>{const copy=[...d];copy.splice(copy.indexOf(r),1);return copy})}>−</button><span>{tally(r)} <small>/ {card(r).limit}</small></span><button aria-label={card(r).name+'を増やす'} disabled={deck.length>=RULES.deckSize||tally(r)>=card(r).limit} onClick={()=>setDeck(d=>[...d,r])}>＋</button></div></article>)}</div>
        </section>
      </>:<>
        <div className="section-title battle-title"><div><div className="eyebrow">02 / THE DUEL</div><h1>第{duel.night}夜 <small>/ {duel.rules.finalNight}</small></h1><p className="battle-deck-name">使用デッキ：{battleName}</p></div><button className="quiet" disabled={!!pending} onClick={home}>{phase==='finished'?'デッキに戻る':'対戦を終了して戻る'}</button></div>
        <div className="fighters">{([0, 1] as const).map(side => {
          const player = duel.players[side]
          const { lost, gained } = duel.nightHpChange(side)
          const name = side === 0 ? 'あなた' : 'NPC'
          return (
            <section className={'panel fighter side' + side} key={side} aria-label={name}>
              <div className="fighter-line">
                <strong>{name}</strong>
                <div className="fighter-hp">
                  <span><b>{player.hp}</b> / {duel.rules.hp} HP</span>
                  <span className="hp-changes" aria-live="polite">
                    {lost > 0 && <span className="hp-loss" aria-label={'今夜のHP減少 ' + lost}>−{lost}</span>}
                    {gained > 0 && <span className="hp-gain" aria-label={'今夜のHP回復 ' + gained}>+{gained}</span>}
                  </span>
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
          {phase==='select'&&<><div className="hand-heading"><h2>手札を選択</h2><span>{plays.length} / {duel.max(0)} 枚</span></div><p className="hint">{duel.players[0].hand.length?'カードをタップすると拡大できます。選択後に確定すると同時公開します。':'手札がないため、この夜はパスします。'}</p><div className="duel-cards hand-cards" aria-label="手札">{duel.players[0].hand.map(c => {
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
            <div className="hand-actions"><button className="primary action" disabled={(duel.players[0].hand.length>0&&!plays.length)||plays.some(p=>duel.players[0].hand.find(c=>c.id===p.id)?.role==='assassin'&&guessOptions.length>0&&!guessOptions.some(entry=>entry.role===p.guess))} onClick={()=>{if(duel.lock(plays)){setPlays([]);refresh()}}}>{duel.players[0].hand.length?'選択を確定':'パスを確定'} →</button></div></>}

          {!pending && phase==='choice'&&duel.prompt&&<div className="choice"><h2>{duel.prompt.title}</h2><div className="duel-cards">{duel.prompt.options.map(c=><CardTile compact key={c.id} role={c.role} onClick={()=>{duel.answer(c.id);refresh()}} onInspect={() => inspect(c.role, { label: 'このカードを選択', run: () => { duel.answer(c.id); refresh() } })} />)}</div></div>}
          {!pending && phase==='end'&&<button className="primary action" onClick={()=>{duel.nextNight();refresh()}}>次の夜へ →</button>}
          {!pending && phase==='finished'&&<div className="result" role="status"><div className="eyebrow">✦　決着</div><h2>{duel.winner==='draw'?'引き分け':duel.winner===0?'あなたの勝利':'NPCの勝利'}</h2><p>{duel.reason}　あなた {duel.players[0].hp} HP / NPC {duel.players[1].hp} HP</p><button className="primary" onClick={() => start(battleDeck, battleEnemy, battleName)}>同じデッキで再戦 →</button></div>}
        </section><aside className="panel chronicle">
          <h2>対戦記録</h2><div className="filters tabs">{([['log','ログ'],['self','自分の捨て札'],['enemy','NPCの捨て札']] as const).map(([k,name])=><button key={k} className={k===tab?'active':''} aria-pressed={tab===k} onClick={()=>setTab(k)}>{name}</button>)}</div>
          {tab === 'log' ? (
            <ol className="log" aria-label="対戦ログ">{duel.log.filter(entry => entry.privateTo !== 1).map((entry, index) => (
              <li key={index}><span>第{entry.night}夜</span>{entry.privateTo === 0 && <em>自分のみ</em>}
                <CardLog text={entry.text} onInspect={inspect} />
              </li>
            )).reverse()}</ol>
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
      {(overlay?.type === 'generate' || overlay?.type === 'quick-deck') && (
        <DeckGenerator
          key={overlay.type}
          quick={overlay.type === 'quick-deck' ? {
            active: quickType,
            entries: quickDecks,
            onReady: entry => {
              setQuickType(entry.type)
              setQuickDecks(previous => ({ ...previous, [entry.type]: entry }))
            },
          } : undefined}
          usedNames={saved.map(entry => entry.name)}
          onInspect={inspect}
          onClose={overlay.type === 'quick-deck' ? openMatchSetup : closeOverlay}
          onUse={entry => start(entry.cards, NPC_DECK, entry.name)}
          onEdit={editGenerated}
          onSave={saveGenerated}
        />
      )}
      {overlay?.type === 'manage' && (
        <Sheet title="デッキ管理" onClose={closeOverlay}>
          {deckError && <p className="hint">{missing > 0 ? '保存にはあと' + missing + '枚必要です。' : deckError}</p>}
          {deckManagement}
          <div className="management-reset">{resetTools}</div>
          {notice && <p className="notice" role="status">{notice}</p>}
        </Sheet>
      )}
      {overlay?.type === 'save' && (
        <Sheet title={editingId ? '変更を保存' : 'デッキを保存'} onClose={closeOverlay}>
          <form className="deck-editor save-deck-form" onSubmit={event => { event.preventDefault(); saveDeck() }}>
            <label htmlFor="save-deck-name">デッキ名</label>
            <input id="save-deck-name" value={saveName} maxLength={deckNameLimit} placeholder="例：月夜の狩人"
              onChange={event => setSaveName(event.target.value)} />
            <button className="primary" type="submit" disabled={!!deckError || !saveName.trim()}>保存する</button>
          </form>
          {notice && <p className="notice" role="alert">{notice}</p>}
        </Sheet>
      )}
      {overlay?.type === 'start' && (
        <MatchSetup
          options={options} selectedId={matchSelection}
          onSelect={id => { setMatchSelection(id); setMatchError('') }}
          npcType={npcType} onNpcType={type => { setNpcType(type); setMatchError('') }}
          onStart={startPrepared} onInspect={inspect} onClose={closeOverlay}
          error={matchError} issues={library.issues}
          onGenerate={() => setOverlay({ type: 'quick-deck' })}
          onBuild={() => {
            closeOverlay()
            requestAnimationFrame(() => document.getElementById('deck-builder')?.focus())
          }}
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
        <Sheet title="保存したデッキを削除" onClose={closeOverlay}>
          <p>「{overlay.deck.name}」を削除しますか？</p>
          <button className="quiet action" onClick={() => deleteDeck(overlay.deck)}>削除する</button>
        </Sheet>
      )}
      {overlay?.type === 'catalog' && (
        <Sheet title="カード一覧" onClose={closeOverlay}>
          <div className="art-catalog">
            {ROLES.map(role => <CardTile key={role} role={role} onInspect={() => inspect(role)} />)}
          </div>
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
    </main><footer className="wrap footer">◈　人狼デュエル <span>WEREWOLF DUEL</span></footer>
  </>
}
createRoot(document.getElementById('root')!).render(<App/>)
