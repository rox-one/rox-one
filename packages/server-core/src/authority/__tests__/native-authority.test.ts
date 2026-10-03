import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from '@craft-agent/shared/utils/sqlite-runtime'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCredentialToken, NativeAuthority } from '../native-authority.ts'
import { runLocalMaintenanceCommand } from '../local-maintenance.ts'

const roots: string[] = []
const authorities: NativeAuthority[] = []
let stdinDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
})

function setup() {
  const requestedStateDir = mkdtempSync(join(tmpdir(), 'native-authority-test-'))
  roots.push(requestedStateDir)
  const stateDir = realpathSync(requestedStateDir)
  const authority = new NativeAuthority({ stateDir })
  authorities.push(authority)
  return { stateDir, authority }
}

afterEach(() => {
  for (const authority of authorities.splice(0)) authority.close()
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
  if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
})

describe('native authority', () => {
  test('issues distinct subjects, authenticates server principals, and survives reopen', () => {
    const { stateDir, authority } = setup()
    const admin = authority.bootstrapLocalAdministrator('operator')
    const root = join(stateDir, 'workspace')
    mkdirSync(root)
    const workspace = authority.registerWorkspace(admin.credential, 'workspace-a', root)
    const firstTicket = authority.issueEnrollment(admin.credential, 'laptop', Date.now() + 60_000)
    const secondTicket = authority.issueEnrollment(admin.credential, 'tablet', Date.now() + 60_000)
    const first = authority.redeemEnrollment(firstTicket, 'laptop')
    const second = authority.redeemEnrollment(secondTicket, 'tablet')
    if (!first || !second) throw new Error('expected issued credentials')
    const principal = authority.authenticate(first.credential)
    if (!principal) throw new Error('expected authenticated principal')
    authority.grantWorkspace(admin.credential, principal.subject, workspace.id, ['read'])
    const preparedFence = authority.permissionFence(principal, workspace.id, 'read')
    if (!preparedFence) throw new Error('expected permission fence')

    expect(principal.subject).not.toBe(second.principal.subject)
    expect(authority.authorize(principal, workspace.id, 'read')).toBe(true)
    expect(authority.authorize({ ...principal }, workspace.id, 'read')).toBe(false)
    expect(authority.permissionFence({ ...principal }, workspace.id, 'read')).toBeNull()
    expect(authority.authorizePreparedRecovery({ ...principal }, workspace.id, 'read', preparedFence)).toBe(true)
    expect(authority.authenticate('unknown credential')).toBeNull()
    expect(authority.authenticate({ ...principal, subject: second.principal.subject } as unknown as string)).toBeNull()
    expect(authority.authorize(principal, workspace.id, 'write')).toBe(false)
    expect(isCredentialToken(first.credential)).toBe(true)
    expect(isCredentialToken('na_invalid')).toBe(true)
    expect(isCredentialToken('ne_invalid')).toBe(true)
    expect(isCredentialToken('legacy-global-token')).toBe(false)

    authority.close()
    const reopened = new NativeAuthority({ stateDir })
    authorities.push(reopened)
    expect(reopened.authenticate(first.credential)).toEqual(first.principal)
    expect(reopened.authenticate(second.credential)).toEqual(second.principal)
    expect(reopened.authorize(principal, workspace.id, 'read')).toBe(false)
    expect(statSync(stateDir).mode & 0o777).toBe(0o700)
    for (const file of readdirSync(stateDir).filter((name) => name.startsWith('authority.sqlite'))) {
      expect(statSync(join(stateDir, file)).mode & 0o777).toBe(0o600)
    }
    const durableDatabase = Buffer.concat(readdirSync(stateDir)
      .filter((file) => file.startsWith('authority.sqlite'))
      .map((file) => readFileSync(join(stateDir, file))))
    expect(durableDatabase.includes(Buffer.from(first.credential))).toBe(false)
    expect(durableDatabase.includes(Buffer.from(second.credential))).toBe(false)
    expect(durableDatabase.includes(Buffer.from(firstTicket))).toBe(false)
    expect(durableDatabase.includes(Buffer.from(secondTicket))).toBe(false)
  })

  test('enrollment is single use, expires, and enrolled subjects start ungranted', () => {
    const { authority, stateDir } = setup()
    const admin = authority.bootstrapLocalAdministrator('operator')
    const workspaceRoot = join(stateDir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = authority.registerWorkspace(admin.credential, 'workspace-a', workspaceRoot)
    const ticket = authority.issueEnrollment(admin.credential, 'phone', Date.now() + 60_000)
    const enrolled = authority.redeemEnrollment(ticket, 'phone')
    if (!enrolled) throw new Error('expected enrollment redemption')
    const principal = authority.authenticate(enrolled.credential)
    if (!principal) throw new Error('expected authenticated principal')
    expect(authority.redeemEnrollment(ticket, 'phone')).toBeNull()
    expect(authority.authorize(principal, workspace.id, 'read')).toBe(false)

    const expired = authority.issueEnrollment(admin.credential, 'expired', Date.now() + 60_000)
    const db = new DatabaseSync(join(stateDir, 'authority.sqlite'))
    db.prepare('UPDATE enrollments SET expires_at=? WHERE digest=?').run(Date.now() - 1, createHash('sha256').update(expired).digest())
    db.close()
    expect(authority.redeemEnrollment(expired, 'expired')).toBeNull()
  })
  test('invalid secrets cannot exhaust the budget for unrelated credentials or enrollment tickets', () => {
    const { authority } = setup()
    const admin = authority.bootstrapLocalAdministrator('operator')
    const ticket = authority.issueEnrollment(admin.credential, 'device', Date.now() + 60_000)
    for (let attempt = 0; attempt < 110; attempt++) {
      expect(authority.authenticate('invalid credential')).toBeNull()
    }
    expect(authority.authenticate(admin.credential)).not.toBeNull()
    for (let attempt = 0; attempt < 110; attempt++) {
      expect(authority.redeemEnrollment('invalid enrollment ticket', 'device')).toBeNull()
    }
    expect(authority.redeemEnrollment(ticket, 'device')).not.toBeNull()
  })


  test('credential expiry is rechecked on authentication and authorization', () => {
    const { authority, stateDir } = setup()
    const admin = authority.bootstrapLocalAdministrator('operator')
    const workspaceRoot = join(stateDir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = authority.registerWorkspace(admin.credential, 'workspace-a', workspaceRoot)
    const ticket = authority.issueEnrollment(admin.credential, 'device', Date.now() + 60_000)
    const issued = authority.redeemEnrollment(ticket, 'device')
    if (!issued) throw new Error('expected enrollment redemption')
    const principal = authority.authenticate(issued.credential)
    if (!principal) throw new Error('expected authenticated principal')
    authority.grantWorkspace(admin.credential, principal.subject, workspace.id, ['read'])
    expect(authority.authorize(principal, workspace.id, 'read')).toBe(true)

    const db = new DatabaseSync(join(stateDir, 'authority.sqlite'))
    db.prepare('UPDATE credentials SET expires_at=0 WHERE id=?').run(issued.principal.credentialId)
    db.close()
    expect(authority.authenticate(issued.credential)).toBeNull()
    expect(authority.authorize(principal, workspace.id, 'read')).toBe(false)
  })

  test('grants are action/workspace scoped; revocation and rotation invalidate immediately', () => {
    const { authority, stateDir } = setup()
    const admin = authority.bootstrapLocalAdministrator('operator')
    const rootA = join(stateDir, 'a')
    const rootB = join(stateDir, 'b')
    mkdirSync(rootA)
    mkdirSync(rootB)
    const workspaceA = authority.registerWorkspace(admin.credential, 'a', rootA)
    const workspaceB = authority.registerWorkspace(admin.credential, 'b', rootB)
    const ticket = authority.issueEnrollment(admin.credential, 'device', Date.now() + 60_000)
    const issued = authority.redeemEnrollment(ticket, 'device')
    if (!issued) throw new Error('expected enrollment redemption')
    const principal = authority.authenticate(issued.credential)
    if (!principal) throw new Error('expected authenticated principal')
    expect(() => authority.issueEnrollment(issued.credential, 'unauthorized', Date.now() + 60_000)).toThrow()
    expect(() => authority.registerWorkspace(issued.credential, 'unauthorized', rootA)).toThrow()
    expect(() => authority.grantWorkspace(issued.credential, principal.subject, workspaceA.id, ['read'])).toThrow()
    authority.grantWorkspace(admin.credential, principal.subject, workspaceA.id, ['read'])
    authority.grantWorkspace(admin.credential, principal.subject, workspaceB.id, ['read'])

    expect(authority.authorize(principal, workspaceA.id, 'read', rootA)).toBe(true)
    expect(authority.authorize(principal, workspaceA.id, 'read', rootB)).toBe(false)
    expect(authority.authorize(principal, workspaceA.id, 'write')).toBe(false)
    expect(authority.authorize(principal, workspaceB.id, 'read', rootB)).toBe(true)

    const invalidations: string[] = []
    const dispose = authority.onInvalidation((event) => invalidations.push(event.reason))
    const staleFence = authority.permissionFence(principal, workspaceA.id, 'read')
    if (!staleFence) throw new Error('expected permission fence')
    authority.revokeWorkspaceGrant(admin.credential, principal.subject, workspaceA.id)
    expect(authority.authorize(principal, workspaceA.id, 'read')).toBe(false)
    expect(authority.authorizePreparedRecovery({ ...principal }, workspaceA.id, 'read', staleFence)).toBe(false)
    expect(invalidations).toEqual(['grant-revoked'])
    authority.grantWorkspace(admin.credential, principal.subject, workspaceA.id, ['read'])
    const renewedFence = authority.permissionFence(principal, workspaceA.id, 'read')
    if (!renewedFence) throw new Error('expected renewed permission fence')
    expect(renewedFence).not.toBe(staleFence)
    expect(authority.authorizePreparedRecovery({ ...principal }, workspaceA.id, 'read', staleFence)).toBe(false)
    expect(authority.authorizePreparedRecovery({ ...principal }, workspaceA.id, 'read', renewedFence)).toBe(true)
    const rotated = authority.rotateCredential(issued.credential)
    expect(authority.authenticate(issued.credential)).toBeNull()
    expect(authority.authenticate(rotated.credential)).toEqual(rotated.principal)
    expect(authority.authorize(principal, workspaceA.id, 'read')).toBe(false)
    expect(authority.authorizePreparedRecovery({ ...principal }, workspaceA.id, 'read', renewedFence)).toBe(false)
    authority.revokeCredential(admin.credential, rotated.principal.credentialId)
    expect(authority.authenticate(rotated.credential)).toBeNull()
    expect(invalidations).toEqual(['grant-revoked', 'grant-changed', 'credential-rotated', 'credential-revoked'])
    dispose()
  })

  test('rejects non-interactive bootstrap, aliases, cross-workspace root reuse, and second bootstrap', () => {
    const { authority, stateDir } = setup()
    expect(authority.hasRegisteredWorkspaces()).toBe(false)
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false })
    expect(() => authority.bootstrapLocalAdministrator('operator')).toThrow()
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    const admin = authority.bootstrapLocalAdministrator('operator')
    const root = join(stateDir, 'workspace')
    const entityRoot = join(stateDir, 'notes')
    const otherRoot = join(stateDir, 'other-workspace')
    mkdirSync(root)
    mkdirSync(entityRoot)
    mkdirSync(otherRoot)
    const workspace = authority.registerWorkspace(admin.credential, 'one', root, [entityRoot])
    expect(authority.hasRegisteredWorkspaces()).toBe(true)
    expect(authority.resolveWorkspace(workspace.id)).toEqual({ id: 'one', nativeRoot: root, entityRoots: [entityRoot] })
    expect(authority.isRegisteredWorkspace(workspace.id)).toBe(true)
    expect(() => authority.registerWorkspace(admin.credential, 'two', otherRoot, [entityRoot])).toThrow()
    const alias = join(stateDir, 'workspace-alias')
    symlinkSync(root, alias)
    expect(() => authority.registerWorkspace(admin.credential, 'three', alias)).toThrow()

    const ticket = authority.issueEnrollment(admin.credential, 'member', Date.now() + 60_000)
    const issued = authority.redeemEnrollment(ticket, 'member')
    if (!issued) throw new Error('expected enrollment redemption')
    const principal = authority.authenticate(issued.credential)
    if (!principal) throw new Error('expected authenticated principal')
    authority.grantWorkspace(admin.credential, principal.subject, workspace.id, ['read'])
    const fence = authority.permissionFence(principal, workspace.id, 'read')
    if (!fence) throw new Error('expected permission fence')
    expect(authority.authorize(principal, workspace.id, 'read')).toBe(true)

    const movedEntityRoot = join(stateDir, 'notes-moved')
    renameSync(entityRoot, movedEntityRoot)
    mkdirSync(entityRoot)
    expect(authority.isRegisteredWorkspace(workspace.id)).toBe(true)
    expect(authority.resolveWorkspace(workspace.id)).toBeNull()
    expect(authority.authorize(principal, workspace.id, 'read')).toBe(false)
    expect(authority.authorizePreparedRecovery({ ...principal }, workspace.id, 'read', fence)).toBe(false)
    expect(() => authority.bootstrapLocalAdministrator('second operator')).toThrow()
  })

  test('recovers the persisted administrator after expiry and invalidates the old credential', () => {
    const { authority, stateDir } = setup()
    const admin = authority.bootstrapLocalAdministrator('operator')
    const afterLostDelivery = authority.recoverLocalAdministrator('delivery-recovery')
    expect(afterLostDelivery.principal.subject).toBe(admin.principal.subject)
    expect(authority.authenticate(admin.credential)).toBeNull()
    const db = new DatabaseSync(join(stateDir, 'authority.sqlite'))
    db.prepare('UPDATE credentials SET expires_at=0 WHERE id=?').run(afterLostDelivery.principal.credentialId)
    db.close()
    expect(authority.authenticate(afterLostDelivery.credential)).toBeNull()
    expect(authority.authenticate(admin.credential)).toBeNull()

    const recoveryFile = join(stateDir, 'recovered-admin.secret')
    const result = runLocalMaintenanceCommand([
      'recover-admin', '--state-dir', stateDir, '--label', 'operator-recovered', '--secret-file', recoveryFile,
    ])
    expect(result.exitCode).toBe(0)
    const recoveredCredential = readFileSync(recoveryFile, 'utf8').trim()
    const recoveredPrincipal = authority.authenticate(recoveredCredential)
    expect(recoveredPrincipal?.subject).toBe(admin.principal.subject)
    expect(authority.authenticate(admin.credential)).toBeNull()
    expect(() => authority.bootstrapLocalAdministrator('second operator')).toThrow()
  })

  test('rejects ancestor and descendant roots across workspaces but permits nested roots in one workspace', () => {
    const { authority, stateDir } = setup()
    const admin = authority.bootstrapLocalAdministrator('operator')
    const outer = join(stateDir, 'outer')
    const child = join(outer, 'child')
    const notes = join(child, 'notes')
    mkdirSync(notes, { recursive: true })
    authority.registerWorkspace(admin.credential, 'nested-workspace', child, [notes])
    expect(() => authority.registerWorkspace(admin.credential, 'ancestor-workspace', outer)).toThrow()

    const otherOuter = join(stateDir, 'other-outer')
    const otherChild = join(otherOuter, 'child')
    mkdirSync(otherChild, { recursive: true })
    authority.registerWorkspace(admin.credential, 'child-workspace', otherChild)
    const nested = join(otherChild, 'nested')
    mkdirSync(nested)
    expect(() => authority.registerWorkspace(admin.credential, 'descendant-workspace', nested)).toThrow()
  })

  test('does not consume first bootstrap when private delivery path already exists', () => {
    const { authority, stateDir } = setup()
    const occupiedFile = join(stateDir, 'occupied.secret')
    writeFileSync(occupiedFile, 'preserve existing file')
    expect(() => runLocalMaintenanceCommand([
      'bootstrap', '--state-dir', stateDir, '--label', 'operator', '--secret-file', occupiedFile,
    ])).toThrow()
    expect(readFileSync(occupiedFile, 'utf8')).toBe('preserve existing file')
    const issued = authority.bootstrapLocalAdministrator('operator')
    expect(authority.authenticate(issued.credential)).toEqual(issued.principal)
  })

  test('maintenance bootstrap and enrollment deliver secrets only to private files', () => {
    const { authority, stateDir } = setup()
    const adminFile = join(stateDir, 'first-admin.secret')
    const ticketFile = join(stateDir, 'enrollment.ticket')
    const bootstrapped = runLocalMaintenanceCommand([
      'bootstrap', '--state-dir', stateDir, '--label', 'operator', '--secret-file', adminFile,
    ])
    expect(bootstrapped.exitCode).toBe(0)
    expect(statSync(adminFile).mode & 0o777).toBe(0o600)
    const adminCredential = readFileSync(adminFile, 'utf8').trim()
    expect(bootstrapped.output).not.toContain(adminCredential)
    expect(authority.authenticate(adminCredential)).not.toBeNull()

    const enrolled = runLocalMaintenanceCommand([
      'enroll', '--state-dir', stateDir, '--label', 'recipient', '--admin-file', adminFile,
      '--expires-in-ms', '60000', '--ticket-file', ticketFile,
    ])
    expect(enrolled.exitCode).toBe(0)
    expect(statSync(ticketFile).mode & 0o777).toBe(0o600)
    const ticket = readFileSync(ticketFile, 'utf8').trim()
    expect(enrolled.output).not.toContain(ticket)
    const device = authority.redeemEnrollment(ticket, 'recipient-device')
    if (!device) throw new Error('expected private enrollment ticket redemption')
    expect(authority.authenticate(device.credential)).toEqual(device.principal)
  })
})
