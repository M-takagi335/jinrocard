import { useState } from 'react'
import { audioSettings, saveAudioSettings, type AudioSettings } from './audio.ts'
import { Sheet } from './Sheet.tsx'
import { MatchStatisticsPanel } from './MatchStatisticsPanel.tsx'

export function SoundSettings({ onClose, showStatistics }: { onClose: () => void; showStatistics?: boolean }) {
  const [settings, setSettings] = useState(audioSettings)
  const [statistics, setStatistics] = useState(false)
  const update = (change: Partial<AudioSettings>) => {
    const next = { ...settings, ...change }
    saveAudioSettings(next)
    setSettings(next)
  }
  return <Sheet title={statistics ? 'みんなの戦績' : '音量設定'} className="sound-sheet" onClose={onClose} soundControl={false}
    footer={statistics && <button className="quiet" onClick={() => setStatistics(false)}>設定に戻る</button>}>
    {statistics ? <MatchStatisticsPanel /> : <div className="sound-settings">
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
      {showStatistics && <button className="quiet" onClick={() => setStatistics(true)}>みんなの戦績</button>}
    </div>}
  </Sheet>
}
