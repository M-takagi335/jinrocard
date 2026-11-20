import { useState } from 'react'
import { audioSettings, saveAudioSettings, type AudioSettings } from './audio.ts'
import { Sheet } from './Sheet.tsx'
import { ReleaseHistoryPanel } from './ReleaseHistoryPanel.tsx'
import { hasUnreadHistory, markHistoryRead } from './releaseHistory.ts'
import { MatchStatisticsPanel } from './MatchStatisticsPanel.tsx'

export function SoundSettings({ onClose, showStatistics, showHistory }: { onClose: () => void; showStatistics?: boolean; showHistory?: boolean }) {
  const [settings, setSettings] = useState(audioSettings)
  const [page, setPage] = useState<'settings' | 'statistics' | 'history'>('settings')
  const [unread, setUnread] = useState(hasUnreadHistory)
  const update = (change: Partial<AudioSettings>) => {
    const next = { ...settings, ...change }
    saveAudioSettings(next)
    setSettings(next)
  }
  return <Sheet title={page === 'statistics' ? 'みんなの戦績' : page === 'history' ? '更新履歴' : '音量設定'} className="sound-sheet" onClose={onClose} soundControl={false}
    footer={page !== 'settings' && <button className="quiet" onClick={() => setPage('settings')}>設定に戻る</button>}>
    {page === 'statistics' ? <MatchStatisticsPanel /> : page === 'history' ? <ReleaseHistoryPanel /> : <div className="sound-settings">
      <label><input type="checkbox" checked={settings.musicOn} onChange={event => update({ musicOn: event.target.checked })} /> BGMを再生</label>
      <label>BGM音量 <span>{Math.round(settings.music * 100)}%</span>
        <input type="range" min="0" max="100" value={Math.round(settings.music * 100)}
          onChange={event => update({ music: Number(event.target.value) / 100 })} />
      </label>
      <label><input type="checkbox" checked={settings.effectsOn} onChange={event => update({ effectsOn: event.target.checked })} /> 効果音を再生</label>
      <label>効果音音量 <span>{Math.round(settings.effects * 100)}%</span>
        <input type="range" min="0" max="100" value={Math.round(settings.effects * 100)}
          onChange={event => update({ effects: Number(event.target.value) / 100 })} />
      </label>
      {showStatistics && <button className="quiet" onClick={() => setPage('statistics')}>みんなの戦績</button>}
      {showHistory && <button className="quiet" onClick={() => { markHistoryRead(); setUnread(false); setPage('history') }}>
        更新履歴{unread && <span className="history-unread" aria-label="未読の更新があります" />}
      </button>}
    </div>}
  </Sheet>
}
