import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const pending = new Map<string, Promise<unknown>>()

/** A disk marker survives restarts, deletion of the welcome chat, and workspace switches. */
export async function ensureFirstSessionWelcome<T extends { id: string }>(
  markerPath: string,
  ports: {
    hasExistingSessions(): boolean
    createWelcome(): Promise<T>
  },
): Promise<T | null> {
  const previous = pending.get(markerPath)
  let release!: () => void
  const lock = new Promise<void>(resolve => { release = resolve })
  pending.set(markerPath, lock)
  await previous

  try {
    try {
      await readFile(markerPath, 'utf8')
      return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    // Existing installations never receive a new setup conversation.
    const session = ports.hasExistingSessions() ? null : await ports.createWelcome()
    await mkdir(dirname(markerPath), { recursive: true })
    const temporaryPath = `${markerPath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify({
      schemaVersion: 1,
      completedAt: Date.now(),
      sessionId: session?.id,
    }), { mode: 0o600 })
    await rename(temporaryPath, markerPath)
    return session
  } finally {
    release()
    if (pending.get(markerPath) === lock) pending.delete(markerPath)
  }
}
