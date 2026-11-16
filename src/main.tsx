import { useEffect, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { card, CATEGORY, NPC_DECK, ROLES, RULES, STARTER, validDeck, type Role } from './cards.ts'
import { Duel, type Instance, type Play, type Side } from './duel.ts'
import { deckNameLimit, exportDeck, importDeck, loadSavedDecks, storeSavedDecks, type NamedDeck, type SavedDeck } from './decks.ts'
import { CardTile } from './CardTile.tsx'
import { DeckViewer } from './DeckViewer.tsx'
import { InvestigationPanel } from './InvestigationPanel.tsx'
import { DeckGenerator } from './DeckGenerator.tsx'
import { DECK_TYPES, PROFILES, generateDeck, type DeckType } from './generateDeck.ts'
import { DeckComposition, Sheet } from './Sheet.tsx'
import './style.css'

function loadDeck():Role[] {
  try { const data:unknown=JSON.parse(localStorage.getItem('jinro-deck')??'null'); if(Array.isArray(data) && data.length<=RULES.deckSize && data.every(r=>ROLES.includes(r)) && ROLES.every(r=>data.filter(x=>x===r).length<=card(r).limit))return data } catch { /* storage unavailable */ }
  return [...STARTER]
}
function newDeckId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
    byte.toString(16).padStart(2, '0')).join('')
}

function readLibrary(): SavedDeck[] {
  try {
    return loadSavedDecks(localStorage)
  } catch {
    return []
  }
}

type Overlay = { type: 'start' | 'generate' | 'investigations' } | { type: 'deck'; side: Side } | { type: 'guess'; id: number } | { type: 'delete'; deck: SavedDeck }

