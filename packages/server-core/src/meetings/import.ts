import { createHash } from 'node:crypto'

export type ImportedMedia = {
  workspaceId: string
  hash: string
  bytes: number
  durationMs: number
  meetingId: string
}

export function importMeetingMedia(input: {
  workspaceId: string
  bytes: Uint8Array
  existing: readonly ImportedMedia[]
  maxBytes?: number
  mimeType?: string
}): { status: 'ok' | 'duplicate' | 'rejected'; item?: ImportedMedia; reason?: string } {
  if (input.bytes.byteLength === 0) return { status: 'rejected', reason: 'empty' }
  if (input.maxBytes != null && input.bytes.byteLength > input.maxBytes) {
    return { status: 'rejected', reason: 'too-large' }
  }
  if (input.mimeType && !input.mimeType.startsWith('audio/')) {
    return { status: 'rejected', reason: 'bad-format' }
  }
  const hash = createHash('sha256').update(input.bytes).digest('hex')
  const found = input.existing.find((item) => item.workspaceId === input.workspaceId && item.hash === hash)
  if (found) return { status: 'duplicate', item: found }
  return {
    status: 'ok',
    item: {
      workspaceId: input.workspaceId,
      hash,
      bytes: input.bytes.byteLength,
      durationMs: Math.max(1, Math.round(input.bytes.byteLength / 32)),
      meetingId: `import-${hash.slice(0, 8)}`,
    },
  }
}
