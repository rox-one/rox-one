/** Click-split: title/row opens chat; status glyph opens the board card. */

export type SessionRowClickSource = 'row' | 'status'

export function sessionRowClickTarget(source: SessionRowClickSource): 'chat' | 'board' {
  return source === 'status' ? 'board' : 'chat'
}

export function boardCardRoute(sessionId: string): string {
  return `board/session/${sessionId}`
}
