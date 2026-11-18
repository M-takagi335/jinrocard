const roomCodePattern = /^[A-HJ-NP-Z2-9]{10}$/
const invitationBaseUrl = 'https://jinroduel.com/'

export function isRoomCode(value: string) {
  return value.length === 10 && roomCodePattern.test(value)
}

export function formatRoomCodeInput(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, '')
}

export function roomInvitationUrl(code: string) {
  if (!isRoomCode(code)) return ''
  const url = new URL(invitationBaseUrl)
  url.searchParams.set('room', code)
  return url.href
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
