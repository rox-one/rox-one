import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeAuthority } from '../native-authority.ts'
import { NativeJournal, NativeJournalError, type JournalMutation } from '../native-journal.ts'

const roots: string[] = []
const authorities: NativeAuthority[] = []
const journals: NativeJournal[] = []
let stdinDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
})

afterEach(() => {
  for (const journal of journals.splice(0)) journal.close()
  for (const authority of authorities.splice(0)) authority.close()
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
  if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
})

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'native-journal-')))
  roots.push(base)
  const stateDir = join(base, 'state')
  const nativeRoot = join(base, 'native')
  const entityRoot = join(base, 'entities')
  mkdirSync(nativeRoot)
  mkdirSync(entityRoot)
  const authority = new NativeAuthority({ stateDir })
  authorities.push(authority)
  const admin = authority.bootstrapLocalAdministrator('operator')
  const workspace = authority.registerWorkspace(admin.credential, 'workspace-1', nativeRoot, [entityRoot])
  const ticket = authority.issueEnrollment(admin.credential, 'test-device', Date.now() + 60_000)
  const issued = authority.redeemEnrollment(ticket, 'test-device')
  if (!issued) throw new Error('expected test enrollment')
  const principal = authority.authenticate(issued.credential)
  if (!principal) throw new Error('expected authenticated test principal')
  authority.grantWorkspace(admin.credential, principal.subject, workspace.id, ['read', 'write', 'delete', 'subscribe'])
  const open = () => {
    const journal = new NativeJournal({
      stateDir,
      authorize: (subject, workspaceId, action, rootPath) => authority.authorize(subject, workspaceId, action, rootPath),
      permissionFence: (subject, workspaceId, action) => authority.permissionFence(subject, workspaceId, action),
      authorizePreparedRecovery: (actor, workspaceId, action, expectedFence, rootPath) => authority.authorizePreparedRecovery(actor, workspaceId, action, expectedFence, rootPath),
    })
    journals.push(journal)
    return journal
  }

  const mutation = (overrides: Partial<JournalMutation> = {}): JournalMutation => ({
    principal,
    workspaceId: workspace.id,
    nativeRoot,
    kind: 'note',
    nativeId: 'note-1',
    operationId: 'op-1',
    expectedRevision: null,
    schemaVersion: 1,
    changes: [{ path: 'notes/note.md', content: '# Private body' }],
    ...overrides,
  })
  return { base, stateDir, nativeRoot, entityRoot, authority, admin, workspace, principal, credential: issued.credential, adminCredential: admin.credential, workspaceId: workspace.id, subject: principal.subject, open, mutation }
}

type CrashEnvironment = { stateDir: string; nativeRoot: string; credential: string; adminCredential: string; workspaceId: string; subject: string }
type ChildCrashResult = { status: number | null; stderr: string }

