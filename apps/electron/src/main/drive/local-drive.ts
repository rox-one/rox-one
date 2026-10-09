/**
 * ROX Drive (wave 1) — device-local storage engine.
 *
 * Layout under `<configDir>/drive/`:
 *   index.json                              — single atomically-rewritten index
 *   <workspaceId>/<prefix>/<fileId>         — completed file bytes
 *   <workspaceId>/uploads/<uploadId>/part-N — staged parts for renderer-fed uploads
 *
 * Everything workspace-scoped is derived from the caller-supplied `workspaceId`
 * and validated against the index (folders, files, sessions). The ledger is
 * always recomputed from completed files — never trusted from a counter.
 *
 * Device-backup sessions never ship bytes through the renderer: the walk and
 * the part reads happen here, on the main process.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, type Dirent, type Stats } from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  DRIVE_BACKUP_SOURCE_KINDS,
  DRIVE_DEFAULT_QUOTA_BYTES,
  DRIVE_MAX_PARTS,
  DRIVE_PART_SIZE_BYTES,
  DRIVE_ROOT_FOLDER_ID,
  DRIVE_ROOT_FOLDER_NAME,
  planParts,
  recomputeLedger,
  type DriveBackupSourceKind,
  type DriveFile,
  type DriveFileSource,
  type DriveFolder,
  type DriveListing,
  type DriveQuota,
  type DriveScanResult,
  type DriveUploadSession,
} from '@rox/shared/drive'
import type { DriveService, OpenUploadInput } from '@rox/server-core/handlers'
import { resolveStandardFolderPath } from './backup-sources'

interface DriveIndex {
  version: 1
  workspaces: Record<string, DriveWorkspaceIndex>
}

interface DriveWorkspaceIndex {
  quotaBytes: number
  folders: DriveFolder[]
  files: DriveFile[]
  uploads: DriveUploadSession[]
}

export interface LocalDriveOptions {
  /** `<configDir>/drive`. */
  rootDir: string
  /** User home; the backup source roots resolve against it. */
  homeDir: string
  /** Clock seam for deterministic tests. */
  now?: () => Date
  /** Maximum files a single backup walk will return. */
  scanLimit?: number
}

const DEFAULT_SCAN_LIMIT = 50_000
const MAX_NAME_LENGTH = 255
const INDEX_VERSION = 1 as const

class DriveError extends Error {
  readonly code: string
  readonly data?: unknown
  constructor(code: string, message: string, data?: unknown) {
    super(message)
    this.name = 'DriveError'
    this.code = code
    this.data = data
  }
}

/** Reject a caller-supplied name that could escape its directory. */
function assertSafeName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new DriveError('INVALID_PAYLOAD', 'Invalid name')
  }
  if (name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) {
    throw new DriveError('INVALID_PAYLOAD', 'Invalid name')
  }
  return name
}

function assertSafeId(id: unknown): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new DriveError('INVALID_PAYLOAD', 'Invalid id')
  }
  return id
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Two-character, filesystem-safe shard prefix for a file id. */
function prefixFor(id: string): string {
  return id.slice(0, 2)
}

