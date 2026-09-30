import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, unlink, readdir, lstat, link, rmdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { MarkdownCommitError, decodeMarkdownCommitCommand, type MarkdownCommitCommand } from '../../../core/src/docs/command-envelope.ts'

export const markdownRevision = (content: string): string => `sha256:${digest(content)}`
const digest = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export interface MarkdownCommitReceipt {
  schemaVersion: 1
  operationId: string
  workspaceId: string
  noteId: string
  actorPrincipalId: string
  authorityEpoch: number
  sourceStoreId?: string
  previousRevision: string
  revision: string
  eventId: string
  committedAt: string
}

interface Journal {
  schemaVersion: 1
  phase: 'prepared' | 'committed' | 'aborted'
  fingerprint: string
  command: MarkdownCommitCommand
  receipt: MarkdownCommitReceipt
  /** The intent is synced with the prepared write, before content publication. */
  changed?: { state: 'pending' | 'accepted'; acceptedAt?: string }
}

export interface MarkdownChangedEvent {
  eventId: string
  workspaceId: string
  noteId: string
  reason: 'save' | 'create' | 'rename' | 'delete' | 'asset' | 'properties'
}

/** Content/WAL are already durable; native invalidation acceptance is still pending. */
export class MarkdownChangedDeliveryError extends Error {
  constructor(readonly eventId: string, readonly cause: unknown) {
    super('Native document invalidation is unavailable; its durable intent remains pending')
    this.name = 'MarkdownChangedDeliveryError'
  }
}

export type NativeMarkdownChange =
  | { kind: 'write'; noteId: string; expectedRevision: string | null; content: string }
  | { kind: 'move'; noteId: string; targetNoteId: string; expectedRevision: string }
  | { kind: 'moveFolder'; noteId: string; targetNoteId: string; expectedRevision: string; noteIds: string[] }
  | { kind: 'deleteFolder'; noteId: string; expectedRevision: string; entries: NativeFolderEntry[]; noteIds: string[] }
  | { kind: 'delete'; noteId: string; expectedRevision: string }

export type NativeFolderEntry = { relativePath: string; kind: 'directory' } | { relativePath: string; kind: 'file'; revision: string }
export interface NativeFolderSnapshot { revision: string; entries: NativeFolderEntry[]; noteIds: string[] }

export interface NativeMarkdownWriteCommand {
  workspaceId: string
  operationId: string
  authorityEpoch: number
  sourceStoreId: string
  reason: MarkdownChangedEvent['reason']
  changes: NativeMarkdownChange[]
}

export interface NativeMarkdownWriteReceipt {
  schemaVersion: 1
  workspaceId: string
  operationId: string
  sourceStoreId: string
  authorityEpoch: number
  actorPrincipalId: string
  eventId: string
  committedAt: string
  noteIds: string[]
}

interface NativeJournal {
  schemaVersion: 1
  phase: 'prepared' | 'committed' | 'aborted'
  fingerprint: string
  command: NativeMarkdownWriteCommand
  receipt: NativeMarkdownWriteReceipt
  applied: number
  changed: { state: 'pending' | 'accepted'; acceptedAt?: string }
}

export interface MarkdownCommitOwner {
  /** Trusted server composition, not a request payload callback. */
  authorize(actorPrincipalId: string, command: Pick<MarkdownCommitCommand, 'workspaceId' | 'noteId'>): Promise<boolean>
  authorityEpoch(command: Pick<MarkdownCommitCommand, 'workspaceId' | 'noteId'>): Promise<number>
  requireSourceBinding?: boolean
  sourceStoreId?(command: Pick<MarkdownCommitCommand, 'workspaceId' | 'noteId'>): Promise<string>
  /** Resolving means the native invalidation callback accepted the event, not a remote/client delivery ACK. */
  changed?(event: MarkdownChangedEvent): Promise<void>
  /** Native lifecycle authority validates trusted actor, source and safe parent paths even for absent notes. */
  authorizeNative?(actorPrincipalId: string, command: Pick<MarkdownCommitCommand, 'workspaceId' | 'noteId'>): Promise<boolean>
}

type FaultPoint = 'afterJournalSync' | 'beforeContentRename' | 'afterContentRename' | 'afterReceiptSync' | 'afterChangedAccepted' | 'afterClaimSync' | 'afterNativeChange' | 'afterNativeFolderEntry'

/** Cooperating writers share a filesystem lease and an fsync'd write-ahead journal. */
export class MarkdownCommitStore {
  private readonly root: string
  private readonly stateRoot: string
  constructor(notesRoot: string, private readonly owner: MarkdownCommitOwner, private readonly fault?: (point: FaultPoint) => Promise<void>) {
    this.root = resolve(notesRoot)
    this.stateRoot = join(this.root, '.rox-docs', 'commits')
  }

  async commit(actorPrincipalId: string, rawCommand: unknown): Promise<MarkdownCommitReceipt> {
    await this.assertAuthorized(actorPrincipalId, decodeMarkdownCommitCommand(rawCommand))
    return this.withVaultLease(() => this.commitLocked(actorPrincipalId, rawCommand))
  }