function crashMutationInChild(
  env: CrashEnvironment,
  mutation: JournalMutation,
  boundary: 'after-prepare' | 'after-replacement' | 'revoke-after-replacement',
): ChildCrashResult {
  const { principal: _principal, ...payload } = mutation
  const script = `
    import { mock } from 'bun:test'
    import { createRequire } from 'node:module'
    const fs = createRequire(import.meta.url)('node:fs')
    const nativeRoot = process.env.NATIVE_ROOT
    let revoked = false
    let revokeAuthorization = () => {}
    if (process.env.CRASH_BOUNDARY === 'after-prepare') {
      const openSync = fs.openSync
      fs.openSync = function(path, ...args) {
        if (String(path).startsWith(nativeRoot + '/') && String(path).includes('.journal-')) process.exit(71)
        return openSync.call(this, path, ...args)
      }
    } else {
      const renameSync = fs.renameSync
      fs.renameSync = function(source, target, ...args) {
        const result = renameSync.call(this, source, target, ...args)
        if (String(source).startsWith(nativeRoot + '/') && String(source).includes('.journal-') && String(target).startsWith(nativeRoot + '/') && !revoked) {
          if (process.env.CRASH_BOUNDARY === 'revoke-after-replacement') {
            revokeAuthorization()
            revoked = true
          } else {
            process.exit(72)
          }
        }
        return result
      }
    }
    mock.module('node:fs', () => fs)
    ;(async () => {
      const { NativeAuthority } = await import(process.env.AUTHORITY_MODULE)
      const { NativeJournal } = await import(process.env.JOURNAL_MODULE)
      const authority = new NativeAuthority({ stateDir: process.env.STATE_DIR })
      const principal = authority.authenticate(process.env.CREDENTIAL)
      if (!principal) process.exit(73)
      if (process.env.CRASH_BOUNDARY === 'revoke-after-replacement') {
        const revoker = new NativeAuthority({ stateDir: process.env.STATE_DIR })
        revokeAuthorization = () => {
          revoker.revokeWorkspaceGrant(process.env.ADMIN_CREDENTIAL, process.env.SUBJECT, process.env.WORKSPACE_ID)
        }
      }
      const journal = new NativeJournal({
        stateDir: process.env.STATE_DIR,
        authorize: (actor, workspaceId, action, root) => authority.authorize(actor, workspaceId, action, root),
        permissionFence: (actor, workspaceId, action) => authority.permissionFence(actor, workspaceId, action),
        authorizePreparedRecovery: (actor, workspaceId, action, fence, root) => authority.authorizePreparedRecovery(actor, workspaceId, action, fence, root),
      })
      try {
        journal.mutate({ ...JSON.parse(process.env.MUTATION), principal })
      } catch (error) {
        if (process.env.CRASH_BOUNDARY === 'revoke-after-replacement' && revoked && error && error.code === 'UNAUTHORIZED') process.exit(76)
        throw error
      }
      process.stderr.write('crash instrumentation was not reached at the requested boundary')
      process.exit(75)
    })().catch((error) => {
      const diagnostic = error instanceof Error ? error.name + ': ' + error.message : 'unknown child failure'
      process.stderr.write(diagnostic)
      process.exit(74)
    })
  `
  const childScript = join(import.meta.dir, `.native-journal-crash-${randomUUID()}.ts`)
  writeFileSync(childScript, script)
  try {
    const result = spawnSync(process.execPath, [childScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTHORITY_MODULE: new URL('../native-authority.ts', import.meta.url).href,
        JOURNAL_MODULE: new URL('../native-journal.ts', import.meta.url).href,
        STATE_DIR: env.stateDir,
        NATIVE_ROOT: env.nativeRoot,
        CREDENTIAL: env.credential,
        ADMIN_CREDENTIAL: env.adminCredential,
        WORKSPACE_ID: env.workspaceId,
        SUBJECT: env.subject,
        MUTATION: JSON.stringify(payload),
        CRASH_BOUNDARY: boundary,
      },
    })
    return { status: result.status, stderr: result.stderr || result.error?.message || '' }
  } finally {
    rmSync(childScript, { force: true })
  }
}

