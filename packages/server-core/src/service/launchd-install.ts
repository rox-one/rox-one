/**
 * Transactional launchd install/uninstall.
 *
 * Publishing a LaunchAgent is not atomic across three files (plist + 0600 env
 * file + 0700 wrapper): a crash between writes would leave a half-configured
 * agent that launchd happily starts. So the install snapshots every artifact,
 * publishes the new bytes, and on ANY failure restores the exact prior state
 * (or removes what did not exist) before surfacing a typed error.
 *
 * The filesystem is injected so the publish/rollback path is exercised without
 * touching the real `~/Library/LaunchAgents`.
 */

import { ServiceOperationError } from './types.ts'

export interface ServiceArtifact {
  readonly path: string
  readonly content: string
  readonly mode: number
}

export interface ServiceFilesystem {
  /** Exact bytes, or null when the path does not exist. */
  readFile(path: string): Promise<string | null>
  /** Mode bits (e.g. 0o600), or null when the path does not exist. */
  statMode(path: string): Promise<number | null>
  writeFile(path: string, content: string, mode: number): Promise<void>
  mkdir(path: string, mode: number): Promise<void>
  unlink(path: string): Promise<void>
}

interface SnapshotEntry {
  readonly path: string
  readonly existed: boolean
  readonly content: string | null
  readonly mode: number | null
}

async function captureSnapshot(fs: ServiceFilesystem, paths: readonly string[]): Promise<readonly SnapshotEntry[]> {
  const entries: SnapshotEntry[] = []
  for (const path of paths) {
    const content = await fs.readFile(path)
    entries.push({
      path,
      existed: content !== null,
      content,
      mode: content === null ? null : await fs.statMode(path),
    })
  }
  return entries
}

async function restoreSnapshot(fs: ServiceFilesystem, snapshot: readonly SnapshotEntry[]): Promise<void> {
  for (const entry of snapshot) {
    try {
      if (entry.existed) {
        await fs.writeFile(entry.path, entry.content ?? '', entry.mode ?? 0o600)
      } else {
        await fs.unlink(entry.path)
      }
    } catch {
      // Best-effort restore: keep restoring the remaining artifacts so a single
      // stubborn path cannot leave the rest of the service half-published.
    }
  }
}

/**
 * Publish artifacts transactionally: snapshot, write, roll back on failure.
 * `directories` are created 0700 before any write.
 */
export async function installServiceArtifacts(input: {
  readonly artifacts: readonly ServiceArtifact[]
  readonly directories: readonly string[]
  readonly fs: ServiceFilesystem
}): Promise<void> {
  const { artifacts, directories, fs } = input
  const snapshot = await captureSnapshot(fs, artifacts.map(artifact => artifact.path))
  try {
    for (const directory of directories) await fs.mkdir(directory, 0o700)
    for (const artifact of artifacts) await fs.writeFile(artifact.path, artifact.content, artifact.mode)
  } catch (error) {
    await restoreSnapshot(fs, snapshot)
    if (error instanceof ServiceOperationError) throw error
    throw new ServiceOperationError('INSTALL_FAILED')
  }
}

/** Remove artifacts transactionally, restoring them if any unlink fails. */
export async function removeServiceArtifacts(input: {
  readonly paths: readonly string[]
  readonly fs: ServiceFilesystem
}): Promise<void> {
  const { paths, fs } = input
  const snapshot = await captureSnapshot(fs, paths)
  try {
    for (const path of paths) {
      if (await fs.readFile(path) !== null) await fs.unlink(path)
    }
  } catch (error) {
    await restoreSnapshot(fs, snapshot)
    if (error instanceof ServiceOperationError) throw error
    throw new ServiceOperationError('UNINSTALL_FAILED')
  }
}