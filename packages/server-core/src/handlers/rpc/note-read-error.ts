import { CodedError } from '@rox/shared/protocol'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/** Same existing-parent/symlink guard used by the native Markdown policy.
 * Missing folders are ordinary absence; an unavailable root, corrupt folder or
 * junction is not. This read-only check never creates a source or a directory.
 */
export async function assertNoteReadPath(notesRoot: string, path: string): Promise<void> {
  const root = resolve(notesRoot)
  const candidate = resolve(path)
  if (!candidate.startsWith(root + sep)) throw new CodedError('AUTH_FAILED', 'Document access denied')
  const source = await lstat(root)
  if (source.isSymbolicLink() || await realpath(root) !== root) throw new CodedError('AUTH_FAILED', 'Document symlink access denied')
  if (!source.isDirectory()) throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Notes source is no longer a directory')
  const components: string[] = []
  for (let current = candidate; current !== root; current = dirname(current)) components.unshift(current)
  // Check ancestors first: lstat(child) otherwise reports ENOTDIR before we
  // can identify a corrupt parent as an authority change.
  for (const current of components) {
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink() || await realpath(current) !== current) throw new CodedError('AUTH_FAILED', 'Document symlink access denied')
      if (current === candidate ? !entry.isFile() : !entry.isDirectory()) throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Note source path has an unexpected file type')
    } catch (error) {
      // Only absence of this exact component is permitted. Still walk every
      // ancestor so a missing child cannot hide a file or an escaping junction.
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
        && 'path' in error && error.path === current)) throw error
    }
  }
}

/** Translate only absence of the requested note, never a root/journal/index failure. */
export async function readNoteTarget<T>(notesRoot: string, path: string, read: () => Promise<T>): Promise<T> {
  try { return await read() }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
      && 'path' in error && error.path === path) {
      await assertNoteReadPath(notesRoot, path)
      throw new CodedError('NOT_FOUND', 'Note no longer exists')
    }
    throw error
  }
}
