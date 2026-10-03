#!/usr/bin/env bun
import { SQL } from 'bun'
import { ConfigurationError, configurationRecord, loadRuntimeConfiguration } from './configuration.ts'
import { LocalIdentityAdminError } from './auth/postgres-identity.ts'
import { IdentityDomainError } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireUuid } from './modules/identity/commands.ts'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations, type WorkspaceRequestLifecycle } from './server.ts'

export const MAX_ADMIN_INPUT_BYTES = 65536
export const ADMIN_INPUT_TIMEOUT_MS = 5000
const DATABASE_CONNECTION_TIMEOUT_SECONDS = 10
const COMMANDS = ['serve', 'bootstrap-account', 'bootstrap-workspace']

class RuntimeFailure extends Error {
  constructor(readonly code: 'INVALID_ARGUMENTS' | 'INVALID_ADMIN_INPUT' | 'STARTUP_FAILED' | 'COMMAND_FAILED') { super(code) }
}

/** Admission follows real composition I/O; draining never cancels an accepted transaction. */
export class WorkspaceRequestDrain implements WorkspaceRequestLifecycle {
  private accepting = true
  private active = 0
  private completed: (() => void) | undefined
  private readonly drained = new Promise<void>(resolve => { this.completed = resolve })
  begin(): boolean {
    if (!this.accepting) return false
    this.active += 1
    return true
  }
  end(): void {
    if (this.active < 1) throw new Error('Workspace request lifecycle mismatch')
    this.active -= 1
    if (!this.accepting && this.active === 0) this.completed?.()
  }
  quiesce(): Promise<void> {
    this.accepting = false
    if (this.active === 0) this.completed?.()
    return this.drained
  }
}
function output(value: Readonly<Record<string, string | number>>): void { process.stdout.write(JSON.stringify(value) + '\n') }
function failure(code: string): void { process.stderr.write(JSON.stringify({ error: { code } }) + '\n') }

async function adminInput(): Promise<unknown> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    let size = 0
    let done = false
    const chunks: Buffer[] = []
    const finish = (error?: RuntimeFailure) => {
      if (done) return
      done = true
      clearTimeout(timer)
      process.stdin.off('data', data)
      process.stdin.off('end', end)
      process.stdin.off('error', failed)
      process.stdin.pause()
      if (error) reject(error)
      else resolve(Buffer.concat(chunks, size))
    }
    const data = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > MAX_ADMIN_INPUT_BYTES) finish(new RuntimeFailure('INVALID_ADMIN_INPUT'))
      else chunks.push(buffer)
    }
    const end = () => finish()
    const failed = () => finish(new RuntimeFailure('INVALID_ADMIN_INPUT'))
    const timer = setTimeout(() => finish(new RuntimeFailure('INVALID_ADMIN_INPUT')), ADMIN_INPUT_TIMEOUT_MS)
    process.stdin.on('data', data)
    process.stdin.once('end', end)
    process.stdin.once('error', failed)
    process.stdin.resume()
  })
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new RuntimeFailure('INVALID_ADMIN_INPUT') }
}
function adminRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  try { return configurationRecord(value, fields) } catch { throw new RuntimeFailure('INVALID_ADMIN_INPUT') }
}
function adminString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.length || value.length > maximum) throw new RuntimeFailure('INVALID_ADMIN_INPUT')
  return value
}
function validateAdminInput(command: string, input: unknown): unknown {
  try {
    if (command === 'bootstrap-account') {
      const value = adminRecord(input, ['login', 'password'])
      adminString(value.login, 320)
      const password = adminString(value.password, 4096)
      if (password.length < 12) throw new RuntimeFailure('INVALID_ADMIN_INPUT')
    } else {
      const value = adminRecord(input, ['ownerPrincipalId', 'workspaceId', 'name'])
      requireUuid(value.ownerPrincipalId)
      requireUuid(value.workspaceId)
      adminString(value.name, 240)
    }
    return input
  } catch { throw new RuntimeFailure('INVALID_ADMIN_INPUT') }
}
async function provision(command: string, service: Awaited<ReturnType<typeof createWorkspaceServer>>, input: unknown): Promise<void> {
  if (command === 'bootstrap-account') {
    const record = adminRecord(input, ['login', 'password'])
    const result = await service.identity.provisionAccount(adminString(record.login, 320), adminString(record.password, 4096))
    output({ event: 'account_provisioned', principalId: requireUuid(result.principalId), subject: requireUuid(result.subject) })
  } else {
    const record = adminRecord(input, ['ownerPrincipalId', 'workspaceId', 'name'])
    const ownerPrincipalId = requireUuid(record.ownerPrincipalId)
    const workspaceId = requireUuid(record.workspaceId)
    await service.repository.provisionWorkspace(ownerPrincipalId, workspaceId, adminString(record.name, 240))
    output({ event: 'workspace_provisioned', workspaceId, ownerPrincipalId })
  }
}
async function serve(service: Awaited<ReturnType<typeof createWorkspaceServer>>, database: SQL,
  drain: WorkspaceRequestDrain, timeoutSeconds: number, tls: boolean): Promise<number> {
  let stop: (() => void) | undefined
  const stopping = new Promise<void>(resolve => { stop = resolve })
  let signalled = false
  const signal = () => { signalled = true; stop?.() }
  process.on('SIGTERM', signal)
  process.on('SIGINT', signal)
  try {
    await service.server.listen()
    if (!signalled) output({ event: 'listening', protocol: tls ? 'https' : 'http', port: service.server.port })
    await stopping
    const completion = drain.quiesce()
    service.server.close()
    let overdue = false
    const deadline = setTimeout(() => { overdue = true; failure('SHUTDOWN_DRAIN_TIMEOUT') }, timeoutSeconds * 1000)
    try {
      await completion
      // No timeout: SQL.close waits for accepted queries rather than terminating them.
      await database.close()
    } finally { clearTimeout(deadline) }
    // Host-only fixed aggregates: never expose private totals through HTTP/RPC.
    output({ event: 'identity_counters', ...service.observability.snapshot() })
    output({ event: 'stopped' })
    return overdue ? 1 : 0
  } finally {
    process.off('SIGTERM', signal)
    process.off('SIGINT', signal)
    service.server.close()
  }
}