  private async commitLocked(actorPrincipalId: string, rawCommand: unknown): Promise<MarkdownCommitReceipt> {
    const command = decodeMarkdownCommitCommand(rawCommand)
    await this.assertAuthorized(actorPrincipalId, command)
    const file = await this.notePath(command.noteId)
    const directory = join(this.stateRoot, digest(`${command.workspaceId}\0${command.noteId}`))
    await this.ensureStateDirectory(directory)
    // The same native vault can be configured in two workspaces. They still
    // write one physical file, so lease identity must not include workspace.
    const leaseDirectory = join(this.stateRoot, digest(`file\0${command.noteId}`))
    await this.ensureStateDirectory(leaseDirectory)
    const release = await this.acquireLease(leaseDirectory)
    try {
      await this.assertAuthorized(actorPrincipalId, command)
      await this.recover(directory, file)
      const key = digest(`${actorPrincipalId}\0${command.operationId}`)
      const journalPath = join(directory, `${key}.json`)
      const fingerprint = digest(JSON.stringify(command))
      const old = await this.readJournal(journalPath)
      if (old) {
        if (old.fingerprint !== fingerprint) throw new MarkdownCommitError('validation', 'Operation ID already has different inputs')
        if (old.phase === 'committed') { await this.deliverChanged(journalPath, old); return old.receipt }
        throw new MarkdownCommitError('conflict', 'An interrupted operation could not be committed')
      }
      const epoch = await this.owner.authorityEpoch(command)
      if (epoch !== command.authorityEpoch) throw new MarkdownCommitError('unknownFormat', 'Document authority changed')
      const current = await this.readContent(file)
      const currentRevision = markdownRevision(current)
      if (currentRevision !== command.expectedRevision) throw new MarkdownCommitError('conflict', 'note revision conflict', currentRevision)
      const receipt: MarkdownCommitReceipt = {
        schemaVersion: 1, operationId: command.operationId, workspaceId: command.workspaceId,
        noteId: command.noteId, actorPrincipalId, authorityEpoch: epoch,
        ...(command.sourceStoreId === undefined ? {} : { sourceStoreId: command.sourceStoreId }),
        previousRevision: currentRevision, revision: markdownRevision(command.content),
        eventId: `document:${key}`, committedAt: new Date().toISOString(),
      }
      const journal: Journal = { schemaVersion: 1, phase: 'prepared', fingerprint, command, receipt, changed: { state: 'pending' } }
      await this.atomicJson(journalPath, journal)
      await this.fault?.('afterJournalSync')
      await this.publishContent(file, journal)
      await this.fault?.('afterContentRename')
      journal.phase = 'committed'
      await this.atomicJson(journalPath, journal)
      await this.fault?.('afterReceiptSync')
      await this.deliverChanged(journalPath, journal)
      return receipt
    } finally { await release() }
  }

  async getReceipt(actorPrincipalId: string, workspaceId: string, noteId: string, operationId: string): Promise<MarkdownCommitReceipt | null> {
    await this.assertAuthorized(actorPrincipalId, { workspaceId, noteId }, true)
    if (!await this.hasStateDirectory()) return null
    return this.withVaultLease(() => this.getReceiptLocked(actorPrincipalId, workspaceId, noteId, operationId), false)
  }

  private async getReceiptLocked(actorPrincipalId: string, workspaceId: string, noteId: string, operationId: string): Promise<MarkdownCommitReceipt | null> {
    await this.assertAuthorized(actorPrincipalId, { workspaceId, noteId }, true)
    const file = await this.notePath(noteId)
    const directory = join(this.stateRoot, digest(`${workspaceId}\0${noteId}`))
    await this.ensureStateDirectory(directory)
    const leaseDirectory = join(this.stateRoot, digest(`file\0${noteId}`))
    await this.ensureStateDirectory(leaseDirectory)
    const release = await this.acquireLease(leaseDirectory)
    try {
      await this.recover(directory, file, false)
      const journal = await this.readJournal(join(directory, `${digest(`${actorPrincipalId}\0${operationId}`)}.json`))
      if (journal && (journal.receipt.workspaceId !== workspaceId || journal.receipt.noteId !== noteId || journal.receipt.actorPrincipalId !== actorPrincipalId)) throw new MarkdownCommitError('denied', 'Document receipt belongs to another request')
      if (journal) await this.assertAuthorized(actorPrincipalId, journal.command)
      else await this.assertAuthorized(actorPrincipalId, { workspaceId, noteId }, true)
      return journal?.phase === 'committed' ? journal.receipt : null
    } finally { await release() }
  }

  /** Replays persisted native invalidations on restart. A crash after acceptance may replay the same event ID. */
  async drainChangedEvents(): Promise<number> {
    if (!await this.hasStateDirectory()) return 0
    return this.withVaultLease(() => this.drainChangedEventsLocked())
  }

