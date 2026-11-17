const roomCodePattern = /^[A-HJ-NP-Z2-9]{10}$/

export function isRoomCode(value: string) {
  return value.length === 10 && roomCodePattern.test(value)
}

export function formatRoomCodeInput(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, '')
}

export async function copyLobbyField(
  kind: 'code' | 'url',
  value: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  fallback: () => boolean,
): Promise<boolean> {
  if (!value || (kind === 'code' && !isRoomCode(value))) return false
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value)
      return true
    } catch {
      // Some browser contexts disable clipboard writes but still allow copying a selection.
    }
  }
  try { return fallback() } catch { return false }
}