function App() {
  const [deck,setDeck]=useState(loadDeck)
  const [saved, setSaved] = useState(readLibrary)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [battleDeck, setBattleDeck] = useState<Role[]>([])
  const [battleEnemy, setBattleEnemy] = useState<Role[]>([])
  const [npcType, setNpcType] = useState<DeckType | 'default'>('default')
  const [matchError, setMatchError] = useState('')
  const [filter,setFilter]=useState<string>('all')
  const [duel,setDuel]=useState<Duel|null>(null)
  const insightCue = useRef<HTMLParagraphElement>(null)
  const [readCount, setReadCount] = useState(0)
  const [showInvestigation, setShowInvestigation] = useState(false)
  const [plays,setPlays]=useState<Play[]>([])
  const [tab,setTab]=useState<'log'|'self'|'enemy'>('log')
  const [rules,setRules]=useState(false)
  const [,refresh]=useReducer((n:number)=>n+1,0)
  useEffect(()=>{try{localStorage.setItem('jinro-deck',JSON.stringify(deck))}catch{/* unavailable */}},[deck])
  const phase=duel?.phase, night=duel?.night
  useEffect(()=>{
    if(!duel||phase!=='reveal')return
    const timer=window.setTimeout(()=>{duel.resolve();refresh()},550)
    return ()=>window.clearTimeout(timer)
  },[duel,phase,night])
  const investigations = duel?.investigationsFor(0) ?? []
  const pending = investigations[readCount]
  const pendingSource = pending?.sourceId
  useEffect(() => {
    if (pendingSource === undefined) {
      setShowInvestigation(false)
      return
    }
    setOverlay(null)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShowInvestigation(true)
      return
    }
    insightCue.current?.scrollIntoView({ block: 'nearest' })
    const timer = window.setTimeout(() => setShowInvestigation(true), 450)
    return () => window.clearTimeout(timer)
  }, [duel, readCount, pendingSource])

  const closeOverlay = () => setOverlay(null)
  const start = (cards: Role[], enemy = NPC_DECK) => {
    if (!validDeck(cards)) return
    setReadCount(0)
    setShowInvestigation(false)
    setBattleDeck([...cards])
    setBattleEnemy([...enemy])
    setMatchError('')
    setPlays([])
    setTab('log')
    setDuel(new Duel(cards, enemy))
    closeOverlay()
    window.scrollTo(0, 0)
  }
  const startPrepared = (cards: Role[]) => {
    try {
      start(cards, npcType === 'default' ? NPC_DECK : generateDeck(npcType))
    } catch (failure) {
      setMatchError(failure instanceof Error ? failure.message : '対戦を開始できませんでした。')
    }
  }
  const persist = (update: (current: SavedDeck[]) => SavedDeck[], message: string) => {
    try {
      const next = update(loadSavedDecks(localStorage))
      storeSavedDecks(localStorage, next)
      setSaved(next)
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
    requestAnimationFrame(() => document.getElementById('deck-name')?.focus())
  }
  const saveDeck = () => {
    if (!validDeck(deck) || !name.trim()) return
    const entry = { id: editingId ?? newDeckId(), name: name.trim(), cards: [...deck] }
    if (persist(current => current.some(item => item.id === entry.id)
      ? current.map(item => item.id === entry.id ? entry : item)
      : [...current, entry], '「' + entry.name + '」を保存しました。')) editDeck(entry)
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
  return <>
    <header className="top"><div className="wrap top-inner"><span className="brand"><span className="sigil">◈</span> 人狼デュエル</span><span className="top-caption">WEREWOLF DUEL</span><button className="quiet" aria-expanded={rules} onClick={()=>setRules(v=>!v)}>{rules?'ルールを閉じる':'遊び方'}</button></div></header>
    <main className="wrap">
      {rules&&<section className="panel guide"><h2>遊び方</h2><p>20枚のデッキでNPCと対戦します。初期HPは20、初期手札は5枚。毎夜1枚引き、手札から1～2枚を選んで確定すると、双方のカードが同時に公開されます。</p><p>妨害、防御、攻撃・反撃、勝敗判定、回復、ドロー・回収の順に処理します。夜の終了時、手札が{RULES.handRefill}枚未満なら{RULES.handRefill}枚まで補充します。手札の上限は7枚。山札が空なら捨て札を混ぜて引きます。</p><p>先にHPが0になった側が敗北。同時に0なら引き分け。第15夜の効果をすべて処理しても双方が生き残っていれば、HPが多い側の勝利です。</p></section>}
      {!duel ? <>
        <section className="hero"><div className="moon" aria-hidden="true"/><div className="hero-copy"><div className="eyebrow">✦　月夜の決闘</div><h1>人狼デュエル</h1><p>役職を選び、相手の手を読む。<br/>十五夜のうちに、決着をつけろ。</p><button className="primary" disabled={!validDeck(deck) && !saved.length} onClick={() => { setMatchError(''); setOverlay({ type: 'start' }) }}>NPC戦を開始 <span aria-hidden="true">→</span></button></div><div className="hero-index" aria-hidden="true">Ⅰ <span>／</span> ⅩⅤ</div></section>
        <section className="builder">
          <div className="section-title"><div><div className="eyebrow">01 / DECK BUILDER</div><h2>デッキ構築</h2></div><div className={'count '+(validDeck(deck)?'ready':'')}><strong>{deck.length}</strong> / {RULES.deckSize} 枚</div></div>
          <section className="panel deck-library" aria-label="デッキ管理">
            <button className="primary generator-launch" aria-haspopup="dialog" onClick={() => setOverlay({ type: 'generate' })}>おまかせ作成</button>
            <div className="deck-editor">
              <label htmlFor="deck-name">デッキ名</label>
              <input id="deck-name" value={name} maxLength={deckNameLimit} placeholder="例：月夜の狩人" onChange={event => setName(event.target.value)} />
              <button className="primary" disabled={!validDeck(deck) || !name.trim()} onClick={saveDeck}>
                {editingId ? '変更を保存' : 'デッキを保存'}
              </button>
              <button className="quiet" onClick={() => { setEditingId(null); setName(''); setDeck([]); setNotice('') }}>新規デッキ</button>
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
            {notice && <p className="notice" role="status">{notice}</p>}
            {saved.length ? (
              <ul className="saved-decks">
                {saved.map(entry => (
                  <li key={entry.id}>
                    <strong>{entry.name}{editingId === entry.id && <small>編集中</small>}</strong>
                    <div className="deck-tools">
                      <button className="quiet" onClick={() => { editDeck(entry); setNotice('') }}>編集</button>
                      <button className="quiet" onClick={() => duplicateDeck(entry)}>複製</button>
                      <button className="quiet" onClick={() => downloadDeck(entry)}>JSON出力</button>
                      <button className="quiet" onClick={() => setOverlay({ type: 'delete', deck: entry })}>削除</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">保存済みのデッキはありません。</p>}
          </section>
          <div className="controls"><div className="filters" aria-label="カード分類">{[['all','すべて'],...Object.entries(CATEGORY)].map(([key,label])=><button key={key} className={filter===key?'active':''} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div><div className="deck-tools"><button className="quiet" onClick={()=>setDeck([...STARTER])}>初期デッキに戻す</button><button className="quiet" disabled={!deck.length} onClick={()=>setDeck([])}>空にする</button></div></div>
          <p className="hint">カードの下の ＋ / − で投入枚数を変更。20枚揃えると対戦できます。</p>
          <div className="catalog">{ROLES.filter(r=>filter==='all'||card(r).category===filter).map(r=><article className="deck-item" key={r}><CardTile role={r}/><div className="quantity"><button aria-label={card(r).name+'を減らす'} disabled={!tally(r)} onClick={()=>setDeck(d=>{const copy=[...d];copy.splice(copy.indexOf(r),1);return copy})}>−</button><span>{tally(r)} <small>/ {card(r).limit}</small></span><button aria-label={card(r).name+'を増やす'} disabled={deck.length>=RULES.deckSize||tally(r)>=card(r).limit} onClick={()=>setDeck(d=>[...d,r])}>＋</button></div></article>)}</div>
        </section>
      </>:<>
        <div className="section-title battle-title"><div><div className="eyebrow">02 / THE DUEL</div><h1>第{duel.night}夜 <small>/ {duel.rules.finalNight}</small></h1></div><button className="quiet" disabled={!!pending} onClick={home}>{phase==='finished'?'デッキに戻る':'対戦を終了して戻る'}</button></div>
        <div className="fighters">{([0,1] as Side[]).map(i=>{const p=duel.players[i];return <div className={'panel fighter side'+i} key={i}><div className="fighter-line"><strong>{i===0?'あなた':'NPC'}</strong><span><b>{p.hp}</b> / {duel.rules.hp} HP</span></div><progress value={p.hp} max={duel.rules.hp} aria-label={(i===0?'あなた':'NPC')+'のHP'}/><div className="stats">山札 {p.deck.length}　手札 {p.hand.length}　捨て札 {p.discard.length}</div><div className="status">{p.status.noHeal&&<span>回復無効</span>}{p.status.limited&&<span>使用は1枚まで</span>}</div></div>})}</div>
        <div className="battle-tools">
          <button className="quiet" aria-haspopup="dialog" disabled={!!pending} onClick={() => setOverlay({ type: 'deck', side: 0 })}>自分のデッキ</button>
          <button className="quiet" aria-haspopup="dialog" disabled={!!pending} onClick={() => setOverlay({ type: 'deck', side: 1 })}>相手のデッキ</button>
          <button className="quiet" aria-haspopup="dialog" disabled={!!pending} onClick={() => setOverlay({ type: 'investigations' })}>調査記録</button>
        </div>
        <div className="battle-layout"><section className="panel play-area">
          {pending && !showInvestigation && <p ref={insightCue} className="insight-cue" role="status">{pending.kind === 'seer' ? '占い師が相手の手札を透視！' : '預言者が相手の山札を透視！'}</p>}
          {duel.revealed.some(row=>row.length>0)&&<div className={'reveal '+(phase==='reveal'?'flipping':'')} aria-label="同時公開"><div className="eyebrow">✦　同時公開</div><div className="reveal-columns">{duel.revealed.map((row,i)=><div key={i}><h3>{i===0?'あなた':'NPC'}</h3><div className="duel-cards">{row.map(c=><CardTile role={c.role} key={c.id} glowing={i===0 && pending?.kind===c.role && pending.sourceId===c.id && !showInvestigation} disabled={c.disabled} detail={c.disabled?'効果無効':c.guess?'予想：'+card(c.guess).name:undefined}/>)}{!row.length&&<p>パス</p>}</div></div>)}</div></div>}
          {phase==='select'&&<><div className="hand-heading"><h2>手札を選択</h2><span>{plays.length} / {duel.max(0)} 枚</span></div><p className="hint">{duel.players[0].hand.length?'カードを選び、確定すると同時公開します。':'手札がないため、この夜はパスします。'}</p><div className="duel-cards">{duel.players[0].hand.map(c=><CardTile key={c.id} role={c.role} selected={plays.some(p=>p.id===c.id)} onClick={()=>toggle(c)}/>)}</div>
            {plays.filter(p => duel.players[0].hand.find(c => c.id === p.id)?.role === 'assassin').map((p, i) => (
              <div className="prediction" key={p.id}>
                <span>暗殺者 {i + 1} の予想</span>
                <button className="quiet" aria-haspopup="dialog" onClick={() => setOverlay({ type: 'guess', id: p.id })}>
                  {p.guess ? card(p.guess).name + '（変更）' : '役職を選ぶ'}
                </button>
              </div>
            ))}
            <button className="primary action" disabled={(duel.players[0].hand.length>0&&!plays.length)||plays.some(p=>duel.players[0].hand.find(c=>c.id===p.id)?.role==='assassin'&&!p.guess)} onClick={()=>{if(duel.lock(plays)){setPlays([]);refresh()}}}>{duel.players[0].hand.length?'選択を確定':'パスを確定'} →</button></>}

          {!pending && phase==='choice'&&duel.prompt&&<div className="choice"><h2>{duel.prompt.title}</h2><div className="duel-cards">{duel.prompt.options.map(c=><CardTile key={c.id} role={c.role} onClick={()=>{duel.answer(c.id);refresh()}}/>)}</div></div>}
          {!pending && phase==='end'&&<button className="primary action" onClick={()=>{duel.nextNight();refresh()}}>次の夜へ →</button>}
          {!pending && phase==='finished'&&<div className="result" role="status"><div className="eyebrow">✦　決着</div><h2>{duel.winner==='draw'?'引き分け':duel.winner===0?'あなたの勝利':'NPCの勝利'}</h2><p>{duel.reason}　あなた {duel.players[0].hp} HP / NPC {duel.players[1].hp} HP</p><button className="primary" onClick={() => start(battleDeck, battleEnemy)}>同じデッキで再戦 →</button></div>}
        </section><aside className="panel chronicle">
          <h2>対戦記録</h2><div className="filters tabs">{([['log','ログ'],['self','自分の捨て札'],['enemy','NPCの捨て札']] as const).map(([k,name])=><button key={k} className={k===tab?'active':''} aria-pressed={tab===k} onClick={()=>setTab(k)}>{name}</button>)}</div>
          {tab==='log'?<ol className="log" aria-label="対戦ログ">{duel.log.filter(l=>l.privateTo!==1).map((l,i)=><li key={i}><span>第{l.night}夜</span>{l.privateTo===0&&<em>自分のみ</em>}{l.text}</li>).reverse()}</ol>:<div className="discard">{duel.players[tab==='self'?0:1].discard.length?ROLES.map(r=>{const n=duel.players[tab==='self'?0:1].discard.filter(c=>c.role===r).length;return n>0&&<div key={r}><span>{card(r).name}</span><strong>× {n}</strong></div>}):<p className="hint">捨て札はありません。</p>}</div>}
        </aside></div>
      </>}
      {pending && showInvestigation && (
        <InvestigationPanel
          key={readCount}
          records={[pending]}
          onConfirm={() => {
            setShowInvestigation(false)
            setReadCount(count => count + 1)
          }}
        />
      )}
      {overlay?.type === 'investigations' && !pending && (
        <InvestigationPanel records={[...investigations].reverse()} onClose={closeOverlay} />
      )}
      {overlay?.type === 'generate' && (
        <DeckGenerator
          usedNames={saved.map(entry => entry.name)}
          onClose={closeOverlay}
          onUse={entry => start(entry.cards)}
          onEdit={editGenerated}
          onSave={saveGenerated}
        />
      )}
      {overlay?.type === 'start' && (
        <Sheet title="対戦デッキを選択" onClose={closeOverlay}>
          <label className="npc-deck-type">
            NPCのデッキ
            <select value={npcType} onChange={event => {
              setNpcType(event.target.value as DeckType | 'default')
              setMatchError('')
            }}>
              <option value="default">標準デッキ</option>
              {DECK_TYPES.map(type => <option key={type} value={type}>おまかせ・{PROFILES[type].label}</option>)}
            </select>
          </label>
          {matchError && <p className="notice" role="alert">{matchError}</p>}
          <div className="match-decks">
            {validDeck(deck) && <button className="quiet" onClick={() => startPrepared(deck)}>編集中のデッキ{ name.trim() && '：' + name.trim() }</button>}
            {saved.map(entry => <button className="quiet" key={entry.id} onClick={() => startPrepared(entry.cards)}>{entry.name}</button>)}
          </div>
        </Sheet>
      )}
      {overlay?.type === 'deck' && duel && !pending && (
        <DeckViewer
          title={overlay.side === 0 ? '自分のデッキ' : '相手のデッキ'}
          night={duel.night}
          hp={duel.players[overlay.side].hp}
          initial={duel.deckComposition(overlay.side)}
          remaining={duel.remainingComposition(overlay.side)}
          onClose={closeOverlay}
        />
      )}
      {overlay?.type === 'guess' && duel && (
        <Sheet title="暗殺者の予想" onClose={closeOverlay}>
          <p className="hint">相手が今夜出すと思う役職を選んでください。枚数は対戦開始時の投入枚数です。</p>
          <DeckComposition
            entries={duel.deckComposition(1)}
            selected={plays.find(play => play.id === overlay.id)?.guess}
            onSelect={role => {
              setPlays(old => old.map(play => play.id === overlay.id ? { ...play, guess: role } : play))
              closeOverlay()
            }}
          />
        </Sheet>
      )}
      {overlay?.type === 'delete' && (
        <Sheet title="保存したデッキを削除" onClose={closeOverlay}>
          <p>「{overlay.deck.name}」を削除しますか？</p>
          <button className="quiet action" onClick={() => deleteDeck(overlay.deck)}>削除する</button>
        </Sheet>
      )}
    </main><footer className="wrap footer">◈　人狼デュエル <span>WEREWOLF DUEL</span></footer>
  </>
}
createRoot(document.getElementById('root')!).render(<App/>)