  /** Legacy reads and absent receipt lookups never initialize a writer store. */
  private async hasStateDirectory(): Promise<boolean> {
    let current = await realpath(this.root)
    for (const segment of ['.rox-docs', 'commits']) {
      current = join(current, segment)
      try {
        const entry = await lstat(current)
        if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(current) !== current) throw new MarkdownCommitError('denied', 'Document metadata path is not a native directory')
      } catch (error) { if (isMissing(error)) return false; throw error }
    }
    return true
  }

  private async drainChangedEventsLocked(): Promise<number> {
    await this.ensureStateDirectory(this.stateRoot)
    let accepted = 0
    for (const name of (await readdir(this.stateRoot)).filter(name => /^[a-f0-9]{64}$/.test(name)).sort()) {
      const directory = join(this.stateRoot, name)
      await this.ensureStateDirectory(directory)
      for (const entry of (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
        const path = join(directory, entry)
        const candidate = await this.readJournal(path)
        if (!candidate || candidate.phase === 'aborted') continue
        const command = candidate.command
        try { await this.assertAuthorized(candidate.receipt.actorPrincipalId, command) }
        catch (error) { if (error instanceof MarkdownCommitError) continue; throw error }
        const leaseDirectory = join(this.stateRoot, digest(`file\0${command.noteId}`))
        await this.ensureStateDirectory(leaseDirectory)
        const release = await this.acquireLease(leaseDirectory)
        try {
          await this.recover(directory, await this.notePath(command.noteId))
          const journal = await this.readJournal(path)
          if (journal && await this.deliverChanged(path, journal)) accepted++
        } finally { await release() }
      }
    }
    return accepted
  }

  /** A vault transition lease covers multi-note moves and backlink changes as well as ordinary saves. */
  private async withVaultLease<T>(action: () => Promise<T>, deliverEvents = true): Promise<T> {
    const directory = join(this.stateRoot, digest('native-vault-writer-v1'))
    await this.ensureStateDirectory(directory)
    const release = await this.acquireLease(directory)
    try { await this.recoverNativeJournals(deliverEvents); return await action() }
    finally { await release() }
  }

  async writeNative(actorPrincipalId: string, rawCommand: NativeMarkdownWriteCommand): Promise<NativeMarkdownWriteReceipt> {
    const command = decodeNativeCommand(rawCommand)
    await this.assertNativeAuthorized(actorPrincipalId, command)
    return this.withVaultLease(async () => {
      await this.assertNativeAuthorized(actorPrincipalId, command)
      await this.recoverSaveJournalsFor(command.changes.flatMap(change => change.kind === 'moveFolder' || change.kind === 'deleteFolder' ? change.noteIds : change.kind === 'move' ? [change.noteId, change.targetNoteId] : [change.noteId]))
      const directory = join(this.stateRoot, digest(`native\0${command.workspaceId}`))
      await this.ensureStateDirectory(directory)
      const key = digest(`${actorPrincipalId}\0${command.operationId}`)
      const path = join(directory, `native-${key}.json`)
      const fingerprint = digest(JSON.stringify(command))
      const old = await this.readNativeJournal(path)
      if (old) {
        if (old.fingerprint !== fingerprint) throw new MarkdownCommitError('validation', 'Operation ID already has different inputs')
        if (old.phase !== 'committed') throw new MarkdownCommitError('conflict', 'Interrupted native write could not be committed')
        await this.deliverNativeChanged(path, old)
        return old.receipt
      }
      // Preflight the complete CAS chain before publishing its durable intent.
      const revisions = new Map<string, string | null>()
      const revisionFor = async (id: string) => {
        if (!revisions.has(id)) revisions.set(id, await this.nativeRevision(id))
        return revisions.get(id) ?? null
      }
      for (const change of command.changes) {
        const folder = change.kind === 'moveFolder' || change.kind === 'deleteFolder' ? await this.folderSnapshot(change.noteId) : null
        const current = change.kind === 'moveFolder' || change.kind === 'deleteFolder' ? folder?.revision ?? null : await revisionFor(change.noteId)
        if (current !== change.expectedRevision) throw new MarkdownCommitError('conflict', 'note revision conflict', current ?? undefined)
        if ((change.kind === 'moveFolder' || change.kind === 'deleteFolder') && JSON.stringify(folder?.noteIds) !== JSON.stringify(change.noteIds)) throw new MarkdownCommitError('validation', 'Native folder note set changed')
        if (change.kind === 'write') revisions.set(change.noteId, markdownRevision(change.content))
        else if (change.kind === 'delete') revisions.set(change.noteId, null)
        else if (change.kind === 'deleteFolder') {
          if (JSON.stringify(folder?.entries) !== JSON.stringify(change.entries)) throw new MarkdownCommitError('validation', 'Native folder snapshot changed')
          for (const id of change.noteIds) revisions.set(id, null)
        }
        else if (change.kind === 'moveFolder') {
          if (await this.folderRevision(change.targetNoteId) !== null) throw new MarkdownCommitError('conflict', 'Native move target already exists')
          for (const id of change.noteIds) {
            const revision = await revisionFor(id)
            revisions.set(`${change.targetNoteId}/${id.slice(change.noteId.length + 1)}`, revision)
            revisions.set(id, null)
          }
        } else {
          if (await revisionFor(change.targetNoteId) !== null) throw new MarkdownCommitError('conflict', 'Native move target already exists')
          revisions.set(change.targetNoteId, current)
          revisions.set(change.noteId, null)
        }
      }
      const receipt: NativeMarkdownWriteReceipt = {
        schemaVersion: 1, workspaceId: command.workspaceId, operationId: command.operationId,
        sourceStoreId: command.sourceStoreId, authorityEpoch: command.authorityEpoch, actorPrincipalId,
        eventId: `native-document:${key}`, committedAt: new Date().toISOString(),
        noteIds: nativeChangedNoteIds(command),
      }
      const journal: NativeJournal = { schemaVersion: 1, phase: 'prepared', fingerprint, command, receipt, applied: 0, changed: { state: 'pending' } }
      await this.atomicJson(path, journal)
      await this.fault?.('afterJournalSync')
      await this.applyNativeJournal(path, journal)
      await this.deliverNativeChanged(path, journal)
      return receipt
    })
  }

  async getNativeWriteReceipt(actor: string, workspaceId: string, operationId: string, sourceStoreId: string): Promise<NativeMarkdownWriteReceipt | null> {
    if (!await this.hasStateDirectory()) return null
    return this.withVaultLease(async () => {
      const directory = join(this.stateRoot, digest(`native\0${workspaceId}`))
      await this.ensureStateDirectory(directory)
      const path = join(directory, `native-${digest(`${actor}\0${operationId}`)}.json`)
      const journal = await this.readNativeJournal(path)
      if (!journal) return null
      if (journal.receipt.actorPrincipalId !== actor || journal.command.workspaceId !== workspaceId || journal.command.sourceStoreId !== sourceStoreId) throw new MarkdownCommitError('denied', 'Native receipt belongs to another request')
      await this.assertNativeAuthorized(actor, journal.command)
      return journal.phase === 'committed' ? journal.receipt : null
    }, false)
  }

  private async recoverSaveJournalsFor(noteIds: string[]): Promise<void> {
    const affected = new Set(noteIds)
    for (const name of (await readdir(this.stateRoot)).filter(name => /^[a-f0-9]{64}$/.test(name)).sort()) {
      const directory = join(this.stateRoot, name)
      await this.ensureStateDirectory(directory)
      for (const entry of (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
        const path = join(directory, entry)
        const journal = await this.readJournal(path)
        if (!journal || journal.phase === 'aborted' || !affected.has(journal.command.noteId)) continue
        if (journal.phase === 'committed') { await this.deliverChanged(path, journal); continue }
        const current = await this.nativeRevision(journal.command.noteId)
        if (current === null) {
          journal.phase = 'aborted'
          await this.atomicJson(path, journal)
          continue
        }
        await this.recover(directory, await this.notePath(journal.command.noteId))
      }
    }
  }

  private async assertNativeAuthorized(actor: string, command: NativeMarkdownWriteCommand): Promise<void> {
    for (const change of command.changes) {
      const noteIds = change.kind === 'moveFolder' ? [change.noteId, change.targetNoteId, ...change.noteIds, ...change.noteIds.map(id => `${change.targetNoteId}/${id.slice(change.noteId.length + 1)}`)]
        : change.kind === 'deleteFolder' ? [change.noteId, ...change.noteIds]
        : change.kind === 'move' ? [change.noteId, change.targetNoteId] : [change.noteId]
      for (const noteId of noteIds) {
        const scope = { workspaceId: command.workspaceId, noteId, sourceStoreId: command.sourceStoreId }
        if (!actor || !this.owner.authorizeNative || !await this.owner.authorizeNative(actor, scope)) throw new MarkdownCommitError('denied', 'Native document access denied')
        if (await this.owner.sourceStoreId?.(scope) !== command.sourceStoreId) throw new MarkdownCommitError('unknownFormat', 'Document source binding changed')
        if (await this.owner.authorityEpoch(scope) !== command.authorityEpoch) throw new MarkdownCommitError('unknownFormat', 'Document authority changed')
        if ((change.kind === 'moveFolder' || change.kind === 'deleteFolder') && (noteId === change.noteId || (change.kind === 'moveFolder' && noteId === change.targetNoteId))) await this.folderPath(noteId)
        else await this.nativePath(noteId)
      }
    }
  }

  private async nativePath(noteId: string, createParents = false): Promise<string> {
    if (noteId.includes('\0') || noteId.includes('\\') || noteId.split('/').some(part => !part || part === '.' || part === '..') || noteId === '.rox-docs' || noteId.startsWith('.rox-docs/')) throw new MarkdownCommitError('validation', 'Invalid note ID')
    const root = await realpath(this.root)
    const candidate = resolve(root, `${noteId}.md`)
    if (!candidate.startsWith(root + sep)) throw new MarkdownCommitError('validation', 'Invalid note path')
    let parent = root
    for (const segment of relative(root, dirname(candidate)).split(sep).filter(Boolean)) {
      parent = join(parent, segment)
      try {
        const entry = await lstat(parent)
        if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(parent) !== parent) throw new MarkdownCommitError('denied', 'Document symlink access denied')
      } catch (error) {
        if (!isMissing(error)) throw error
        if (createParents) { await mkdir(parent, { mode: 0o700 }); await this.syncDirectory(dirname(parent)) }
      }
    }
    try {
      const entry = await lstat(candidate)
      if (!entry.isFile() || entry.isSymbolicLink() || await realpath(candidate) !== candidate) throw new MarkdownCommitError('denied', 'Document symlink access denied')
    } catch (error) { if (!isMissing(error)) throw error }
    return candidate
  }

  private async nativeRevision(noteId: string): Promise<string | null> {
    const path = await this.nativePath(noteId)
    try { return markdownRevision(await this.readContent(path)) }
    catch (error) { if (error instanceof MarkdownCommitError && error.kind === 'deleted') return null; throw error }
  }

  private async folderPath(noteId: string, createParents = false): Promise<string> {
    const candidate = (await this.nativePath(noteId, createParents)).slice(0, -3)
    try {
      const entry = await lstat(candidate)
      if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(candidate) !== candidate) throw new MarkdownCommitError('denied', 'Document folder symlink access denied')
    } catch (error) { if (!isMissing(error)) throw error }
    return candidate
  }

  async folderRevision(noteId: string): Promise<string | null> {
    return (await this.folderSnapshot(noteId))?.revision ?? null
  }

  async folderSnapshot(noteId: string): Promise<NativeFolderSnapshot | null> {
    const root = await this.folderPath(noteId)
    const entries: NativeFolderEntry[] = []
    const visit = async (directory: string): Promise<void> => {
      for (const name of (await readdir(directory)).sort()) {
        const path = join(directory, name)
        const entry = await lstat(path)
        if (entry.isSymbolicLink()) throw new MarkdownCommitError('denied', 'Document folder symlink access denied')
        const id = relative(root, path).split(sep).join('/')
        if (entry.isDirectory()) { entries.push({ kind: 'directory', relativePath: id }); await visit(path) }
        else if (entry.isFile()) entries.push({ kind: 'file', relativePath: id, revision: `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}` })
        else throw new MarkdownCommitError('denied', 'Unsupported native folder entry')
      }
    }
    try { await visit(root); return { revision: markdownRevision(JSON.stringify(entries)), entries,
      noteIds: entries.filter(entry => entry.kind === 'file' && entry.relativePath.toLowerCase().endsWith('.md')).map(entry => `${noteId}/${entry.relativePath.slice(0, -3)}`) } }
    catch (error) { if (isMissing(error)) return null; throw error }
  }

  private async readNativeJournal(path: string): Promise<NativeJournal | null> {
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as NativeJournal
      const command = decodeNativeCommand(value.command)
      const receipt = value.receipt
      const key = digest(`${receipt?.actorPrincipalId}\0${command.operationId}`)
      if (value.schemaVersion !== 1 || !['prepared', 'committed', 'aborted'].includes(value.phase) || value.fingerprint !== digest(JSON.stringify(command))
        || !Number.isSafeInteger(value.applied) || value.applied < 0 || value.applied > command.changes.length
        || !receipt || receipt.schemaVersion !== 1 || receipt.workspaceId !== command.workspaceId || receipt.operationId !== command.operationId
        || receipt.sourceStoreId !== command.sourceStoreId || receipt.authorityEpoch !== command.authorityEpoch || !receipt.actorPrincipalId
        || receipt.eventId !== `native-document:${key}` || path.slice(path.lastIndexOf(sep) + 1) !== `native-${key}.json`
        || JSON.stringify(receipt.noteIds) !== JSON.stringify(nativeChangedNoteIds(command))
        || !value.changed || !['pending', 'accepted'].includes(value.changed.state)
        || (value.changed.state === 'accepted' && typeof value.changed.acceptedAt !== 'string')) throw new Error('Native document journal integrity mismatch')
      return value
    } catch (error) { if (isMissing(error)) return null; throw error }
  }

  private async recoverNativeJournals(deliverEvents = true): Promise<void> {
    for (const name of (await readdir(this.stateRoot)).filter(name => /^[a-f0-9]{64}$/.test(name)).sort()) {
      const directory = join(this.stateRoot, name)
      await this.ensureStateDirectory(directory)
      for (const entry of (await readdir(directory)).filter(name => /^native-[a-f0-9]{64}\.json$/.test(name)).sort()) {
        const path = join(directory, entry)
        const journal = await this.readNativeJournal(path)
        if (!journal || journal.phase === 'aborted') continue
        try { await this.assertNativeAuthorized(journal.receipt.actorPrincipalId, journal.command) }
        catch (error) {
          if (!(error instanceof MarkdownCommitError)) throw error
          // Keep fenced partial work durable. A different workspace/actor must
          // not reinterpret that unfinished transaction as an authorization.
          if (journal.phase === 'prepared') throw new MarkdownCommitError('rateLimited', 'Pending native document recovery requires its authorized source owner')
          continue
        }
        if (journal.phase === 'prepared') {
          try { await this.applyNativeJournal(path, journal) }
          catch (error) {
            if (!(error instanceof MarkdownCommitError) || error.kind !== 'conflict') throw error
            journal.phase = 'aborted'
            await this.atomicJson(path, journal)
            continue
          }
        }
        if (deliverEvents) await this.deliverNativeChanged(path, journal)
      }
    }
  }

  private async applyNativeJournal(path: string, journal: NativeJournal): Promise<void> {
    for (; journal.applied < journal.command.changes.length;) {
      await this.assertNativeAuthorized(journal.receipt.actorPrincipalId, journal.command)
      const change = journal.command.changes[journal.applied]
      if (!change) throw new Error('Native document cursor is corrupt')
      const current = change.kind === 'moveFolder' || change.kind === 'deleteFolder' ? await this.folderRevision(change.noteId) : await this.nativeRevision(change.noteId)
      const source = change.kind === 'moveFolder' || change.kind === 'deleteFolder' ? await this.folderPath(change.noteId) : await this.nativePath(change.noteId, change.kind === 'write')
      if (change.kind === 'write') {
        const targetRevision = markdownRevision(change.content)
        if (current !== targetRevision) {
          if (current !== change.expectedRevision) throw new MarkdownCommitError('conflict', 'note revision conflict', current ?? undefined)
          const temporary = `${source}.rox-${randomUUID()}.tmp`
          const handle = await open(temporary, 'wx', 0o600)
          try { await handle.writeFile(change.content, 'utf8'); await handle.sync() } finally { await handle.close() }
          try {
            await this.fault?.('beforeContentRename')
            await this.assertNativeAuthorized(journal.receipt.actorPrincipalId, journal.command)
            if (await this.nativeRevision(change.noteId) !== change.expectedRevision) throw new MarkdownCommitError('conflict', 'note revision conflict')
            if (change.expectedRevision === null) await link(temporary, source)
            else await rename(temporary, source)
            await this.syncDirectory(dirname(source))
          } finally { await unlink(temporary).catch(error => { if (!isMissing(error)) throw error }) }
        }
      } else if (change.kind === 'delete') {
        if (current !== null) {
          if (current !== change.expectedRevision) throw new MarkdownCommitError('conflict', 'note revision conflict', current)
          await unlink(source)
          await this.syncDirectory(dirname(source))
        }
      } else if (change.kind === 'deleteFolder') {
        const remaining = await this.folderSnapshot(change.noteId)
        if (remaining) {
          const originals = new Map(change.entries.map(entry => [entry.relativePath, JSON.stringify(entry)]))
          if (remaining.entries.some(entry => originals.get(entry.relativePath) !== JSON.stringify(entry))) throw new MarkdownCommitError('conflict', 'Native folder revision conflict')
          for (const entry of remaining.entries.filter(entry => entry.kind === 'file')) {
            await this.assertNativeAuthorized(journal.receipt.actorPrincipalId, journal.command)
            const path = join(source, entry.relativePath)
            if (entry.kind !== 'file' || `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}` !== entry.revision) throw new MarkdownCommitError('conflict', 'Native folder revision conflict')
            await unlink(path)
            await this.syncDirectory(dirname(path))
            await this.fault?.('afterNativeFolderEntry')
          }
          const directories = remaining.entries.filter(entry => entry.kind === 'directory').sort((a, b) => b.relativePath.split('/').length - a.relativePath.split('/').length)
          for (const entry of directories) { await rmdir(join(source, entry.relativePath)); await this.syncDirectory(dirname(join(source, entry.relativePath))) }
          await rmdir(source)
          await this.syncDirectory(dirname(source))
        }
      } else if (change.kind === 'moveFolder') {
        const target = await this.folderPath(change.targetNoteId, true)
        const targetRevision = await this.folderRevision(change.targetNoteId)
        if (current === null && targetRevision === change.expectedRevision) {
          // A directory rename is one atomic namespace transition.
        } else if (current === change.expectedRevision && targetRevision === null) {
          await this.assertNativeAuthorized(journal.receipt.actorPrincipalId, journal.command)
          if (await this.folderRevision(change.noteId) !== change.expectedRevision || await this.folderRevision(change.targetNoteId) !== null) throw new MarkdownCommitError('conflict', 'Native folder revision conflict')
          await rename(source, target)
          await this.syncDirectory(dirname(source))
          if (dirname(source) !== dirname(target)) await this.syncDirectory(dirname(target))
        } else throw new MarkdownCommitError('conflict', 'Native folder revision conflict')
      } else {
        const target = await this.nativePath(change.targetNoteId, true)
        const targetRevision = await this.nativeRevision(change.targetNoteId)
        if (current === null && targetRevision === change.expectedRevision) {
          // The durable target survived a crash after removing the source.
        } else if (current === change.expectedRevision && targetRevision === null) {
          await link(source, target)
          await this.syncDirectory(dirname(target))
          await unlink(source)
          await this.syncDirectory(dirname(source))
        } else if (current === change.expectedRevision && targetRevision === change.expectedRevision) {
          const [from, to] = await Promise.all([lstat(source), lstat(target)])
          if (from.dev !== to.dev || from.ino !== to.ino) throw new MarkdownCommitError('conflict', 'Native move target already exists')
          await unlink(source)
          await this.syncDirectory(dirname(source))
        } else throw new MarkdownCommitError('conflict', 'Native move revision conflict')
      }
      await this.fault?.('afterNativeChange')
      journal.applied++
      await this.atomicJson(path, journal)
    }
    journal.phase = 'committed'
    await this.atomicJson(path, journal)
    await this.fault?.('afterReceiptSync')
  }

  private async deliverNativeChanged(path: string, journal: NativeJournal): Promise<boolean> {
    if (journal.phase !== 'committed' || journal.changed.state !== 'pending' || !this.owner.changed) return false
    let eventId = journal.receipt.eventId
    try {
      await this.assertNativeAuthorized(journal.receipt.actorPrincipalId, journal.command)
      for (const noteId of journal.receipt.noteIds) {
        eventId = `${journal.receipt.eventId}:${digest(noteId)}`
        await this.owner.changed({ eventId, workspaceId: journal.command.workspaceId, noteId, reason: journal.command.reason })
      }
      await this.fault?.('afterChangedAccepted')
      journal.changed = { state: 'accepted', acceptedAt: new Date().toISOString() }
      await this.atomicJson(path, journal)
      return true
    } catch (error) {
      // Publication is already durable. An authorization/source failure here
      // cannot be reported as evidence that the submitted write did not occur.
      throw new MarkdownChangedDeliveryError(eventId, error)
    }
  }

  private async deliverChanged(path: string, journal: Journal): Promise<boolean> {
    if (journal.phase !== 'committed' || journal.changed?.state !== 'pending' || !this.owner.changed) return false
    try {
      await this.assertAuthorized(journal.receipt.actorPrincipalId, journal.command)
      if (await this.owner.authorityEpoch(journal.command) !== journal.command.authorityEpoch) throw new MarkdownCommitError('unknownFormat', 'Document authority changed')
      await this.owner.changed({ eventId: journal.receipt.eventId, workspaceId: journal.receipt.workspaceId, noteId: journal.receipt.noteId, reason: 'save' })
      await this.fault?.('afterChangedAccepted')
      journal.changed = { state: 'accepted', acceptedAt: new Date().toISOString() }
      await this.atomicJson(path, journal)
      return true
    } catch (error) { throw new MarkdownChangedDeliveryError(journal.receipt.eventId, error) }
  }

  private async assertAuthorized(actor: string, command: Pick<MarkdownCommitCommand, 'workspaceId' | 'noteId' | 'sourceStoreId'>, receiptLookupOnly = false): Promise<void> {
    if (!receiptLookupOnly && this.owner.requireSourceBinding && command.sourceStoreId === undefined) throw new MarkdownCommitError('unknownFormat', 'Document source binding is required')
    if (command.sourceStoreId !== undefined && await this.owner.sourceStoreId?.(command) !== command.sourceStoreId) throw new MarkdownCommitError('unknownFormat', 'Document source binding changed')
    if (!actor || !await this.owner.authorize(actor, command)) throw new MarkdownCommitError('denied', 'Document access denied')
  }

  private async ensureStateDirectory(directory: string): Promise<void> {
    const root = await realpath(this.root)
    let current = root
    for (const segment of ['.rox-docs', 'commits', relative(this.stateRoot, directory)]) {
      current = join(current, segment)
      try {
        const entry = await lstat(current)
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new MarkdownCommitError('denied', 'Document metadata path is not a native directory')
      } catch (error) {
        if (!isMissing(error)) throw error
        await mkdir(current, { mode: 0o700 }).catch(async failure => {
          if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure
          const entry = await lstat(current)
          if (!entry.isDirectory() || entry.isSymbolicLink()) throw new MarkdownCommitError('denied', 'Document metadata path changed')
        })
        await this.syncDirectory(dirname(current))
      }
      if (await realpath(current) !== current) throw new MarkdownCommitError('denied', 'Document metadata symlink access denied')
    }
  }

  private async notePath(noteId: string): Promise<string> {
    if (noteId.includes('\0') || noteId.includes('\\') || noteId.split('/').some(part => !part || part === '.' || part === '..')) throw new MarkdownCommitError('validation', 'Invalid note ID')
    const root = await realpath(this.root)
    const candidate = resolve(root, `${noteId}.md`)
    if (!candidate.startsWith(root + sep)) throw new MarkdownCommitError('validation', 'Invalid note path')
    let actual: string
    try { actual = await realpath(candidate) } catch (error) { if (isMissing(error)) throw new MarkdownCommitError('deleted', 'Document no longer exists'); throw error }
    if (!actual.startsWith(root + sep) || actual !== candidate) throw new MarkdownCommitError('denied', 'Document symlink access denied')
    // Journals belong to this native vault and must never be used to address other paths.
    if (relative(root, candidate).startsWith('.rox-docs' + sep)) throw new MarkdownCommitError('denied', 'Invalid document location')
    return candidate
  }

  private async readContent(path: string): Promise<string> {
    try {
      const bytes = await readFile(path)
      try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
      catch { throw new MarkdownCommitError('unknownFormat', 'Invalid UTF-8 source; preserve the original bytes') }
    } catch (error) { if (isMissing(error)) throw new MarkdownCommitError('deleted', 'Document no longer exists'); throw error }
  }

  private async readJournal(path: string): Promise<Journal | null> {
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as Journal
      if (value.schemaVersion !== 1 || !['prepared', 'committed', 'aborted'].includes(value.phase) || !value.receipt || !value.command) throw new Error('Unsupported or corrupt document journal')
      decodeMarkdownCommitCommand(value.command)
      if (value.fingerprint !== digest(JSON.stringify(value.command)) || value.receipt.revision !== markdownRevision(value.command.content)) throw new Error('Document journal integrity mismatch')
      if (value.changed && (!['pending', 'accepted'].includes(value.changed.state) || (value.changed.state === 'accepted' && typeof value.changed.acceptedAt !== 'string'))) throw new Error('Document changed-event intent is corrupt')
      const receipt = value.receipt
      if (receipt.schemaVersion !== 1 || receipt.workspaceId !== value.command.workspaceId || receipt.noteId !== value.command.noteId
        || receipt.operationId !== value.command.operationId || receipt.authorityEpoch !== value.command.authorityEpoch
        || receipt.sourceStoreId !== value.command.sourceStoreId
        || receipt.previousRevision !== value.command.expectedRevision || !receipt.actorPrincipalId
        || receipt.eventId !== `document:${digest(`${receipt.actorPrincipalId}\0${receipt.operationId}`)}`
        || basenameWithoutExtension(path) !== digest(`${receipt.actorPrincipalId}\0${receipt.operationId}`)) throw new Error('Document journal identity mismatch')
      return value
    } catch (error) { if (isMissing(error)) return null; throw error }
  }

  private async recover(directory: string, file: string, deliverEvents = true): Promise<void> {
    for (const name of (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const path = join(directory, name)
      const journal = await this.readJournal(path)
      if (!journal || journal.phase !== 'prepared') continue
      const command = journal.command
      if (await this.notePath(command.noteId) !== file) throw new Error('Journal belongs to another document')
      const currentRevision = markdownRevision(await this.readContent(file))
      if (currentRevision === journal.receipt.revision) journal.phase = 'committed'
      else if (currentRevision === command.expectedRevision
        && await this.owner.authorize(journal.receipt.actorPrincipalId, command)
        && await this.owner.authorityEpoch(command) === command.authorityEpoch
        && (!this.owner.requireSourceBinding || command.sourceStoreId !== undefined)
        && (command.sourceStoreId === undefined || await this.owner.sourceStoreId?.(command) === command.sourceStoreId)) {
        await this.publishContent(file, journal)
        journal.phase = 'committed'
      } else journal.phase = 'aborted'
      await this.atomicJson(path, journal)
      if (deliverEvents) await this.deliverChanged(path, journal)
    }
  }

  private async publishContent(path: string, journal: Journal): Promise<void> {
    await this.assertAuthorized(journal.receipt.actorPrincipalId, journal.command)
    if (await this.owner.authorityEpoch(journal.command) !== journal.command.authorityEpoch) throw new MarkdownCommitError('unknownFormat', 'Document authority changed')
    const temporary = `${path}.rox-${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(journal.command.content, 'utf8'); await handle.sync() } finally { await handle.close() }
    try {
      await this.fault?.('beforeContentRename')
      await this.assertAuthorized(journal.receipt.actorPrincipalId, journal.command)
      if (await this.owner.authorityEpoch(journal.command) !== journal.command.authorityEpoch) throw new MarkdownCommitError('unknownFormat', 'Document authority changed')
      // Owner callbacks may yield while an external editor changes the file.
      // Read the exact byte revision after those checks, immediately before rename.
      if (markdownRevision(await this.readContent(path)) !== journal.command.expectedRevision) throw new MarkdownCommitError('conflict', 'note revision conflict')
      await rename(temporary, path)
      await this.syncDirectory(dirname(path))
    } finally { await unlink(temporary).catch(error => { if (!isMissing(error)) throw error }) }
  }

  private async atomicJson(path: string, value: Journal | NativeJournal): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync() } finally { await handle.close() }
    try { await rename(temporary, path); await this.syncDirectory(dirname(path)) }
    finally { await unlink(temporary).catch(error => { if (!isMissing(error)) throw error }) }
  }

  private async syncDirectory(path: string): Promise<void> {
    const directory = await open(path, 'r')
    try { await directory.sync() } finally { await directory.close() }
  }

  private async acquireLease(directory: string): Promise<() => Promise<void>> {
    const path = join(directory, 'writer.lock')
    const deadline = Date.now() + 10_000
    const token = randomUUID()
    while (true) {
      const releaseGate = await this.acquireClaimGate(directory, deadline)
      let acquired = false
      try {
        try {
          const lease = JSON.parse(await readFile(path, 'utf8')) as { pid: number }
          if (!Number.isSafeInteger(lease.pid) || lease.pid < 1) throw new Error('Corrupt document lease')
          try { process.kill(lease.pid, 0) } catch (failure) {
            if ((failure as NodeJS.ErrnoException).code === 'ESRCH') await unlink(path)
            else throw failure
          }
        } catch (failure) { if (!isMissing(failure)) throw failure }
        try {
          await this.publishLease(path, token)
          acquired = true
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      } finally { await releaseGate() }
      if (acquired) {
        return async () => {
          const release = await this.acquireClaimGate(directory, Date.now() + 10_000)
          try {
            const lease = JSON.parse(await readFile(path, 'utf8')) as { token: string }
            if (lease.token !== token) throw new Error('Document lease ownership changed')
            await unlink(path)
          } finally { await release() }
        }
      }
      if (Date.now() >= deadline) throw new MarkdownCommitError('rateLimited', 'Document writer is busy')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  /** Serializes lease creation/reclamation so a contender cannot unlink its successor. */
  private async acquireClaimGate(directory: string, deadline: number): Promise<() => Promise<void>> {
    const path = join(directory, 'claim.lock')
    const token = randomUUID()
    while (true) {
      try {
        await this.publishLease(path, token)
        await this.fault?.('afterClaimSync')
        return async () => {
          const lease = JSON.parse(await readFile(path, 'utf8')) as { token: string }
          if (lease.token !== token) throw new Error('Document claim ownership changed')
          await unlink(path)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const observed = await this.readLease(path)
        if (observed && this.writerStopped(observed.pid) && await this.claimRecovery(directory, observed.token)) {
          // An immutable recovery chain elects one living reclaimer for this
          // exact dead generation. A successor has a different token and cannot
          // be removed by a contender still holding the old generation's grant.
          const current = await this.readLease(path)
          if (current?.token === observed.token && this.writerStopped(current.pid)) await unlink(path)
          continue
        }
        if (Date.now() >= deadline) throw new MarkdownCommitError('rateLimited', 'Document claim requires recovery')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  private writerStopped(pid: number): boolean {
    try { process.kill(pid, 0); return false }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error }
  }

  private async readLease(path: string): Promise<{ pid: number; token: string } | null> {
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!value || typeof value !== 'object' || !('pid' in value) || !('token' in value)
        || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid < 1
        || typeof value.token !== 'string' || !/^[a-f0-9-]{36}$/.test(value.token)) throw new Error('Corrupt document lease')
      return { pid: value.pid, token: value.token }
    } catch (error) { if (isMissing(error)) return null; throw error }
  }

  /** Publishes only a fully synced owner record, so process death cannot leave a partial lock. */
  private async publishLease(path: string, token: string): Promise<void> {
    const temporary = `${path}.${token}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync() } finally { await handle.close() }
    try { await link(temporary, path); await this.syncDirectory(dirname(path)) }
    finally { await unlink(temporary).catch(error => { if (!isMissing(error)) throw error }) }
  }

  /** Recovery elections are immutable; a dead election owner gets its own next generation election. */
  private async claimRecovery(directory: string, stoppedToken: string): Promise<boolean> {
    const path = join(directory, `reclaim-${digest(stoppedToken)}.lock`)
    try { await this.publishLease(path, randomUUID()); return true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const previous = await this.readLease(path)
    if (!previous || !this.writerStopped(previous.pid)) return false
    return this.claimRecovery(directory, previous.token)
  }
}