/** Host entry point. Passwords arrive only through bounded stdin, never arguments or output. */
export async function runWorkspaceCLI(arguments_: readonly string[]): Promise<number> {
  let database: SQL | undefined
  let service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
  let phase: 'startup' | 'command' = 'startup'
  try {
    const [command, option, configurationPath] = arguments_
    if (arguments_.length !== 3 || typeof command !== 'string' || !COMMANDS.includes(command) ||
        option !== '--config' || typeof configurationPath !== 'string') throw new RuntimeFailure('INVALID_ARGUMENTS')
    const configuration = await loadRuntimeConfiguration(configurationPath)
    if (command === 'bootstrap-account' && configuration.workspace.authentication.mode !== 'local-bootstrap') throw new RuntimeFailure('INVALID_ARGUMENTS')
    const input = command === 'serve' ? undefined : validateAdminInput(command, await adminInput())
    const migrations = await loadWorkspaceBootstrapMigrations(configuration.migrationsDirectory, Boolean(configuration.workspace.licenseRegistry))
    database = new SQL(configuration.databaseUrl, { max: configuration.poolSize, connectionTimeout: DATABASE_CONNECTION_TIMEOUT_SECONDS })
    const drain = new WorkspaceRequestDrain()
    service = await createWorkspaceServer({ ...configuration.workspace, database, migrations, requestLifecycle: drain })
    phase = 'command'
    if (command === 'serve') return await serve(service, database, drain, configuration.shutdownTimeoutSeconds, Boolean(configuration.workspace.tls))
    await provision(command, service, input)
    return 0
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof RuntimeFailure) { failure(error.code); return 2 }
    if (error instanceof LocalIdentityAdminError || error instanceof IdentityDomainError) failure(error.code)
    else failure(phase === 'startup' ? 'STARTUP_FAILED' : 'COMMAND_FAILED')
    return 1
  } finally {
    service?.server.close()
    if (database) await database.close().catch(() => failure('DATABASE_CLOSE_FAILED'))
  }
}
if (import.meta.main) {
  void runWorkspaceCLI(process.argv.slice(2)).then(code => process.exit(code), () => { failure('COMMAND_FAILED'); process.exit(1) })
}
