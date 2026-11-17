import { useReducer, useState } from 'react'
import { card, RULES, type Role } from './cards.ts'
import { CardDetail } from './CardDetail.tsx'
import { CardTile } from './CardTile.tsx'
import type { Instance } from './duel.ts'
import { canConfirmTutorial, createTutorialDuel, guidedRoles, lockTutorialNight } from './tutorial.ts'

const lessons = [
  ['人狼を選ぶ', '初期HPは20。手札の人狼を選び、カードを確定しましょう。'],
  ['同時公開', 'カードは伏せて出します。両者が確定すると同時に公開され、効果を処理します。'],
  ['狩人で防ぐ', '毎夜の開始時に1枚引きます。今夜は狩人を出し、相手の襲撃を防ぎましょう。'],
  ['魔女で回復する', '1夜に1〜2枚を出せます。魔女と人狼を選び、襲撃と回復を試しましょう。'],
  ['占い師で調べる', '占い師を出すと、相手の残り手札から1枚を自分だけが確認できます。'],
  ['自分で1夜プレイ', '今度は自由に1〜2枚を選びましょう。HPが0になると負け。第15夜の終了時はHPの多い方が勝ちます。'],
] as const

export function Tutorial({ onHome }: { onHome: () => void }) {
  const [duel] = useState(createTutorialDuel)
  const [selected, setSelected] = useState<number[]>([])
  const [detail, setDetail] = useState<Role>()
  const [complete, setComplete] = useState(false)
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  const selecting = duel.phase === 'select'
  const revealed = duel.phase === 'reveal'
  const step = duel.night === 1 ? Number(!selecting) : duel.night
  const required = guidedRoles(duel.night)
  const plays = selected.map(id => ({ id }))
  const [title, instruction] = lessons[step]
  const results = duel.log.filter(entry => entry.night === duel.night && entry.privateTo === undefined &&
    !entry.text.includes('を使用した') && !entry.text.includes('夜が始まった') && !entry.text.includes('枚引いた'))
  const investigation = duel.investigationsFor(0).find(record => record.night === duel.night)

  function toggle(entry: Instance) {
    setSelected(previous => previous.includes(entry.id) ? previous.filter(id => id !== entry.id)
      : previous.length < duel.max(0) ? [...previous, entry.id] : previous)
  }

  function confirm() {
    if (!lockTutorialNight(duel, plays)) return
    if (duel.night > 1) duel.resolve()
    setSelected([])
    refresh()
  }

  return <section className="tutorial">
    <div className="section-title battle-title">
      <h1>チュートリアル</h1>
      {!complete && <button className="quiet" onClick={onHome}>ホームへ戻る</button>}
    </div>
    {complete ? <section className="panel result">
      <h2>チュートリアル完了</h2>
      <p>襲撃、防御、回復、調査を体験しました。</p>
      <button className="primary" onClick={onHome}>ホームへ戻る</button>
    </section> : <>
      <section className="panel tutorial-guide" aria-live="polite">
        <p className="eyebrow">手順 {step + 1} / {lessons.length} · 第{duel.night}夜</p>
        <h2>{title}</h2>
        <p>{instruction}</p>
        {duel.night === 4 && <p>夜終了時に手札が2枚未満なら2枚まで補充します。山札がなくなったら捨て札を使い直します。</p>}
      </section>
      <div className="fighters">
        {duel.players.map((player, side) => {
          const name = side === 0 ? 'あなた' : '練習相手'
          return <section className={'panel fighter side' + side} key={name}>
            <div className="fighter-line"><strong>{name}</strong><span><b>{player.hp}</b> / {RULES.hp} HP</span></div>
            <progress aria-label={name + 'のHP'} value={player.hp} max={RULES.hp} />
            <div className="stats">山札 {player.deck.length}　手札 {player.hand.length}</div>
          </section>
        })}
      </div>
      <section className="panel play-area">
        {selecting ? <>
          <div className="hand-heading"><h2>手札を選択</h2><span>{selected.length} / {duel.max(0)} 枚</span></div>
          <div className={'duel-cards hand-cards' + (required ? ' tutorial-guided' : '')} aria-label="手札">
            {duel.players[0].hand.map(entry => {
              const allowed = !required || required.includes(entry.role)
              return <CardTile compact key={entry.id} role={entry.role} selected={selected.includes(entry.id)}
                onInspect={() => setDetail(entry.role)} onClick={allowed ? () => toggle(entry) : undefined} />
            })}
          </div>
          <button className="primary action tutorial-action" disabled={!canConfirmTutorial(duel, plays)} onClick={confirm}>選択を確定</button>
        </> : <>
          <div className="reveal" aria-label="同時公開">
            <h2>同時公開</h2>
            <div className="reveal-columns">{duel.revealed.map((cards, side) => (
              <div key={side}><h3>{side === 0 ? 'あなた' : '練習相手'}</h3>
                <div className="duel-cards">{cards.map(entry => <CardTile compact role={entry.role} key={entry.id}
                  disabled={entry.disabled} onInspect={() => setDetail(entry.role)} />)}</div>
              </div>
            ))}</div>
          </div>
          {results.length > 0 && <ul className="log" aria-label="今夜の結果">{results.map((entry, index) =>
            <li key={index}>{entry.text.replace('プレイヤー', 'あなた').replace('NPC', '練習相手')}</li>)}</ul>}
          {investigation && <p className="tutorial-investigation">調査結果（自分のみ）　{investigation.cards.map(entry => card(entry.role).name).join('、')}</p>}
          {revealed ? <button className="primary action tutorial-action" onClick={() => { duel.resolve(); refresh() }}>カードの効果を見る</button>
            : duel.night === 5 ? <button className="primary action tutorial-action" onClick={() => setComplete(true)}>チュートリアルを完了</button>
              : <button className="primary action tutorial-action" onClick={() => { duel.nextNight(); refresh() }}>次の夜へ</button>}
        </>}
      </section>
    </>}
    {detail && <CardDetail role={detail} onClose={() => setDetail(undefined)} />}
  </section>
}
