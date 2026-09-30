/** A write command carries preconditions, never an asserted authorization grant. */
export interface MarkdownCommitCommand {
  workspaceId: string
  noteId: string
  expectedRevision: string
  authorityEpoch: number
  /** Expected owner store; native RPC requires the server-issued binding. */
  sourceStoreId?: string
  operationId: string
  content: string
}

export type MarkdownCommitErrorKind = 'validation' | 'conflict' | 'denied' | 'deleted' | 'rateLimited' | 'unknownFormat'

export class MarkdownCommitError extends Error {
  constructor(readonly kind: MarkdownCommitErrorKind, message: string, readonly currentRevision?: string) {
    super(message)
    this.name = 'MarkdownCommitError'
  }
}

export function decodeMarkdownCommitCommand(value: unknown): MarkdownCommitCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarkdownCommitError('validation', 'Invalid document command')
  const raw = value as Record<string, unknown>
  for (const key of ['workspaceId', 'noteId', 'operationId']) {
    if (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].length > 512 || raw[key].includes('\0')) {
      throw new MarkdownCommitError('validation', `Invalid ${key}`)
    }
  }
  if (typeof raw.expectedRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(raw.expectedRevision)) {
    throw new MarkdownCommitError('validation', 'A document revision is required')
  }
  if (!Number.isSafeInteger(raw.authorityEpoch) || Number(raw.authorityEpoch) < 1) throw new MarkdownCommitError('validation', 'Invalid authority epoch')
  if (typeof raw.content !== 'string' || Array.from(raw.content).some(char => { const point = char.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff }) || new TextEncoder().encode(raw.content).length > 16 * 1024 * 1024) {
    throw new MarkdownCommitError('validation', 'Invalid or oversized Markdown content')
  }
  if (raw.sourceStoreId !== undefined && (typeof raw.sourceStoreId !== 'string' || !raw.sourceStoreId || raw.sourceStoreId.length > 512 || raw.sourceStoreId.includes('\0'))) {
    throw new MarkdownCommitError('validation', 'Invalid source store binding')
  }
  return {
    workspaceId: raw.workspaceId as string, noteId: raw.noteId as string,
    expectedRevision: raw.expectedRevision, authorityEpoch: raw.authorityEpoch as number,
    operationId: raw.operationId as string, content: raw.content,
    ...(raw.sourceStoreId === undefined ? {} : { sourceStoreId: raw.sourceStoreId as string }),
  }
}
