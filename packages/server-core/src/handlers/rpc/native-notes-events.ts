import type { NativeAuthority, NativePrincipal } from '../../authority/native-authority.ts'
import type { NoteChangedPayload } from '@craft-agent/shared/protocol'

const reasons: ReadonlySet<string> = new Set([
  'external', 'save', 'create', 'rename', 'move', 'delete', 'asset', 'properties', 'descriptor',
])

/** Canonical Notes invalidations carry identities, never host paths or private metadata. */
export function projectNativeNotesChanged(
  authority: Pick<NativeAuthority, 'resolveWorkspace' | 'authorize'>,
  args: readonly unknown[], workspaceId: string, principal: NativePrincipal,
): readonly unknown[] | null {
  const workspace = authority.resolveWorkspace(workspaceId)
  if (!workspace || !authority.authorize(principal, workspaceId, 'read', workspace.nativeRoot) ||
      !authority.authorize(principal, workspaceId, 'subscribe', workspace.nativeRoot)) return null
  const input = args[0]
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const payload = input as Record<string, unknown>
  if (payload.workspaceId !== workspaceId ||
      (payload.reason !== undefined && (typeof payload.reason !== 'string' || !reasons.has(payload.reason)))) return null
  const noteId = payload.noteId
  if (noteId !== undefined && (typeof noteId !== 'string' || !noteId || noteId.length > 512 ||
      noteId.startsWith('/') || /^[A-Za-z]:/.test(noteId) || /[\\\x00-\x1f\x7f]/.test(noteId) ||
      noteId.split('/').some(part => !part || part === '.' || part === '..' || /^(credentials|cookies|passkeys)$/i.test(part)))) return null
  const eventId = payload.eventId
  const projected: NoteChangedPayload = { workspaceId }
  if (typeof payload.reason === 'string') projected.reason = payload.reason as NoteChangedPayload['reason']
  if (typeof noteId === 'string') projected.noteId = noteId
  if (typeof eventId === 'string' && eventId.length > 0 && eventId.length <= 512 && !/[\\/\x00-\x1f\x7f]/.test(eventId)) {
    projected.eventId = eventId
  }
  return [projected]
}
