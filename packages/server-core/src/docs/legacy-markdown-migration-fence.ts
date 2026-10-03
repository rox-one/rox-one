import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, readdir, open } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export interface LegacyMarkdownInventory {
  /** This inventory cannot authorize adoption, a write, or an acknowledgement. */
  nativeActivationAllowed: false
  recoveryClear: boolean
  historical: Array<{ path: string; phase: 'committed' | 'aborted'; sha256: string }>
  blockers: Array<{ path: string; reason: 'prepared' | 'invalid' | 'unsafe-path' | 'unreadable' }>
}

/** Conservative, read-only inspection. Never invoke the legacy writer's recovery APIs. */
export async function inspectLegacyMarkdownMigration(workspaceRoot: string, options: {
  /** Deterministic filesystem race fixture; never supplied by product input. */
  beforeOpen?: (path: string) => Promise<void>
} = {}): Promise<LegacyMarkdownInventory> {
  const result: LegacyMarkdownInventory = { nativeActivationAllowed: false, recoveryClear: false, historical: [], blockers: [] }
  const root = resolve(workspaceRoot)
  const block = (path: string, reason: LegacyMarkdownInventory['blockers'][number]['reason']) => { result.blockers.push({ path, reason }) }
  let missing = false
  for (const path of [root, join(root, '.rox-docs'), join(root, '.rox-docs', 'commits')]) {
    try {
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) { block(path, 'unsafe-path'); return result }
      if ((stat.mode & 0o444) === 0) { block(path, 'unreadable'); return result }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && path !== root) { missing = true; break }
      block(path, 'unreadable'); return result
    }
  }
  if (missing) { result.recoveryClear = true; return result }
  const stateRoot = join(root, '.rox-docs', 'commits')
  try {
    for (const directory of (await readdir(stateRoot)).sort()) {
      const directoryPath = join(stateRoot, directory)
      const stat = await lstat(directoryPath)
      if (!/^[a-f0-9]{64}$/.test(directory) || stat.isSymbolicLink() || !stat.isDirectory()) { block(directoryPath, 'unsafe-path'); continue }
      if ((stat.mode & 0o444) === 0) { block(directoryPath, 'unreadable'); continue }
      for (const name of (await readdir(directoryPath)).sort()) {
        const path = join(directoryPath, name)
        try {
          const file = await lstat(path)
          if (!/^(?:native-)?[a-f0-9]{64}\.json$/.test(name) || file.isSymbolicLink() || !file.isFile()) { block(path, 'unsafe-path'); continue }
          if ((file.mode & 0o444) === 0) { block(path, 'unreadable'); continue }
          const parents = await Promise.all([root, join(root, '.rox-docs'), stateRoot, directoryPath].map(async parent => ({ parent, stat: await lstat(parent) })))
          if (parents.some(({ stat }) => stat.isSymbolicLink() || !stat.isDirectory())) { block(path, 'unsafe-path'); continue }
          await options.beforeOpen?.(path)
          // No-follow prevents consuming a replacement symlink target. Descriptor
          // identity plus parent identity checks also reject replacement regular files.
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
          let bytes: Buffer
          try {
            const opened = await handle.stat()
            if (!opened.isFile() || opened.dev !== file.dev || opened.ino !== file.ino) { block(path, 'unsafe-path'); continue }
            let unsafe = false
            for (const parent of parents) {
              const current = await lstat(parent.parent)
              if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== parent.stat.dev || current.ino !== parent.stat.ino) unsafe = true
            }
            if (unsafe) { block(path, 'unsafe-path'); continue }
            bytes = await handle.readFile()
          } finally { await handle.close() }
          const value = JSON.parse(bytes.toString('utf8'))
          if (value?.schemaVersion !== 1 || !['prepared', 'committed', 'aborted'].includes(value.phase) ||
            !value.command || typeof value.command !== 'object' || !value.receipt || typeof value.receipt !== 'object' ||
            value.fingerprint !== createHash('sha256').update(JSON.stringify(value.command)).digest('hex')) {
            block(path, 'invalid'); continue
          }
          if (value.phase === 'prepared') { block(path, 'prepared'); continue }
          // Historical means observed bytes, not validated native ownership or a trusted receipt.
          result.historical.push({ path, phase: value.phase, sha256: createHash('sha256').update(bytes).digest('hex') })
        } catch { block(path, 'unreadable') }
      }
    }
  } catch { block(stateRoot, 'unreadable') }
  result.recoveryClear = result.blockers.length === 0
  return result
}
