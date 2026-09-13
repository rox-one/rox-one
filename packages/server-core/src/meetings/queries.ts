import type { Meeting } from '@craft-agent/core/meetings'

export type MeetingQueryItem = Meeting & { private?: boolean }

export function queryMeetings(input: {
  items: readonly MeetingQueryItem[]
  workspaceId: string
  readableWorkspaceId: string
  cursor?: string
  limit: number
  query?: string
}): { page: MeetingQueryItem[]; continueCursor: string | null; denied: boolean } {
  if (input.workspaceId !== input.readableWorkspaceId) {
    return { page: [], continueCursor: null, denied: true }
  }
  let rows = input.items.filter((item) => item.workspaceId === input.workspaceId && !item.private)
  if (input.query) {
    const q = input.query.toLowerCase()
    rows = rows.filter((item) => item.title.toLowerCase().includes(q))
  }
  const start = input.cursor ? Number.parseInt(input.cursor, 10) : 0
  if (input.cursor && Number.isNaN(start)) {
    return { page: [], continueCursor: null, denied: false }
  }
  const page = rows.slice(start, start + input.limit)
  const next = start + input.limit
  return {
    page,
    continueCursor: next < rows.length ? String(next) : null,
    denied: false,
  }
}
