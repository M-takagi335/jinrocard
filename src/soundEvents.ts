export const effects = {
  select: '01_card_select', confirm: '02_card_confirm', reveal: '03_card_reveal',
  damage: '04_attack_damage', defense: '05_defense_counter', heal: '06_healing',
  special: '07_special_magic', night: '08_night_begins', victory: '09_victory', defeat: '10_defeat',
} as const
export type Effect = keyof typeof effects
export type Track = 1 | 2 | 3 | 4
type Result = 'victory' | 'defeat' | 'draw'
type LogEntry = { night: number; text: string }
export type SoundFrame = {
  night: number
  revealed: boolean
  hp: readonly { lost: number; gained: number }[]
  log: readonly LogEntry[]
  result?: Result
}
export function battleTrack(night: number, finished = false): Track {
  return finished ? 4 : night >= 11 ? 3 : 2
}

function resolvedEffects(log: readonly LogEntry[], night: number) {
  let normalDraws = 0
  const active = new Set<Effect>()
  for (const { night: entryNight, text } of log) {
    if (entryNight !== night) continue
    if (/の騎士が\d+ダメージ軽減|の(?:狩人|罠師)が襲撃を防|の猫又が反撃/.test(text)) active.add('defense')
    const draw = text.match(/は(\d+)枚引いた。$/)
    // The engine logs both normal draws first. Later draws are card effects.
    if (draw && (++normalDraws > 2 && Number(draw[1]) > 0)) active.add('special')
    if (/が確認：.+/.test(text) && !text.endsWith('対象なし') ||
      /を無効化した。$|は次の夜に(?:回復できない|1枚までしか出せない)。$|を(?:手札|山札の一番上)に戻した。$/.test(text)) active.add('special')
  }
  return active
}

export function soundCues(frame: SoundFrame): Effect[] {
  const active = resolvedEffects(frame.log, frame.night)
  const cues: Effect[] = ['night']
  if (frame.revealed) cues.push('reveal')
  if (active.has('defense')) cues.push('defense')
  if (frame.hp.some(change => change.lost > 0)) cues.push('damage')
  if (frame.hp.some(change => change.gained > 0)) cues.push('heal')
  if (active.has('special')) cues.push('special')
  if (frame.result === 'victory' || frame.result === 'defeat') cues.push(frame.result)
  return cues
}

export function newSoundCues(
  current: SoundFrame, previous: SoundFrame | undefined, allowInitial: boolean, silent: boolean,
): Effect[] {
  if (silent || !previous && !allowInitial ||
    previous && (current.night < previous.night || current.night > previous.night + 1)) return []
  const played = previous?.night === current.night ? new Set(soundCues(previous)) : new Set<Effect>()
  return soundCues(current).filter(effect => !played.has(effect))
}
