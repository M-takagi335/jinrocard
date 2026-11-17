import { createContext, useContext } from 'react'

export const OpenSoundSettings = createContext<(() => void) | undefined>(undefined)

export function SoundSettingsButton() {
  const open = useContext(OpenSoundSettings)
  if (!open) return null
  return <button type="button" className="quiet sound-settings-button" aria-label="音量設定"
    aria-haspopup="dialog" title="音量設定" onClick={open}>
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3h4l.6 2.5 1.5.9 2.5-.7 2 3.5-1.8 1.8v2l1.8 1.8-2 3.5-2.5-.7-1.5.9L14 21h-4l-.6-2.5-1.5-.9-2.5.7-2-3.5L5.2 13v-2L3.4 9.2l2-3.5 2.5.7 1.5-.9z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  </button>
}
