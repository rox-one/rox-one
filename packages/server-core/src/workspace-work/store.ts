import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CodedError } from '@rox/shared/protocol'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { emptyWorkspaceWorkState, type WorkspaceWorkState, type WorkspaceWorkReceipt } from '@rox/shared/workspace-work'
import { validateWorkspaceId, validateWorkspaceWorkState } from './validation.ts'

const MAX_STATE_BYTES = 8 * 1024 * 1024
/** One atomic canonical bundle. SQLite's OS lock leases writes across processes and recovers dead writers. */
export class WorkspaceWorkStore {
  readonly rootPath: string
  readonly directory: string
  readonly filePath: string
  readonly leasePath: string
  constructor(rootPath: string, readonly workspaceId: string) {
    validateWorkspaceId(workspaceId)
    this.rootPath = realpathSync(rootPath)
    this.directory = join(this.rootPath, 'workspace-work')
    this.filePath = join(this.directory, 'state.json')
    this.leasePath = join(this.directory, 'write-lease.sqlite')
  }
  private checkPath(): void {
    if (realpathSync(this.rootPath) !== this.rootPath) throw new CodedError('FORBIDDEN', 'Workspace work path denied')
    for (const path of [this.directory, this.filePath, this.leasePath]) {
      if (!existsSync(path)) continue
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || (path === this.directory ? !stat.isDirectory() : !stat.isFile()) || (path !== this.directory && stat.nlink !== 1)) {
        throw new CodedError('FORBIDDEN', 'Workspace work path denied')
      }
    }
  }
  read(): WorkspaceWorkState {
    this.checkPath()
    if (!existsSync(this.filePath)) return emptyWorkspaceWorkState(this.workspaceId)
    if (statSync(this.filePath).size > MAX_STATE_BYTES) throw new CodedError('INVALID_PAYLOAD', 'Workspace work state too large')
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) }
    catch { throw new CodedError('INVALID_PAYLOAD', 'Workspace work state is corrupt') }
    return validateWorkspaceWorkState(parsed, this.workspaceId)
  }
  resolveTask(id: string): { status: 'available'; task: WorkspaceWorkState['tasks'][number] } | { status: 'deleted' } | { status: 'unavailable' } {
    const state = this.read()
    const task = state.tasks.find(task => task.id === id)
    if (task) return { status: 'available', task }
    return state.tombstones.some(tombstone => tombstone.kind === 'task' && tombstone.id === id)
      ? { status: 'deleted' } : { status: 'unavailable' }
  }
  commit(expectedRevision: number, apply: (draft: WorkspaceWorkState) => string, guard: () => void): { state: WorkspaceWorkState; receipt: WorkspaceWorkReceipt } {
    this.checkPath()
    guard()
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.checkPath()
    // This database holds only the OS lease, never a duplicate of canonical data.
    // A killed writer releases the database lock; no TTL or guessed stale directory takeover.
    const lease = new DatabaseSync(this.leasePath)
    let locked = false
    try { lease.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); locked = true }
    catch (error) {
      lease.close()
      throw new CodedError('DOCUMENT_BUSY', 'Workspace work writer is busy')
    }
    const tmp = join(this.directory, `.state-${randomUUID()}.tmp`)
    try {
      const draft = this.read()
      if (draft.revision !== expectedRevision) throw new CodedError('REVISION_CONFLICT', 'Workspace work revision changed')
      guard()
      const entityId = apply(draft)
      draft.revision++
      validateWorkspaceWorkState(draft, this.workspaceId)
      const bytes = JSON.stringify(draft)
      if (Buffer.byteLength(bytes) > MAX_STATE_BYTES) throw new CodedError('INVALID_PAYLOAD', 'Workspace work state too large')
      const fd = openSync(tmp, 'wx', 0o600)
      try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
      guard()
      this.checkPath()
      renameSync(tmp, this.filePath)
      const dirFd = openSync(this.directory, 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const observed = readFileSync(this.filePath)
      if (createHash('sha256').update(observed).digest('hex') !== sha256) throw new CodedError('DOCUMENT_RESULT_UNAVAILABLE', 'Workspace work readback failed')
      const state = validateWorkspaceWorkState(JSON.parse(observed.toString('utf8')), this.workspaceId)
      lease.exec('COMMIT'); locked = false
      return { state, receipt: { id: randomUUID(), workspaceId: this.workspaceId, entityId,
        revision: state.revision, sha256, verifiedAt: Date.now() } }
    } finally {
      rmSync(tmp, { force: true })
      if (locked) lease.exec('ROLLBACK')
      lease.close()
    }
  }
}
