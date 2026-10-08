/**
 * Shadow copy of a browser profile into the staging sandbox.
 *
 * A running browser holds an exclusive lock on `History` / `places.sqlite`
 * (together with their WAL/SHM siblings). Copying a large file with the default
 * 64 KiB stream buffers blocks on some platforms, so every read/write here uses
 * a 1 MiB `highWaterMark`; reads are shared and each file is copied
 * independently, so one unreadable store never aborts the run. Write-ahead-log
 * siblings (`-wal`/`-shm`) AND rollback journals (`-journal`) are copied too:
 * in rollback-journal mode the main file is only consistent together with its
 * hot journal, so a mid-write snapshot without it can look corrupt to the
 * forensic engine. Those siblings are auxiliary and not listed in `files`.
 *
 * Nothing is ever deleted outside the staging root: the resolved per-profile
 * directory is validated against the staging root before any removal.
 */

import { createHash } from 'node:crypto'
import * as nodeFs from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

import { resolveBrowserIntelPaths, stagingDirForProfile } from '../paths.ts'
import type { BrowserIntelPaths } from '../paths.ts'
import { PROFILE_STORE_KINDS } from '../types.ts'
import type { ProfileStoreKind, ScannedBrowserProfile, StagedFile, StagedProfile } from '../types.ts'

/**
 * Auxiliary database siblings copied alongside the main file: SQLite WAL/SHM
 * and the rollback journal. They are required for a consistent recovery view of
 * a mid-write snapshot but are not themselves stores.
 */
const AUXILIARY_SUFFIXES = ['-wal', '-shm', '-journal'] as const
const HIGH_WATER_MARK = 1024 * 1024
const DEFAULT_MAX_BYTES_PER_FILE = 512 * 1024 * 1024

export interface ShadowCopyServiceOptions {
  /** Node fs override (tests drive the stream API with their own implementation). */
  fs?: Partial<typeof nodeFs>
  paths?: BrowserIntelPaths
  /** Overrides `<config>/cache/browser_staging` from {@link paths}. */
  stagingRoot?: string
  maxBytesPerFile?: number
  /** Remove a pre-existing staging directory for the profile id first (default true). */
  replace?: boolean
  now?: () => number
  onProgress?: (file: { kind: ProfileStoreKind; bytes: number }) => void
  /** Receives the same per-file notes as {@link ShadowCopyService.errors}. */
  onError?: (message: string) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Resolve the effective layout, honouring a `stagingRoot` override. */
function effectivePaths(options: ShadowCopyServiceOptions): BrowserIntelPaths {
  const paths = options.paths ?? resolveBrowserIntelPaths()
  const stagingRoot = options.stagingRoot
  return stagingRoot === undefined ? paths : { ...paths, stagingDir: stagingRoot }
}

/** Copy one file with a large high-water mark; resolves with the byte count. */
function copyStream(
  io: typeof nodeFs,
  source: string,
  dest: string,
  highWaterMark: number,
): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  const read = io.createReadStream(source, { highWaterMark })
  const write = io.createWriteStream(dest, { highWaterMark })
  let bytes = 0
  read.on('data', (chunk) => {
    bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
  })
  read.on('error', reject)
  write.on('error', reject)
  write.on('finish', () => resolve(bytes))
  read.pipe(write)
  return promise
}

function sha256File(io: typeof nodeFs, path: string, highWaterMark: number): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const hash = createHash('sha256')
  const read = io.createReadStream(path, { highWaterMark })
  read.on('data', (chunk) => hash.update(chunk))
  read.on('error', reject)
  read.on('end', () => resolve(hash.digest('hex')))
  return promise
}

export class ShadowCopyService {
  /** Per-file notes (too-large, unreadable, failed sibling copy). */
  readonly errors: string[] = []
  private readonly options: ShadowCopyServiceOptions
  private readonly io: typeof nodeFs
  private readonly paths: BrowserIntelPaths
  private readonly now: () => number

  constructor(options: ShadowCopyServiceOptions = {}) {
    this.options = options
    this.io = { ...nodeFs, ...options.fs } as typeof nodeFs
    this.paths = effectivePaths(options)
    this.now = options.now ?? (() => Date.now())
  }

