import { useState } from 'react'
import { audioSettings, saveAudioSettings, type AudioSettings } from './audio.ts'
import { Sheet } from './Sheet.tsx'

export function SoundSettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(audioSettings)
  const update = (change: Partial<AudioSettings>) => {
    const next = { ...settings, ...change }
    saveAudioSettings(next)
    setSettings(next)
  }
  return <Sheet title="音量設定" onClose={onClose}>
    <div className="sound-settings">
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
    </div>
  </Sheet>
}