const basenameWithoutExtension = (path: string): string => path.slice(path.lastIndexOf(sep) + 1, -5)

function decodeNativeCommand(value: unknown): NativeMarkdownWriteCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarkdownCommitError('validation', 'Invalid native write command')
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.changes) || raw.changes.length < 1 || raw.changes.length > 10_000
    || typeof raw.sourceStoreId !== 'string' || typeof raw.reason !== 'string' || !['save', 'create', 'rename', 'delete', 'asset', 'properties'].includes(raw.reason)) throw new MarkdownCommitError('validation', 'Invalid native write command')
  const envelope = decodeMarkdownCommitCommand({ ...raw, noteId: 'native-envelope', expectedRevision: markdownRevision(''), content: '' })
  const changes: NativeMarkdownChange[] = raw.changes.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarkdownCommitError('validation', 'Invalid native write change')
    const change = value as Record<string, unknown>
    if (typeof change.kind !== 'string' || !['write', 'move', 'moveFolder', 'delete', 'deleteFolder'].includes(change.kind)) throw new MarkdownCommitError('validation', 'Invalid native write kind')
    const decoded = decodeMarkdownCommitCommand({ ...envelope, noteId: change.noteId,
      expectedRevision: change.kind === 'write' && change.expectedRevision === null ? markdownRevision('') : change.expectedRevision,
      content: change.kind === 'write' ? change.content : '' })
    if (change.kind === 'write') return { kind: 'write', noteId: decoded.noteId, expectedRevision: change.expectedRevision === null ? null : decoded.expectedRevision, content: decoded.content }
    if (change.kind === 'delete') return { kind: 'delete', noteId: decoded.noteId, expectedRevision: decoded.expectedRevision }
    if (change.kind === 'deleteFolder') {
      if (!Array.isArray(change.entries) || change.entries.length > 100_000 || !Array.isArray(change.noteIds)) throw new MarkdownCommitError('validation', 'Invalid native folder snapshot')
      const entries: NativeFolderEntry[] = change.entries.map((value: unknown) => {
        if (!value || typeof value !== 'object' || !('relativePath' in value) || typeof value.relativePath !== 'string'
          || value.relativePath.includes('\\') || value.relativePath.includes('\0') || value.relativePath.split('/').some(part => !part || part === '.' || part === '..') || !('kind' in value)) throw new MarkdownCommitError('validation', 'Invalid native folder entry')
        if (value.kind === 'directory') return { kind: 'directory', relativePath: value.relativePath }
        if (value.kind !== 'file' || !('revision' in value) || typeof value.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.revision)) throw new MarkdownCommitError('validation', 'Invalid native folder entry')
        return { kind: 'file', relativePath: value.relativePath, revision: value.revision }
      })
      const noteIds = change.noteIds.map((noteId: unknown) => decodeMarkdownCommitCommand({ ...decoded, noteId }).noteId)
      if (markdownRevision(JSON.stringify(entries)) !== decoded.expectedRevision || JSON.stringify(noteIds) !== JSON.stringify(entries.filter(entry => entry.kind === 'file' && entry.relativePath.toLowerCase().endsWith('.md')).map(entry => `${decoded.noteId}/${entry.relativePath.slice(0, -3)}`))) throw new MarkdownCommitError('validation', 'Invalid native folder snapshot revision')
      return { kind: 'deleteFolder', noteId: decoded.noteId, expectedRevision: decoded.expectedRevision, entries, noteIds }
    }
    const target = decodeMarkdownCommitCommand({ ...decoded, noteId: change.targetNoteId })
    if (target.noteId === decoded.noteId) throw new MarkdownCommitError('validation', 'Native move requires a different target')
    if (change.kind === 'moveFolder') {
      if (!Array.isArray(change.noteIds) || change.noteIds.length > 10_000 || target.noteId.startsWith(decoded.noteId + '/') || decoded.noteId.startsWith(target.noteId + '/')) throw new MarkdownCommitError('validation', 'Invalid native folder move')
      const noteIds = change.noteIds.map((noteId: unknown) => decodeMarkdownCommitCommand({ ...decoded, noteId }).noteId)
      if (noteIds.some(id => !id.startsWith(decoded.noteId + '/')) || new Set(noteIds).size !== noteIds.length) throw new MarkdownCommitError('validation', 'Invalid native folder note set')
      return { kind: 'moveFolder', noteId: decoded.noteId, targetNoteId: target.noteId, expectedRevision: decoded.expectedRevision, noteIds }
    }
    return { kind: 'move', noteId: decoded.noteId, targetNoteId: target.noteId, expectedRevision: decoded.expectedRevision }
  })
  return { workspaceId: envelope.workspaceId, operationId: envelope.operationId, authorityEpoch: envelope.authorityEpoch,
    sourceStoreId: raw.sourceStoreId, reason: raw.reason as MarkdownChangedEvent['reason'], changes }
}

function nativeChangedNoteIds(command: NativeMarkdownWriteCommand): string[] {
  return [...new Set(command.changes.flatMap(change => change.kind === 'moveFolder'
    ? change.noteIds.length > 0 ? change.noteIds.map(id => `${change.targetNoteId}/${id.slice(change.noteId.length + 1)}`) : [change.targetNoteId]
    : change.kind === 'deleteFolder' ? change.noteIds.length > 0 ? change.noteIds : [change.noteId]
    : change.kind === 'move' ? [change.targetNoteId] : [change.noteId]))]
}