  async copyProfile(profile: ScannedBrowserProfile): Promise<StagedProfile> {
    const io = this.io
    const stagingRoot = this.paths.stagingDir
    const stagingDir = stagingDirForProfile(this.paths, profile.profileId)
    const startedAt = this.now()
    const maxBytesPerFile = this.options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE

    if (!isInside(stagingRoot, stagingDir)) {
      throw new Error(`staging directory escapes its root: ${stagingDir}`)
    }
    if (this.options.replace !== false) {
      io.rmSync(stagingDir, { recursive: true, force: true })
    }
    io.mkdirSync(stagingDir, { recursive: true })

    const files: StagedFile[] = []
    const missing: ProfileStoreKind[] = []
    const note = (message: string): void => {
      this.errors.push(message)
      this.options.onError?.(message)
    }

    for (const kind of PROFILE_STORE_KINDS) {
      const source = profile.stores[kind]
      if (!source) {
        missing.push(kind)
        continue
      }
      let stat: Stats
      try {
        stat = io.statSync(source)
      } catch {
        missing.push(kind)
        continue
      }
      if (!stat.isFile()) {
        missing.push(kind)
        continue
      }
      if (stat.size > maxBytesPerFile) {
        note(`${profile.profileId} ${kind} skipped: ${stat.size} bytes exceeds maxBytesPerFile ${maxBytesPerFile}`)
        missing.push(kind)
        continue
      }

      const stagedPath = join(stagingDir, basename(source))
      try {
        await copyStream(io, source, stagedPath, HIGH_WATER_MARK)
        for (const suffix of AUXILIARY_SUFFIXES) {
          const sibling = `${source}${suffix}`
          if (!io.existsSync(sibling)) continue
          try {
            await copyStream(io, sibling, join(stagingDir, `${basename(source)}${suffix}`), HIGH_WATER_MARK)
          } catch (error) {
            note(`${profile.profileId} ${kind}${suffix}: ${errorMessage(error)}`)
          }
        }
        const bytes = io.statSync(stagedPath).size
        const sha256 = await sha256File(io, stagedPath, HIGH_WATER_MARK)
        files.push({ kind, sourcePath: source, stagedPath, bytes, sha256, mtimeMs: stat.mtimeMs })
        this.options.onProgress?.({ kind, bytes })
      } catch (error) {
        note(`${profile.profileId} ${kind}: ${errorMessage(error)}`)
        missing.push(kind)
      }
    }

    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
    return {
      profileId: profile.profileId,
      vendor: profile.vendor,
      family: profile.family,
      stagingDir,
      stagedAt: this.now(),
      files,
      missing,
      totalBytes,
      copiedInMs: this.now() - startedAt,
    }
  }

  cleanupStagingDir(profileId: string): boolean {
    return cleanupStagingDir(this.paths, profileId)
  }

  cleanupAllStaging(): number {
    return cleanupAllStaging(this.paths)
  }

  stagingBytes(): number {
    return stagingBytes(this.paths)
  }
}

/** Convenience wrapper: copy one profile with a throwaway service. */
export async function shadowCopyProfile(
  profile: ScannedBrowserProfile,
  options: ShadowCopyServiceOptions = {},
): Promise<StagedProfile> {
  return new ShadowCopyService(options).copyProfile(profile)
}

/**
 * Remove one profile's staging directory.
 *
 * Returns false (and removes nothing) when the resolved directory is not inside
 * the staging root.
 */
export function cleanupStagingDir(paths: BrowserIntelPaths, profileId: string): boolean {
  const stagingDir = stagingDirForProfile(paths, profileId)
  if (!isInside(paths.stagingDir, stagingDir)) return false
  try {
    nodeFs.rmSync(stagingDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** Remove every profile directory under the staging root; returns the count. */
export function cleanupAllStaging(paths: BrowserIntelPaths): number {
  let removed = 0
  let entries: Dirent[]
  try {
    entries = nodeFs.readdirSync(paths.stagingDir, { withFileTypes: true })
  } catch {
    return removed
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      nodeFs.rmSync(join(paths.stagingDir, entry.name), { recursive: true, force: true })
      removed += 1
    } catch {
      /* best-effort cleanup */
    }
  }
  return removed
}

/** Total bytes currently held under the staging root. */
export function stagingBytes(paths: BrowserIntelPaths): number {
  let total = 0
  const walk = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = nodeFs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      try {
        total += nodeFs.statSync(full).size
      } catch {
        /* file raced away between readdir and stat */
      }
    }
  }
  walk(paths.stagingDir)
  return total
}