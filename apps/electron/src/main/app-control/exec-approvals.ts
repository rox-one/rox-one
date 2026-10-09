/**
 * Exec-approvals socket (port row e2.7).
 *
 * A second, separate UDS that owns spawned children: the lifetime of a request
 * owns the child it started. Closing the connection — or sending `cancel` —
 * kills that child. The approval socket and the app-control socket never share
 * a listener or a token file. No Electron APIs.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'

import { AppControlServer, type AppControlContext, type AppControlServerOptions } from './server.ts'

/** Launcher seam so tests can observe or replace the child process. */
export type ExecSpawn = (command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => ChildProcess

export interface ExecApprovalsServerOptions extends Omit<AppControlServerOptions, 'handler'> {
  spawn?: ExecSpawn
}

interface ChildEntry {
  child: ChildProcess
  connectionId: string
}

/** Owning wrapper: every spawned child is killed when its request dies. */
export class ExecApprovalsServer {
  readonly server: AppControlServer
  private readonly spawnFn: ExecSpawn
  private readonly children = new Map<string, ChildEntry>()
  private readonly byConnection = new Map<string, Set<string>>()

  constructor(options: ExecApprovalsServerOptions) {
    this.spawnFn = options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, [...args], { ...spawnOptions, stdio: 'ignore' }))
    this.server = new AppControlServer({
      ...options,
      handler: (method, payload, context) => this.handle(method, payload, context),
    })
  }

  get socketPath(): string { return this.server.socketPath }
  get tokenPath(): string { return this.server.tokenPath }
  get secret(): string { return this.server.secret }

  async listen(): Promise<this> {
    await this.server.listen()
    return this
  }

  async close(): Promise<void> {
    for (const id of [...this.children.keys()]) this.kill(id)
    await this.server.close()
  }

  /** PIDs of children currently owned by a live request (test/diagnostic use). */
  ownedPids(): number[] {
    return [...this.children.values()].map((entry) => entry.child.pid ?? -1).filter((pid) => pid > 0)
  }

  private async handle(method: string, payload: unknown, context: AppControlContext): Promise<unknown> {
    context.socket.once('close', () => this.killConnection(context.connectionId))
    if (method === 'exec') return await this.exec(payload, context)
    if (method === 'cancel') return this.cancel(payload)
    throw new Error(`unsupported exec-approvals method: ${method}`)
  }

  private async exec(payload: unknown, context: AppControlContext): Promise<{ id: string; pid: number | null }> {
    if (typeof payload !== 'object' || payload === null || !('command' in payload)
      || typeof payload.command !== 'string' || payload.command.length === 0) {
      throw new Error('exec requires a non-empty command')
    }
    const args = 'args' in payload && Array.isArray(payload.args) ? payload.args.filter((arg): arg is string => typeof arg === 'string') : []
    const cwd = 'cwd' in payload && typeof payload.cwd === 'string' ? payload.cwd : undefined
    const env = 'env' in payload && typeof payload.env === 'object' && payload.env !== null ? payload.env as NodeJS.ProcessEnv : undefined
    const child = this.spawnFn(payload.command, args, { cwd, env })
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn)
      child.once('error', rejectSpawn)
    })
    const id = context.requestId
    this.children.set(id, { child, connectionId: context.connectionId })
    const ids = this.byConnection.get(context.connectionId) ?? new Set<string>()
    ids.add(id)
    this.byConnection.set(context.connectionId, ids)
    child.once('exit', () => this.forget(id))
    return { id, pid: child.pid ?? null }
  }

  private cancel(payload: unknown): { killed: boolean } {
    const id = payload && typeof payload === 'object' && 'id' in payload ? payload.id : undefined
    if (typeof id !== 'string') throw new Error('cancel requires a string id')
    return { killed: this.kill(id) }
  }

  private kill(id: string): boolean {
    const entry = this.children.get(id)
    if (!entry) return false
    entry.child.kill('SIGKILL')
    this.forget(id)
    return true
  }

  private killConnection(connectionId: string): void {
    for (const id of this.byConnection.get(connectionId) ?? []) this.kill(id)
  }

  private forget(id: string): void {
    const entry = this.children.get(id)
    if (!entry) return
    this.children.delete(id)
    const ids = this.byConnection.get(entry.connectionId)
    if (ids) {
      ids.delete(id)
      if (ids.size === 0) this.byConnection.delete(entry.connectionId)
    }
  }
}