export function createLocalDrive(options: LocalDriveOptions): DriveService {
  const now = options.now ?? (() => new Date())
  const scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT

  const indexPath = join(options.rootDir, 'index.json')
  const workspaceDir = (workspaceId: string) => join(options.rootDir, assertSafeId(workspaceId))
  const uploadsDir = (workspaceId: string) => join(workspaceDir(workspaceId), 'uploads')

  // ---- index I/O -----------------------------------------------------------

  let cache: DriveIndex | null = null
  // Serializes every mutation; readers reuse the in-memory copy.
  let queue: Promise<unknown> = Promise.resolve()

  function loadIndex(): DriveIndex {
    if (cache) return cache
    if (!existsSync(indexPath)) {
      cache = { version: INDEX_VERSION, workspaces: {} }
      return cache
    }
    try {
      const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as DriveIndex
      if (!parsed || parsed.version !== INDEX_VERSION || typeof parsed.workspaces !== 'object' || parsed.workspaces === null) {
        throw new Error('bad index')
      }
      cache = parsed
      return cache
    } catch (error) {
      // A corrupt index must never be silently replaced: surface a distinct,
      // recoverable error rather than losing the user's catalog. The cache stays
      // null so a repair can retry after the file is fixed.
      throw new DriveError('DRIVE_INDEX_CORRUPT', 'Drive index is unreadable', {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function workspace(index: DriveIndex, workspaceId: string): DriveWorkspaceIndex {
    assertSafeId(workspaceId)
    let entry = index.workspaces[workspaceId]
    if (!entry) {
      entry = {
        quotaBytes: DRIVE_DEFAULT_QUOTA_BYTES,
        folders: [{ id: DRIVE_ROOT_FOLDER_ID, name: DRIVE_ROOT_FOLDER_NAME, parentId: null, createdAt: now().toISOString() }],
        files: [],
        uploads: [],
      }
      index.workspaces[workspaceId] = entry
    }
    return entry
  }

  async function persist(index: DriveIndex): Promise<void> {
    await mkdir(options.rootDir, { recursive: true })
    const tmp = join(options.rootDir, `.index-${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(index, null, 2), { encoding: 'utf8', mode: 0o600 })
    const fd = await open(tmp, 'r')
    try {
      await fd.sync()
    } finally {
      await fd.close()
    }
    await rename(tmp, indexPath)
    try {
      const dir = await open(options.rootDir, 'r')
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
    } catch {
      // Directory fsync is best-effort (unsupported on some platforms).
    }
  }

  /** Run a mutation under the serial lock and persist its result. */
  function mutate<T>(fn: (index: DriveIndex) => T | Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const index = loadIndex()
      const result = await fn(index)
      await persist(index)
      return result
    })
    // Keep the chain alive even when a mutation rejects.
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function cloneSession(session: DriveUploadSession): DriveUploadSession {
    return { ...session, parts: session.parts.map(part => ({ ...part })) }
  }

  // ---- ledger --------------------------------------------------------------

  function computeQuota(entry: DriveWorkspaceIndex): DriveQuota {
    let reservedBytes = 0
    for (const upload of entry.uploads) {
      if (upload.status !== 'open') continue
      for (const part of upload.parts) {
        if (!part.done) reservedBytes += part.sizeBytes
      }
    }
    return recomputeLedger(entry.files.map(file => file.size), entry.quotaBytes, reservedBytes)
  }

  // ---- storage paths -------------------------------------------------------

  function partPath(workspaceId: string, uploadId: string, index: number): string {
    const base = uploadsDir(workspaceId)
    const target = resolve(base, uploadId, `part-${index}`)
    if (relative(base, target).startsWith('..')) throw new DriveError('INVALID_PAYLOAD', 'Invalid part path')
    return target
  }

  function ensureFolder(entry: DriveWorkspaceIndex, folderId: string): void {
    if (!entry.folders.some(folder => folder.id === folderId)) {
      throw new DriveError('DRIVE_FOLDER_NOT_FOUND', 'Folder not found', { folderId })
    }
  }

  // ---- backup sources ------------------------------------------------------

  function backupSourceRoot(kind: DriveBackupSourceKind): string {
    if (!DRIVE_BACKUP_SOURCE_KINDS.includes(kind)) {
      throw new DriveError('INVALID_PAYLOAD', 'Unknown backup source')
    }
    // One canonical table (backup-sources.ts) resolves the platform's user
    // folders — never a home-rooted literal built here (TECH-SPEC §10.1 rule 4).
    return resolveStandardFolderPath(kind, process.platform, options.homeDir)
  }

  /** Resolve a backup file's absolute path, guarding against escape. */
  function resolveBackupPath(kind: DriveBackupSourceKind, relativePath: string): string {
    if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.startsWith('/')) {
      throw new DriveError('INVALID_PAYLOAD', 'Invalid source path')
    }
    const root = backupSourceRoot(kind)
    const target = resolve(root, relativePath)
    if (relative(root, target).startsWith('..')) throw new DriveError('INVALID_PAYLOAD', 'Source path escapes root')
    return target
  }

  /** Bounded recursive walk; symlinked entries are skipped, never followed. */
  function walk(root: string): { files: Array<{ name: string; relativePath: string; size: number }>; skippedSymlinks: number; truncated: boolean } {
    const files: Array<{ name: string; relativePath: string; size: number }> = []
    let skippedSymlinks = 0
    let truncated = false
    const stack: string[] = ['']

    const pushChildren = (relDir: string): void => {
      const absDir = relDir ? join(root, relDir) : root
      let entries: Dirent[]
      try {
        entries = readdirSync(absDir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (files.length >= scanLimit) {
          truncated = true
          return
        }
        const relPath = relDir ? `${relDir}${sep}${entry.name}` : entry.name
        if (entry.isSymbolicLink()) {
          skippedSymlinks += 1
          continue
        }
        if (entry.isDirectory()) {
          stack.push(relPath)
        } else if (entry.isFile()) {
          let info: Stats
          try {
            info = statSync(join(root, relPath))
          } catch {
            continue
          }
          files.push({ name: entry.name, relativePath: relPath, size: info.size })
        }
      }
    }

    while (stack.length > 0 && !truncated) {
      pushChildren(stack.pop() as string)
    }
    return { files, skippedSymlinks, truncated }
  }

  // ---- assembly ------------------------------------------------------------

  async function readSlice(path: string, start: number, length: number): Promise<Uint8Array> {
    if (length === 0) return new Uint8Array(0)
    const handle = await open(path, 'r')
    try {
      const info = await handle.stat()
      if (info.size < start + length) throw new DriveError('DRIVE_SOURCE_CHANGED', 'Backup source changed during upload')
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      if (bytesRead !== length) throw new DriveError('DRIVE_SOURCE_CHANGED', 'Backup source changed during upload')
      return buffer
    } finally {
      await handle.close()
    }
  }

  async function partBytes(workspaceId: string, session: DriveUploadSession, index: number): Promise<Uint8Array> {
    if (session.source === 'device-backup' && session.sourcePath) {
      const part = session.parts[index]
      if (!part) throw new DriveError('INVALID_PAYLOAD', 'Invalid part index')
      return readSlice(session.sourcePath, index * session.partSize, part.sizeBytes)
    }
    return readFile(partPath(workspaceId, session.id, index))
  }

  // ---- service -------------------------------------------------------------

  return {
    async getQuota(workspaceId: string): Promise<DriveQuota> {
      return computeQuota(workspace(loadIndex(), workspaceId))
    },

    async list(workspaceId: string, folderId?: string): Promise<DriveListing> {
      const entry = workspace(loadIndex(), workspaceId)
      const target = folderId ?? DRIVE_ROOT_FOLDER_ID
      ensureFolder(entry, target)
      const path: DriveFolder[] = []
      let cursor: string | null = target
      while (cursor) {
        const folder = entry.folders.find(candidate => candidate.id === cursor)
        if (!folder) break
        path.unshift(folder)
        cursor = folder.parentId
      }
      return {
        folderId: target,
        path: path.map(folder => ({ ...folder })),
        folders: entry.folders.filter(folder => folder.parentId === target).map(folder => ({ ...folder })),
        files: entry.files.filter(file => file.folderId === target).map(file => ({ ...file })),
      }
    },

    async createFolder(workspaceId: string, parentId: string, name: string): Promise<DriveFolder> {
      const safeName = assertSafeName(name)
      const safeParent = assertSafeId(parentId)
      return mutate(index => {
        const entry = workspace(index, workspaceId)
        ensureFolder(entry, safeParent)
        const folder: DriveFolder = {
          id: randomUUID().replace(/-/g, '').slice(0, 24),
          name: safeName,
          parentId: safeParent,
          createdAt: now().toISOString(),
        }
        entry.folders.push(folder)
        return { ...folder }
      })
    },

    async openUpload(workspaceId: string, input: OpenUploadInput): Promise<DriveUploadSession> {
      const safeName = assertSafeName(input?.name)
      const size = input?.size
      if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
        throw new DriveError('INVALID_PAYLOAD', 'Invalid size')
      }
      const source: DriveFileSource = input.source === 'device-backup' ? 'device-backup' : input.source === 'import' ? 'import' : 'upload'
      const folderId = input.folderId ? assertSafeId(input.folderId) : DRIVE_ROOT_FOLDER_ID
      const plan = planParts(size, DRIVE_PART_SIZE_BYTES)
      if (plan.length > DRIVE_MAX_PARTS) throw new DriveError('DRIVE_TOO_MANY_PARTS', 'File has too many parts')

      const sourceKind = input.sourceKind
      const relativePath = input.relativePath
      if (source === 'device-backup' && (!sourceKind || !relativePath)) {
        throw new DriveError('INVALID_PAYLOAD', 'Missing backup source')
      }

      return mutate(index => {
        const entry = workspace(index, workspaceId)
        ensureFolder(entry, folderId)

        // Resume an interrupted session for the same file + destination.
        const existing = entry.uploads.find(upload =>
          upload.status === 'open'
          && upload.name === safeName
          && upload.size === size
          && upload.folderId === folderId
          && upload.source === source,
        )
        if (existing) return cloneSession(existing)

        let sourcePath: string | undefined
        if (source === 'device-backup' && sourceKind && relativePath) {
          sourcePath = resolveBackupPath(sourceKind, relativePath)
          if (!existsSync(sourcePath)) throw new DriveError('DRIVE_SOURCE_MISSING', 'Backup source file vanished', { relativePath })
        }
        const session: DriveUploadSession = {
          id: randomUUID(),
          workspaceId: assertSafeId(workspaceId),
          name: safeName,
          size,
          folderId,
          partSize: DRIVE_PART_SIZE_BYTES,
          source,
          sourcePath,
          parts: plan.map(part => ({ index: part.index, sizeBytes: part.sizeBytes, done: false })),
          expectedSha256: typeof input.expectedSha256 === 'string' ? input.expectedSha256.toLowerCase() : undefined,
          status: 'open',
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
        }
        entry.uploads.push(session)
        return cloneSession(session)
      })
    },

    async uploadPart(workspaceId: string, uploadId: string, index: number, bytes?: Uint8Array): Promise<{ index: number; done: boolean }> {
      const safeUpload = assertSafeId(uploadId)
      if (!Number.isInteger(index) || index < 0) throw new DriveError('INVALID_PAYLOAD', 'Invalid part index')

      const entry0 = workspace(loadIndex(), workspaceId)
      const session0 = entry0.uploads.find(upload => upload.id === safeUpload)
      if (!session0) throw new DriveError('DRIVE_UPLOAD_NOT_FOUND', 'Upload session not found')
      if (session0.status !== 'open') throw new DriveError('DRIVE_UPLOAD_CLOSED', 'Upload session is not open')
      const part = session0.parts[index]
      if (!part) throw new DriveError('INVALID_PAYLOAD', 'Invalid part index')
      if (part.done) return { index, done: true }

      let payload: Uint8Array
      if (session0.source === 'device-backup' && session0.sourcePath) {
        if (bytes && bytes.byteLength > 0) throw new DriveError('INVALID_PAYLOAD', 'Device-backup parts are read by the host')
        payload = await readSlice(session0.sourcePath, index * session0.partSize, part.sizeBytes)
      } else {
        if (!(bytes instanceof Uint8Array)) throw new DriveError('INVALID_PAYLOAD', 'Missing part bytes')
        if (bytes.byteLength !== part.sizeBytes) {
          throw new DriveError('DRIVE_PART_SIZE_MISMATCH', 'Part size mismatch', { expected: part.sizeBytes, received: bytes.byteLength })
        }
        payload = bytes
      }
      const digest = sha256Hex(payload)

      const uploadDir = join(uploadsDir(workspaceId), safeUpload)
      await mkdir(uploadDir, { recursive: true })
      const tmp = join(uploadDir, `part-${index}.tmp`)
      await writeFile(tmp, payload, { mode: 0o600 })
      await rename(tmp, partPath(workspaceId, safeUpload, index))

      await mutate(index0 => {
        const entry = workspace(index0, workspaceId)
        const session = entry.uploads.find(upload => upload.id === safeUpload)
        if (!session || session.status !== 'open') throw new DriveError('DRIVE_UPLOAD_CLOSED', 'Upload session is not open')
        const target = session.parts[index]
        if (!target) throw new DriveError('INVALID_PAYLOAD', 'Invalid part index')
        target.done = true
        target.sha256 = digest
        session.updatedAt = now().toISOString()
      })
      return { index, done: true }
    },

    async completeUpload(workspaceId: string, uploadId: string): Promise<DriveFile> {
      const safeUpload = assertSafeId(uploadId)
      const entry0 = workspace(loadIndex(), workspaceId)
      const session0 = entry0.uploads.find(upload => upload.id === safeUpload)
      if (!session0) throw new DriveError('DRIVE_UPLOAD_NOT_FOUND', 'Upload session not found')
      if (session0.status === 'completed') {
        const existing = entry0.files.find(file => file.id === session0.id)
        if (existing) return { ...existing }
      }
      if (session0.status !== 'open') throw new DriveError('DRIVE_UPLOAD_CLOSED', 'Upload session is not open')
      const missing = session0.parts.filter(part => !part.done)
      if (missing.length > 0) {
        throw new DriveError('DRIVE_PARTS_INCOMPLETE', 'Upload is missing parts', { missing: missing.map(part => part.index) })
      }

      const fileId = session0.id
      const prefix = prefixFor(fileId)
      const targetDir = join(workspaceDir(workspaceId), prefix)
      await mkdir(targetDir, { recursive: true })
      const targetPath = join(targetDir, fileId)
      const tmpPath = join(targetDir, `.${fileId}.tmp`)

      const hasher = createHash('sha256')
      const out = await open(tmpPath, 'w', 0o600)
      try {
        for (const part of session0.parts) {
          const chunk = await partBytes(workspaceId, session0, part.index)
          hasher.update(chunk)
          await out.write(chunk)
        }
      } catch (error) {
        await out.close()
        await rm(tmpPath, { force: true })
        throw error
      }
      await out.close()

      const digest = hasher.digest('hex')
      if (session0.expectedSha256 && digest !== session0.expectedSha256) {
        await rm(tmpPath, { force: true })
        throw new DriveError('DRIVE_CHECKSUM_MISMATCH', 'Assembled file checksum mismatch', { expected: session0.expectedSha256, actual: digest })
      }
      await rename(tmpPath, targetPath)

      const file = await mutate(index => {
        const entry = workspace(index, workspaceId)
        const session = entry.uploads.find(upload => upload.id === safeUpload)
        if (!session) throw new DriveError('DRIVE_UPLOAD_NOT_FOUND', 'Upload session not found')
        if (session.status === 'aborted') throw new DriveError('DRIVE_UPLOAD_CLOSED', 'Upload session was aborted')
        if (session.status === 'completed') {
          const found = entry.files.find(record => record.id === session.id)
          if (found) return { ...found }
        }
        const record: DriveFile = {
          id: session.id,
          name: session.name,
          size: session.size,
          folderId: session.folderId,
          prefix,
          sha256: digest,
          source: session.source,
          createdAt: now().toISOString(),
        }
        entry.files.push(record)
        session.status = 'completed'
        session.updatedAt = now().toISOString()
        return { ...record }
      })

      await rm(join(uploadsDir(workspaceId), safeUpload), { recursive: true, force: true })
      return file
    },

    async abortUpload(workspaceId: string, uploadId: string): Promise<void> {
      const safeUpload = assertSafeId(uploadId)
      await mutate(index => {
        const entry = workspace(index, workspaceId)
        const session = entry.uploads.find(upload => upload.id === safeUpload)
        if (!session) throw new DriveError('DRIVE_UPLOAD_NOT_FOUND', 'Upload session not found')
        if (session.status === 'completed') throw new DriveError('DRIVE_UPLOAD_CLOSED', 'Upload already completed')
        session.status = 'aborted'
        session.updatedAt = now().toISOString()
      })
      await rm(join(uploadsDir(workspaceId), safeUpload), { recursive: true, force: true })
    },

    async deleteFile(workspaceId: string, fileId: string): Promise<void> {
      const safeFile = assertSafeId(fileId)
      const removed = await mutate(index => {
        const entry = workspace(index, workspaceId)
        const at = entry.files.findIndex(file => file.id === safeFile)
        if (at === -1) throw new DriveError('DRIVE_FILE_NOT_FOUND', 'File not found')
        const [file] = entry.files.splice(at, 1)
        entry.uploads = entry.uploads.filter(upload => upload.id !== safeFile)
        return file
      })
      const base = workspaceDir(workspaceId)
      const target = resolve(base, removed.prefix, removed.id)
      if (relative(base, target).startsWith('..')) throw new DriveError('INVALID_PAYLOAD', 'Invalid storage path')
      await rm(target, { force: true })
    },

    async scanSource(workspaceId: string, sourceKind: DriveBackupSourceKind): Promise<DriveScanResult> {
      assertSafeId(workspaceId)
      const root = backupSourceRoot(sourceKind)
      if (!existsSync(root)) {
        return { sourceKind, rootPath: root, files: [], totalBytes: 0, skippedSymlinks: 0, truncated: false }
      }
      const { files, skippedSymlinks, truncated } = walk(root)
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
      return { sourceKind, rootPath: root, files, totalBytes, skippedSymlinks, truncated }
    },
  }
}