function codeOf(run: () => unknown, code: NativeJournalError['code']): void {
  try {
    run()
    throw new Error(`expected journal error ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(NativeJournalError)
    expect((error as NativeJournalError).code).toBe(code)
  }
}

describe('NativeJournal', () => {
  test('commits bytes and immutable receipt across restart; retry is authorized and digest-bound', () => {
    const env = setup()
    const journal = env.open()
    const committed = journal.mutate(env.mutation())
    expect(readFileSync(join(env.nativeRoot, 'notes/note.md'), 'utf8')).toBe('# Private body')
    expect(JSON.stringify(committed)).not.toContain('# Private body')
    journal.close()

    const reopened = env.open()
    expect(reopened.readReceipt(env.principal, env.workspace.id, 'op-1')).toEqual(committed)
    expect(reopened.pullReceipts(env.principal, env.workspace.id, 0)).toEqual([committed])
    expect(reopened.mutate(env.mutation())).toEqual(committed)
    codeOf(() => reopened.mutate(env.mutation({ changes: [{ path: 'notes/note.md', content: 'different' }] })), 'OPERATION_ID_REUSED')
    env.authority.revokeWorkspaceGrant(env.admin.credential, env.principal.subject, env.workspace.id)
    codeOf(() => reopened.mutate(env.mutation()), 'UNAUTHORIZED')
    reopened.close()
  })
  test('reads only authorized canonical entity files and fails closed on external byte changes', () => {
    const env = setup()
    const journal = env.open()
    const receipt = journal.mutate(env.mutation({
      changes: [
        { path: 'notes/note.md', content: '# Private body' },
        { path: 'notes/metadata.json', content: '{"kind":"note"}' },
      ],
    }))
    expect(journal.readEntity(env.principal, env.workspace.id, 'note', 'note-1')).toEqual({
      workspaceId: env.workspace.id,
      kind: 'note',
      nativeId: 'note-1',
      revision: receipt.revision,
      contentHash: receipt.contentHash,
      deleted: false,
      files: [
        { path: 'notes/metadata.json', content: '{"kind":"note"}' },
        { path: 'notes/note.md', content: '# Private body' },
      ],
    })
    writeFileSync(join(env.nativeRoot, 'notes/note.md'), 'external replacement')
    codeOf(() => journal.readEntity(env.principal, env.workspace.id, 'note', 'note-1'), 'FOREIGN_CONTENT')
    journal.close()
  })

  test('pages changed identities by durable sequence without crossing workspace boundaries', () => {
    const env = setup()
    const otherRoot = join(env.base, 'other-native')
    mkdirSync(otherRoot)
    const otherWorkspace = env.authority.registerWorkspace(env.adminCredential, 'workspace-2', otherRoot)
    env.authority.grantWorkspace(env.adminCredential, env.principal.subject, otherWorkspace.id, ['read', 'write', 'delete', 'subscribe'])
    const journal = env.open()

    const first = journal.mutate(env.mutation())
    const second = journal.mutate(env.mutation({
      operationId: 'op-2',
      expectedRevision: first.revision,
      changes: [{ path: 'notes/note.md', content: '# Updated private body' }],
    }))
    const other = journal.mutate(env.mutation({
      workspaceId: otherWorkspace.id,
      nativeRoot: otherRoot,
      operationId: 'other-workspace-op',
      changes: [{ path: 'notes/note.md', content: 'other workspace body' }],
    }))

    const firstPage = journal.pullChanges(env.principal, env.workspace.id, 0, 1)
    expect(firstPage).toEqual({ changes: [first], nextSequence: first.sequence, hasMore: true })
    const secondPage = journal.pullChanges(env.principal, env.workspace.id, firstPage.nextSequence, 1)
    expect(secondPage).toEqual({ changes: [second], nextSequence: second.sequence, hasMore: false })
    expect(journal.pullChanges(env.principal, otherWorkspace.id, 0)).toEqual({
      changes: [other],
      nextSequence: other.sequence,
      hasMore: false,
    })
    expect(journal.readEntity(env.principal, env.workspace.id, 'note', 'note-1')?.files).toEqual([
      { path: 'notes/note.md', content: '# Updated private body' },
    ])
    expect(journal.readEntity(env.principal, otherWorkspace.id, 'note', 'note-1')?.files).toEqual([
      { path: 'notes/note.md', content: 'other workspace body' },
    ])
    codeOf(() => journal.pullChanges(env.principal, env.workspace.id, 0, 101), 'INVALID_INPUT')
    journal.close()
  })

  test('requires live read permission before inspecting or mutating native paths', () => {
    const env = setup()
    env.authority.revokeWorkspaceGrant(env.admin.credential, env.principal.subject, env.workspace.id)
    env.authority.grantWorkspace(env.admin.credential, env.principal.subject, env.workspace.id, ['write'])
    const journal = env.open()
    codeOf(() => journal.mutate(env.mutation()), 'UNAUTHORIZED')
    codeOf(() => journal.readEntity(env.principal, env.workspace.id, 'note', 'note-1'), 'UNAUTHORIZED')
    codeOf(() => journal.pullChanges(env.principal, env.workspace.id, 0), 'UNAUTHORIZED')
    expect(existsSync(join(env.nativeRoot, 'notes/note.md'))).toBe(false)
    const db = new DatabaseSync(join(env.stateDir, 'native-journal.sqlite'))
    expect(db.prepare('SELECT count(*) AS count FROM conflicts').get()).toEqual({ count: 0 })
    journal.close()
  })


  test('allows only explicitly registered additional entity roots for the same workspace', () => {
    const env = setup()
    const journal = env.open()
    const extraRootReceipt = journal.mutate(env.mutation({
      workspaceId: env.workspace.id,
      nativeRoot: env.entityRoot,
      kind: 'asset',
      nativeId: 'asset-1',
      operationId: 'asset-op',
      changes: [{ path: 'asset.json', content: '{"ok":true}' }],
    }))
    expect(extraRootReceipt.nativeId).toBe('asset-1')

    const foreignRoot = join(env.base, 'foreign-root')
    mkdirSync(foreignRoot)
    codeOf(() => journal.mutate(env.mutation({
      nativeRoot: foreignRoot,
      operationId: 'foreign-root-op',
      changes: [{ path: 'untouched.md', content: 'must not write' }],
    })), 'UNAUTHORIZED')
    expect(existsSync(join(foreignRoot, 'untouched.md'))).toBe(false)
    journal.close()
  })
  test('supports adding a file to an existing entity without treating the new path as a stale edit', () => {
    const env = setup()
    const journal = env.open()
    const created = journal.mutate(env.mutation())
    const updated = journal.mutate(env.mutation({
      operationId: 'add-file',
      expectedRevision: created.revision,
      changes: [
        { path: 'notes/note.md', content: '# Updated note' },
        { path: 'notes/metadata.json', content: '{"kind":"note"}' },
      ],
    }))
    expect(updated.revision).toBe(2)
    expect(readFileSync(join(env.nativeRoot, 'notes/note.md'), 'utf8')).toBe('# Updated note')
    expect(readFileSync(join(env.nativeRoot, 'notes/metadata.json'), 'utf8')).toBe('{"kind":"note"}')
    const renamed = journal.mutate(env.mutation({
      operationId: 'rename-file',
      expectedRevision: updated.revision,
      changes: [
        { path: 'notes/note.md', content: null },
        { path: 'notes/renamed.md', content: '# Updated note' },
      ],
    }))
    expect(renamed.revision).toBe(3)
    expect(existsSync(join(env.nativeRoot, 'notes/note.md'))).toBe(false)
    expect(readFileSync(join(env.nativeRoot, 'notes/renamed.md'), 'utf8')).toBe('# Updated note')
    expect(readFileSync(join(env.nativeRoot, 'notes/metadata.json'), 'utf8')).toBe('{"kind":"note"}')
    const releasedPath = journal.mutate(env.mutation({
      kind: 'asset',
      nativeId: 'asset-after-rename',
      operationId: 'claim-released-path',
      changes: [{ path: 'notes/note.md', content: 'new entity owns released path' }],
    }))
    expect(releasedPath.revision).toBe(1)
    expect(readFileSync(join(env.nativeRoot, 'notes/note.md'), 'utf8')).toBe('new entity owns released path')
    journal.close()
  })

  test('binds each entity to one root and prevents a second entity from claiming a tracked path', () => {
    const env = setup()
    const journal = env.open()
    const created = journal.mutate(env.mutation())
    mkdirSync(join(env.entityRoot, 'notes'))
    writeFileSync(join(env.entityRoot, 'notes/note.md'), '# Private body')
    codeOf(() => journal.mutate(env.mutation({
      operationId: 'switch-root',
      expectedRevision: created.revision,
      nativeRoot: env.entityRoot,
      changes: [{ path: 'notes/note.md', content: '# Private body' }],
    })), 'INVALID_INPUT')
    codeOf(() => journal.mutate(env.mutation({
      operationId: 'claim-owned-path',
      kind: 'asset',
      nativeId: 'asset-1',
      changes: [{ path: 'notes/note.md', content: 'must not replace the note' }],
    })), 'PATH_OWNED')
    expect(readFileSync(join(env.nativeRoot, 'notes/note.md'), 'utf8')).toBe('# Private body')
    journal.close()
  })
  test('reserves paths during a prepared mutation against a concurrent distinct identity', () => {
    const env = setup()
    const journal = env.open()
    const preparedMutation = env.mutation({
      changes: [{ path: 'reserved/shared.txt', content: 'prepared owner bytes' }],
    })
    expect(crashMutationInChild(env, preparedMutation, 'after-prepare')).toEqual({ status: 71, stderr: '' })
    codeOf(() => journal.readEntity(env.principal, env.workspace.id, 'note', 'note-1'), 'RECOVERY_REQUIRED')
    codeOf(() => journal.mutate(env.mutation({
      kind: 'asset',
      nativeId: 'competing-asset',
      operationId: 'competing-path-claim',
      changes: [{ path: 'reserved/shared.txt', content: 'competing owner bytes' }],
    })), 'PATH_OWNED')
    expect(existsSync(join(env.nativeRoot, 'reserved/shared.txt'))).toBe(false)
    journal.close()

    const recovered = env.open()
    expect(recovered.readReceipt(env.principal, env.workspace.id, 'op-1')?.revision).toBe(1)
    expect(readFileSync(join(env.nativeRoot, 'reserved/shared.txt'), 'utf8')).toBe('prepared owner bytes')
    recovered.close()
  })

  test('rejects a moved and replaced canonical workspace root without touching either directory', () => {
    const env = setup()
    const journal = env.open()
    const created = journal.mutate(env.mutation())
    const movedRoot = join(env.base, 'moved-native')
    renameSync(env.nativeRoot, movedRoot)
    mkdirSync(env.nativeRoot)

    codeOf(() => journal.mutate(env.mutation({
      operationId: 'moved-root-write',
      expectedRevision: created.revision,
      changes: [{ path: 'notes/note.md', content: 'must not cross root identity' }],
    })), 'UNAUTHORIZED')
    codeOf(() => journal.readEntity(env.principal, env.workspace.id, 'note', 'note-1'), 'UNAUTHORIZED')
    expect(readFileSync(join(movedRoot, 'notes/note.md'), 'utf8')).toBe('# Private body')
    expect(existsSync(join(env.nativeRoot, 'notes/note.md'))).toBe(false)
    journal.close()
  })



  test('stale expected revision preserves an external edit and stores both conflict versions', () => {
    const env = setup()
    const journal = env.open()
    journal.mutate(env.mutation())
    writeFileSync(join(env.nativeRoot, 'notes/note.md'), 'external version')
    let conflictId = ''
    try {
      journal.mutate(env.mutation({ operationId: 'op-2', expectedRevision: 1, changes: [{ path: 'notes/note.md', content: 'competing version' }] }))
      throw new Error('expected CAS conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(NativeJournalError)
      const conflict = (error as NativeJournalError).conflict
      expect((error as NativeJournalError).code).toBe('CONFLICT')
      expect(conflict?.conflictId).toBeTruthy()
      conflictId = conflict!.conflictId
      expect(conflict?.currentHashes[0]?.hash).toBeTruthy()
      expect(conflict?.proposedHashes[0]?.hash).toBeTruthy()
    }
    expect(readFileSync(join(env.nativeRoot, 'notes/note.md'), 'utf8')).toBe('external version')
    const db = new DatabaseSync(join(env.stateDir, 'native-journal.sqlite'))
    const row = db.prepare('SELECT versions_dir FROM conflicts WHERE conflict_id=?').get(conflictId) as { versions_dir: string }
    db.close()
    const versionDir = join(env.stateDir, row.versions_dir)
    const versions = readdirSync(versionDir).map((name) => readFileSync(join(versionDir, name), 'utf8'))
    expect(versions).toContain('external version')
    expect(versions).toContain('competing version')
    journal.close()
  })

  test('delete receipt and tombstone survive reopen and reject stale recreation', () => {
    const env = setup()
    const journal = env.open()
    const created = journal.mutate(env.mutation())
    const deleted = journal.mutate(env.mutation({
      operationId: 'delete-1',
      expectedRevision: created.revision,
      changes: [{ path: 'notes/note.md', content: null }],
    }))
    expect(deleted.deleted).toBe(true)
    journal.close()
    const reopened = env.open()
    expect(reopened.readReceipt(env.principal, env.workspace.id, 'delete-1')).toEqual(deleted)
    expect(reopened.readEntity(env.principal, env.workspace.id, 'note', 'note-1')).toEqual({
      workspaceId: env.workspace.id,
      kind: 'note',
      nativeId: 'note-1',
      revision: deleted.revision,
      contentHash: deleted.contentHash,
      deleted: true,
      files: [],
    })
    codeOf(() => reopened.mutate(env.mutation({ operationId: 'stale-create', expectedRevision: null })), 'TOMBSTONED')
    codeOf(() => reopened.mutate(env.mutation({ operationId: 'revision-recreate', expectedRevision: deleted.revision })), 'TOMBSTONED')
    reopened.close()
  })

  test('prepared and partially replaced transactions recover before issuing a receipt', () => {
    for (const boundary of ['after-prepare', 'after-replacement'] as const) {
      const env = setup()
      const changes = [
        { path: 'a/one.txt', content: 'first bytes' },
        { path: 'b/two.txt', content: 'second bytes' },
      ]
      expect(crashMutationInChild(env, env.mutation({ changes }), boundary)).toEqual({ status: boundary === 'after-prepare' ? 71 : 72, stderr: '' })
      const recovered = env.open()
      const receipt = recovered.readReceipt(env.principal, env.workspace.id, 'op-1')
      expect(receipt?.revision).toBe(1)
      expect(readFileSync(join(env.nativeRoot, 'a/one.txt'), 'utf8')).toBe('first bytes')
      expect(readFileSync(join(env.nativeRoot, 'b/two.txt'), 'utf8')).toBe('second bytes')
      recovered.close()
    }
  })
  test('rolls back prepared bytes when recovery authorization fence was revoked and permanently aborts the operation', () => {
    const env = setup()
    const initial = env.open()
    const first = initial.mutate(env.mutation())
    initial.close()
    const nextMutation = env.mutation({
      operationId: 'op-2',
      expectedRevision: first.revision,
      changes: [{ path: 'notes/note.md', content: 'prepared second version' }],
    })
    expect(crashMutationInChild(env, nextMutation, 'after-replacement')).toEqual({ status: 72, stderr: '' })
    env.authority.revokeWorkspaceGrant(env.admin.credential, env.principal.subject, env.workspace.id)
    const rolledBack = env.open()
    expect(readFileSync(join(env.nativeRoot, 'notes/note.md'), 'utf8')).toBe('# Private body')
    env.authority.grantWorkspace(env.admin.credential, env.principal.subject, env.workspace.id, ['read', 'write', 'delete'])
    expect(rolledBack.readReceipt(env.principal, env.workspace.id, 'op-2')).toBeNull()
    codeOf(() => rolledBack.mutate(nextMutation), 'PREPARED_ABORTED')
    rolledBack.close()
  })
  test('rejects recovery when an unchanged tracked file was externally edited after prepare', () => {
    const env = setup()
    const journal = env.open()
    const first = journal.mutate(env.mutation({
      changes: [
        { path: 'a/one.txt', content: 'committed one' },
        { path: 'b/two.txt', content: 'committed two' },
      ],
    }))
    const next = env.mutation({
      operationId: 'op-2',
      expectedRevision: first.revision,
      changes: [{ path: 'a/one.txt', content: 'prepared one' }],
    })
    expect(crashMutationInChild(env, next, 'after-prepare')).toEqual({ status: 71, stderr: '' })
    writeFileSync(join(env.nativeRoot, 'b/two.txt'), 'external untouched-path edit')
    codeOf(() => journal.recover(), 'FOREIGN_CONTENT')
    expect(readFileSync(join(env.nativeRoot, 'a/one.txt'), 'utf8')).toBe('committed one')
    expect(readFileSync(join(env.nativeRoot, 'b/two.txt'), 'utf8')).toBe('external untouched-path edit')
    const db = new DatabaseSync(join(env.stateDir, 'native-journal.sqlite'))
    expect(db.prepare('SELECT count(*) AS count FROM receipts WHERE operation_id=?').get('op-2')).toEqual({ count: 0 })
    db.close()
    journal.close()
  })

  test('rolls back immediately when a second authority connection revokes access during replacement', () => {
    const env = setup()
    const journal = env.open()
    const first = journal.mutate(env.mutation())
    const next = env.mutation({
      operationId: 'op-2',
      expectedRevision: first.revision,
      changes: [{ path: 'notes/note.md', content: 'replacement to roll back' }],
    })
    expect(crashMutationInChild(env, next, 'revoke-after-replacement')).toEqual({ status: 76, stderr: '' })
    expect(readFileSync(join(env.nativeRoot, 'notes/note.md'), 'utf8')).toBe('# Private body')
    env.authority.grantWorkspace(env.admin.credential, env.principal.subject, env.workspace.id, ['read', 'write', 'delete'])
    expect(journal.readReceipt(env.principal, env.workspace.id, 'op-2')).toBeNull()
    codeOf(() => journal.mutate(next), 'PREPARED_ABORTED')
    journal.close()
  })



  test('rejects an unversioned pre-root journal without inventing root ownership metadata', () => {
    const env = setup()
    const path = join(env.stateDir, 'native-journal.sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE entities (entity_key TEXT PRIMARY KEY, issuer TEXT NOT NULL, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, native_id TEXT NOT NULL, subject TEXT NOT NULL, revision INTEGER NOT NULL, content_hash TEXT NOT NULL, deleted INTEGER NOT NULL);
      CREATE TABLE entity_files (entity_key TEXT NOT NULL, path TEXT NOT NULL, file_hash TEXT, PRIMARY KEY(entity_key, path));
      INSERT INTO entities VALUES ('legacy-entity', 'issuer', 'workspace', 'note', 'note-1', 'subject', 1, 'hash', 0);
      INSERT INTO entity_files VALUES ('legacy-entity', 'note.md', 'file-hash');
    `)
    legacy.close()

    codeOf(() => env.open(), 'UNSUPPORTED_SCHEMA')

    const db = new DatabaseSync(path)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
    expect((db.prepare('PRAGMA table_info(entities)').all() as Array<{ name: string }>).some(({ name }) => name === 'native_root')).toBe(false)
    expect(db.prepare('SELECT count(*) AS count FROM entity_files').get()).toEqual({ count: 1 })
    db.close()
  })
  test('rejects versioned journals missing root columns', () => {
    const env = setup()
    const path = join(env.stateDir, 'native-journal.sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE entities (entity_key TEXT PRIMARY KEY);
      CREATE TABLE entity_files (entity_key TEXT NOT NULL, path TEXT NOT NULL);
      PRAGMA user_version=1;
    `)
    legacy.close()

    codeOf(() => env.open(), 'UNSUPPORTED_SCHEMA')

    const db = new DatabaseSync(path)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect((db.prepare('PRAGMA table_info(entity_files)').all() as Array<{ name: string }>).some(({ name }) => name === 'native_root')).toBe(false)
    db.close()
  })

  test('rejects versioned rows with empty root ownership metadata', () => {
    const env = setup()
    const path = join(env.stateDir, 'native-journal.sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE entities (entity_key TEXT PRIMARY KEY, native_root TEXT NOT NULL);
      CREATE TABLE entity_files (entity_key TEXT NOT NULL, native_root TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(entity_key, path));
      INSERT INTO entities VALUES ('legacy-entity', '');
      INSERT INTO entity_files VALUES ('legacy-entity', '', 'note.md');
      PRAGMA user_version=1;
    `)
    legacy.close()

    codeOf(() => env.open(), 'UNSUPPORTED_SCHEMA')

    const db = new DatabaseSync(path)
    expect(db.prepare("SELECT native_root FROM entities WHERE entity_key='legacy-entity'").get()).toEqual({ native_root: '' })
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    db.close()
  })


  test('rejects unsupported schemas, unsafe paths, and symlink traversal without changing bytes', () => {
    const env = setup()
    const journal = env.open()
    codeOf(() => journal.mutate(env.mutation({ schemaVersion: 2 })), 'UNSUPPORTED_SCHEMA')
    codeOf(() => journal.mutate(env.mutation({ changes: [{ path: '../outside', content: 'bad' }] })), 'INVALID_INPUT')
    const outside = join(env.base, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'file.md'), 'untouched')
    symlinkSync(outside, join(env.nativeRoot, 'link'))
    codeOf(() => journal.mutate(env.mutation({ changes: [{ path: 'link/file.md', content: 'overwrite' }] })), 'INVALID_INPUT')
    expect(readFileSync(join(outside, 'file.md'), 'utf8')).toBe('untouched')
    journal.close()
  })

  test('database stores hashes and metadata but not canonical document bytes', () => {
    const env = setup()
    const body = 'credential-shaped-secret-do-not-persist'
    const journal = env.open()
    journal.mutate(env.mutation({ changes: [{ path: 'private.md', content: body }] }))
    journal.close()
    const db = new DatabaseSync(join(env.stateDir, 'native-journal.sqlite'))
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(1)
    db.close()
    expect(readFileSync(join(env.stateDir, 'native-journal.sqlite')).includes(Buffer.from(body))).toBe(false)
  })
})
