/**
 * Installs pinned built-in MCP packages on first use and checks them at each
 * application launch. This background job performs only initialize/listTools;
 * sessions keep owning their long-lived connections and tool execution.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { isBlockedEnvVar } from '@rox/core/env'
import { CraftMcpClient, type McpClientConfig } from '@rox/shared/mcp'
import {
  BUILTIN_MCP_CATALOG,
  ensureBuiltinMcpSources,
  ensureBuiltinMcpInstalled,
  ensureBuiltinQmdCollection,
  buildRuntimeBuiltinMcpConfig,
  getBuiltinMcpReadiness,
  getSourceCredentialManager,
  isManagedBuiltinMcpSource,
  loadSourceConfig,
  loadWorkspaceSources,
  saveSourceConfig,
  type BuiltServers,
  type FolderSourceConfig,
  type LoadedSource,
  type McpServerConfig,
  type SourceConnectionStatus,
} from '@rox/shared/sources'
import { getToolchain, withToolchainPathPrefix } from '@rox/shared/toolchain-runtime'
import { isLocalMcpEnabled } from '@rox/shared/workspaces'
import { buildServersFromSources } from './build-servers.ts'

type Readiness = ReturnType<typeof getBuiltinMcpReadiness>
type ProbeClient = Pick<CraftMcpClient, 'listTools' | 'close' | 'callTool'>

/** Injection points keep installation/network work out of unit tests. */
export interface BuiltinMcpStartupDependencies {
  ensureSources(root: string): void
  loadSources(root: string): LoadedSource[]
  loadConfig(root: string, slug: string): FolderSourceConfig | null
  saveConfig(root: string, config: FolderSourceConfig): void
  readiness(source: LoadedSource): Readiness | Promise<Readiness>
  isManaged(config: FolderSourceConfig): boolean
  localEnabled(root: string): boolean
  ensureInstalled(source: LoadedSource, signal: AbortSignal): Promise<unknown>
  installPlaywrightBrowser(server: Extract<McpServerConfig, { type: 'stdio' }>, signal: AbortSignal): Promise<void>
  prepareQmd(source: LoadedSource, server: Extract<McpServerConfig, { type: 'stdio' }>, signal: AbortSignal): Promise<void>
  verifyEverything(server: Extract<McpServerConfig, { type: 'stdio' }>, signal: AbortSignal): Promise<void>
  buildServers(sources: LoadedSource[]): Promise<Pick<BuiltServers, 'mcpServers' | 'errors'>>
  createClient(config: McpClientConfig): ProbeClient
  resolveExecutable(command: string): Promise<string | null>
  /** Called when a managed Node/Bun/Python runtime has finished installing. */
  onRuntimeReady(listener: () => void): () => void
}

export interface BuiltinMcpStartupOptions {
  /** First package download can be slower than a normal MCP handshake. */
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
  /** Delay after a failed startup pass; grows to maxRetryIntervalMs during outages. */
  retryIntervalMs?: number
  maxRetryIntervalMs?: number
  concurrency?: number
  log?: (message: string) => void
  dependencies?: Partial<BuiltinMcpStartupDependencies>
}

const defaults: BuiltinMcpStartupDependencies = {
  ensureSources: root => { ensureBuiltinMcpSources(root) },
  loadSources: loadWorkspaceSources,
  loadConfig: loadSourceConfig,
  saveConfig: saveSourceConfig,
  readiness: async source => {
    const manager = getSourceCredentialManager()
    const [token, credential] = await Promise.all([manager.getToken(source), manager.getApiCredential(source)])
    return getBuiltinMcpReadiness(source.config, {
      token,
      credential: credential && typeof credential === 'object' ? credential as Record<string, string> : undefined,
      workspaceRootPath: source.workspaceRootPath,
      sourceFolderPath: source.folderPath,
    })
  },
  isManaged: isManagedBuiltinMcpSource,
  localEnabled: isLocalMcpEnabled,
  ensureInstalled: (source, signal) => ensureBuiltinMcpInstalled({
    ...source,
    config: buildRuntimeBuiltinMcpConfig(source.config),
  }, { signal }),
  installPlaywrightBrowser,
  prepareQmd: async (source, server, signal) => {
    const collection = ensureBuiltinQmdCollection(source.workspaceRootPath, source.config)
    if (!collection.canUpdate) return
    const { command, args } = npmSetupCommand(server.command, ['-y', '@tobilu/qmd@2.8.3', 'update', '--index', 'rox'])
    await runSetupCommand(command, args, server, signal)
  },
  verifyEverything: async (server, signal) => {
    const es = server.env?.ES_PATH
    if (!es) throw new Error('Everything requires its es.exe command-line client')
    try {
      await runSetupCommand(es, ['-timeout', '1000', '-get-everything-version'], server, signal)
    } catch (error) {
      if (error instanceof StartupAborted) throw error
      throw new Error('Everything desktop service is unavailable. Start Everything and retry.')
    }
  },
  buildServers: sources => buildServersFromSources(sources),
  createClient: config => new CraftMcpClient(config),
  resolveExecutable: command => getToolchain().resolver.findExecutable(command),
  onRuntimeReady: listener => getToolchain().manager.onStatusChange(status => {
    if (status.phase === 'ready' && ['node', 'bun', 'uv', 'python'].includes(status.name)) listener()
  }),
}

class StartupAborted extends Error {}
class RuntimeDeferred extends Error {}

/** The pinned MCP CLI provisions the matching Playwright browser revision. */
async function installPlaywrightBrowser(server: Extract<McpServerConfig, { type: 'stdio' }>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new StartupAborted()
  const pinnedPackage = server.args?.find(arg => /^@playwright\/mcp@\d/.test(arg))
  if (!pinnedPackage) return
  const { command, args } = npmSetupCommand(server.command, ['-y', pinnedPackage, 'install-browser', 'chromium'])
  await runSetupCommand(command, args, server, signal)
}

function npmSetupCommand(command: string, args: string[]): { command: string; args: string[] } {
  // Node's native spawn cannot execute a .cmd launcher without a shell. Use
  // the adjacent official npm entrypoint, keeping arguments as separate words.
  if (process.platform === 'win32' && /npx\.cmd$/i.test(command)) {
    const node = join(dirname(command), 'node.exe')
    const cli = join(dirname(command), 'node_modules', 'npm', 'bin', 'npx-cli.js')
    if (!existsSync(node) || !existsSync(cli)) throw new Error('MCP package setup requires the managed Node/npm runtime')
    command = node
    args = [cli, ...args]
  }
  return { command, args }
}

/** Cancellable package setup or read-only native prerequisite check. */
async function runSetupCommand(command: string, args: string[], server: { env?: Record<string, string>; cwd?: string }, signal: AbortSignal): Promise<void> {
  const inherited: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isBlockedEnvVar(key)) inherited[key] = value
  }
  const env = await withToolchainPathPrefix({ ...inherited, ...server.env })
  if (signal.aborted) throw new StartupAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env, cwd: server.cwd, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32',
    })
    let killTask = Promise.resolve()
    const abort = () => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        killTask = new Promise(done => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
          killer.once('error', () => { child.kill(); done() })
          killer.once('close', () => done())
        })
      } else {
        const pid = child.pid
        try { process.kill(-pid, 'SIGTERM') } catch { child.kill() }
        killTask = new Promise(done => {
          const timer = setTimeout(() => {
            try { process.kill(-pid, 'SIGKILL') } catch { /* already exited */ }
            done()
          }, 500)
          timer.unref?.()
        })
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.once('error', error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', async code => {
      signal.removeEventListener('abort', abort)
      await killTask
      if (signal.aborted) reject(new StartupAborted())
      else if (code === 0) resolve()
      else reject(new Error(`MCP prerequisite setup failed (exit ${code ?? 'unknown'})`))
    })
  })
}

/** Status/metadata changes do not invalidate an in-flight configuration. */
function connectionFingerprint(config: FolderSourceConfig): string {
  return JSON.stringify([config.id, config.enabled, config.type, config.mcp])
}

function attemptFingerprint(config: FolderSourceConfig): string {
  return `${connectionFingerprint(config)}:${config.isAuthenticated ?? false}`
}

function clientConfig(config: McpServerConfig): McpClientConfig {
  if (config.type === 'stdio') {
    return { transport: 'stdio', command: config.command, args: config.args, env: config.env, cwd: config.cwd }
  }
  return { transport: config.type, url: config.url, headers: config.headers }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Installation errors can contain authenticated URLs or HTTP headers.
  return message
    .replace(/https?:\/\/[^\s"'<>]+/g, raw => {
      try {
        const url = new URL(raw)
        return `${url.origin}${url.pathname}`
      } catch { return '<endpoint>' }
    })
    .replace(/(bearer|token|api[_-]?key|authorization)([\s:=]+)[^\s,;]+/gi, '$1$2[redacted]')
    .slice(0, 500)
}

/** A timeout also closes the transport, so a stalled installer is not orphaned. */
async function bounded<T>(work: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new StartupAborted()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        abort = () => reject(new StartupAborted())
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('MCP installation or connection timed out')), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (abort) signal.removeEventListener('abort', abort)
  }
}

export class BuiltinMcpStartup {
  private readonly dependencies: BuiltinMcpStartupDependencies
  private readonly options: Required<Pick<BuiltinMcpStartupOptions, 'timeoutMs' | 'attempts' | 'retryDelayMs' | 'retryIntervalMs' | 'maxRetryIntervalMs' | 'concurrency'>>
  private readonly log: (message: string) => void
  private readonly controller = new AbortController()
  private readonly workspaces = new Set<string>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly pendingPass = new Set<string>()
  private readonly attempted = new Map<string, string>()
  private readonly runtimeDeferred = new Map<string, Set<string>>()
  private readonly retrySources = new Map<string, Set<string>>()
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly retryRounds = new Map<string, number>()
  private readonly clients = new Set<ProbeClient>()
  private readonly closingClients = new WeakMap<ProbeClient, Promise<void>>()
  private readonly installations = new Set<Promise<unknown>>()
  private unsubscribeRuntime?: () => void

  constructor(options: BuiltinMcpStartupOptions = {}) {
    this.dependencies = { ...defaults, ...options.dependencies }
    this.options = {
      timeoutMs: options.timeoutMs ?? 90_000,
      attempts: Math.max(1, options.attempts ?? 2),
      retryDelayMs: options.retryDelayMs ?? 1_500,
      retryIntervalMs: Math.max(1, options.retryIntervalMs ?? 60_000),
      maxRetryIntervalMs: Math.max(1, options.maxRetryIntervalMs ?? 300_000),
      concurrency: Math.max(1, options.concurrency ?? 2),
    }
    this.log = options.log ?? (() => {})
  }

  /** Returns the background task for tests/shutdown; callers need not await it. */
  ensureWorkspace(root: string): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve()
    this.workspaces.add(root)
    const running = this.running.get(root)
    if (running) {
      this.pendingPass.add(root)
      return running
    }
    if (!this.unsubscribeRuntime) {
      this.unsubscribeRuntime = this.dependencies.onRuntimeReady(() => {
        for (const [workspace, slugs] of this.runtimeDeferred) {
          const deferred = [...slugs]
          this.runtimeDeferred.delete(workspace)
          // A status event can arrive before the current workspace pass ends.
          const previous = this.running.get(workspace) ?? Promise.resolve()
          void previous.then(() => {
            for (const slug of deferred) this.attempted.delete(`${workspace}:${slug}`)
            return this.ensureWorkspace(workspace)
          })
        }
      })
    }
    // Starting in a microtask lets SessionManager finish its synchronous setup.
    const task = Promise.resolve()
      .then(() => this.checkWorkspace(root))
      .catch(error => {
        if (!this.controller.signal.aborted) this.log(`Built-in MCP startup deferred: ${safeError(error)}`)
      })
      .finally(() => {
        this.running.delete(root)
        if (this.pendingPass.delete(root)) return this.ensureWorkspace(root)
        this.scheduleRetry(root)
      })
    this.running.set(root, task)
    return task
  }

  start(roots: readonly string[]): void {
    for (const root of roots) void this.ensureWorkspace(root)
  }

  /** Called after credential/source settings changes, without restarting the app. */
  retryWorkspace(root: string): Promise<void> {
    this.clearRetryTimer(root)
    this.retryRounds.delete(root)
    const previous = this.running.get(root) ?? Promise.resolve()
    return previous.then(() => {
      // An old probe can still write its status/fingerprint while finishing.
      // Invalidate after it drains so a new credential is actually probed.
      for (const key of this.attempted.keys()) {
        if (key.startsWith(`${root}:`)) this.attempted.delete(key)
      }
      return this.ensureWorkspace(root)
    })
  }

  async stop(): Promise<void> {
    this.controller.abort()
    for (const root of this.retryTimers.keys()) this.clearRetryTimer(root)
    this.unsubscribeRuntime?.()
    this.unsubscribeRuntime = undefined
    await Promise.all([...this.clients].map(client => this.closeClient(client)))
    await Promise.all(this.running.values())
    await Promise.allSettled(this.installations)
    this.runtimeDeferred.clear()
    this.retrySources.clear()
    this.retryRounds.clear()
    this.pendingPass.clear()
    this.workspaces.clear()
  }

  private async closeClient(client: ProbeClient): Promise<void> {
    const closing = this.closingClients.get(client)
    if (closing) return closing
    const task = client.close().catch(() => {})
    this.closingClients.set(client, task)
    await task
    this.clients.delete(client)
  }

  private trackInstallation<T>(work: Promise<T>): Promise<T> {
    this.installations.add(work)
    void work.finally(() => this.installations.delete(work)).catch(() => {})
    return work
  }

  private clearRetryTimer(root: string): void {
    const timer = this.retryTimers.get(root)
    if (timer) clearTimeout(timer)
    this.retryTimers.delete(root)
  }

  private markRetry(root: string, slug: string): void {
    if (this.controller.signal.aborted) return
    const slugs = this.retrySources.get(root) ?? new Set<string>()
    slugs.add(slug)
    this.retrySources.set(root, slugs)
  }

  private fingerprint(root: string, config: FolderSourceConfig): string {
    return `${attemptFingerprint(config)}:${config.mcp?.transport === 'stdio' ? this.dependencies.localEnabled(root) : true}`
  }

  private scheduleRetry(root: string): void {
    if (this.controller.signal.aborted) return
    if (!this.retrySources.get(root)?.size) {
      this.clearRetryTimer(root)
      this.retrySources.delete(root)
      this.retryRounds.delete(root)
      return
    }
    if (this.retryTimers.has(root)) return
    const round = this.retryRounds.get(root) ?? 0
    const delay = Math.min(this.options.maxRetryIntervalMs, this.options.retryIntervalMs * 2 ** Math.min(round, 20))
    const timer = setTimeout(() => {
      this.retryTimers.delete(root)
      if (this.controller.signal.aborted) return
      for (const slug of this.retrySources.get(root) ?? []) this.attempted.delete(`${root}:${slug}`)
      void this.ensureWorkspace(root)
    }, delay)
    timer.unref?.()
    this.retryTimers.set(root, timer)
    this.retryRounds.set(root, round + 1)
  }

  private async checkWorkspace(root: string): Promise<void> {
    this.dependencies.ensureSources(root)
    const sources = this.dependencies.loadSources(root).filter(source =>
      this.dependencies.isManaged(source.config) && source.config.enabled && source.config.type === 'mcp',
    )
    const desired = new Set(sources.map(source => source.config.slug))
    for (const slug of this.retrySources.get(root) ?? []) {
      if (!desired.has(slug)) this.retrySources.get(root)?.delete(slug)
    }
    let next = 0
    await Promise.all(Array.from({ length: Math.min(this.options.concurrency, sources.length) }, async () => {
      while (!this.controller.signal.aborted) {
        const source = sources[next++]
        if (!source) return
        const key = `${root}:${source.config.slug}`
        const fingerprint = this.fingerprint(root, source.config)
        if (this.attempted.get(key) === fingerprint) continue
        this.attempted.set(key, fingerprint)
        this.retrySources.get(root)?.delete(source.config.slug)
        this.runtimeDeferred.get(root)?.delete(source.config.slug)
        if (!this.runtimeDeferred.get(root)?.size) this.runtimeDeferred.delete(root)
        try {
          await this.checkSource(root, source)
        } catch (error) {
          if (this.controller.signal.aborted) return
          this.updateStatus(root, source, 'failed', safeError(error))
          this.markRetry(root, source.config.slug)
        }
      }
    }))
  }

  private updateStatus(root: string, source: LoadedSource, status: SourceConnectionStatus, error?: string): void {
    if (this.controller.signal.aborted) return
    const current = this.dependencies.loadConfig(root, source.config.slug)
    // A settings edit/delete/disable while downloading always takes precedence.
    if (!current || !current.enabled || !this.dependencies.isManaged(current)
      || connectionFingerprint(current) !== connectionFingerprint(source.config)) return
    const updated: FolderSourceConfig = {
      ...current,
      connectionStatus: status,
      connectionError: error,
      lastTestedAt: Date.now(),
      ...(status === 'connected' ? { isAuthenticated: true } : {}),
      ...(status === 'needs_auth' ? { isAuthenticated: false } : {}),
    }
    this.dependencies.saveConfig(root, updated)
    // Own status writes must not trigger another installation in the config
    // watcher. A later successful credential save can still invalidate this.
    this.attempted.set(`${root}:${source.config.slug}`, this.fingerprint(root, updated))
  }

  private async checkSource(root: string, source: LoadedSource): Promise<void> {
    if (source.config.mcp?.transport === 'stdio' && !this.dependencies.localEnabled(root)) {
      this.updateStatus(root, source, 'local_disabled', 'Local MCP is disabled for this workspace')
      return
    }
    // Native Windows servers need their verified release before readiness can
    // find the executable. Custom binaries and other platforms are a no-op.
    const installController = new AbortController()
    const abortInstall = () => installController.abort()
    this.controller.signal.addEventListener('abort', abortInstall, { once: true })
    try {
      await bounded(this.trackInstallation(this.dependencies.ensureInstalled(source, installController.signal)), this.options.timeoutMs, this.controller.signal)
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.updateStatus(root, source, 'failed', safeError(error))
        this.markRetry(root, source.config.slug)
      }
      return
    } finally {
      installController.abort()
      this.controller.signal.removeEventListener('abort', abortInstall)
    }
    const readiness = await bounded(Promise.resolve(this.dependencies.readiness(source)), this.options.timeoutMs, this.controller.signal)
    if (readiness.status !== 'ready') {
      if (readiness.status !== 'disabled') {
        this.updateStatus(root, source,
          readiness.status === 'needs_auth' ? 'needs_auth'
            : readiness.status === 'unsupported_platform' ? 'local_disabled' : 'untested', readiness.reason)
      }
      return
    }
    let qmdPreparation: Promise<void> | undefined
    for (let attempt = 0; attempt < this.options.attempts && !this.controller.signal.aborted; attempt++) {
      let client: ProbeClient | undefined
      let probingSource = false
      let usesCredentials = !!BUILTIN_MCP_CATALOG.find(spec => spec.slug === source.config.slug)?.requiredEnvironment?.length
        || (source.config.mcp?.authType !== undefined && source.config.mcp.authType !== 'none')
      try {
        const built = await bounded(this.dependencies.buildServers([source]), this.options.timeoutMs, this.controller.signal)
        const server = built.mcpServers[source.config.slug]
        if (!server) throw new Error(built.errors[0]?.error ?? 'MCP source requires configuration or authentication')
        if (server.type !== 'stdio' && Object.entries(server.headers ?? {}).some(([name, value]) =>
          !!value.trim() && /authorization|api[_-]?key|token/i.test(name))) usesCredentials = true
        if (source.config.slug === 'qdrant' && server.type === 'stdio'
          && server.env?.QDRANT_URL?.trim() && server.env?.QDRANT_API_KEY?.trim()) usesCredentials = true
        if (server.type === 'stdio') {
          const runner = basename(server.command).replace(/\.(exe|cmd|bat)$/i, '')
          // Absolute configured binaries are validated by the catalog. Package
          // runners must resolve only after the managed runtime is available.
          if (!isAbsolute(server.command) && ['npx', 'bun', 'uvx'].includes(runner)) {
            const executable = await bounded(this.dependencies.resolveExecutable(runner), this.options.timeoutMs, this.controller.signal)
            if (!executable) throw new RuntimeDeferred(`MCP runtime ${runner} is still installing or unavailable`)
            server.command = executable
          }
        }
        if (this.controller.signal.aborted) return
        const current = this.dependencies.loadConfig(root, source.config.slug)
        if (!current?.enabled || connectionFingerprint(current) !== connectionFingerprint(source.config)) return
        if (source.config.slug === 'qmd' && server.type === 'stdio' && server.args?.includes('@tobilu/qmd@2.8.3')) {
          qmdPreparation ??= (async () => {
            const prepareController = new AbortController()
            const abortPrepare = () => prepareController.abort()
            this.controller.signal.addEventListener('abort', abortPrepare, { once: true })
            try {
              await bounded(this.trackInstallation(this.dependencies.prepareQmd(source, server, prepareController.signal)), this.options.timeoutMs, this.controller.signal)
            } finally {
              prepareController.abort()
              this.controller.signal.removeEventListener('abort', abortPrepare)
            }
          })()
          await qmdPreparation
        }
        if (source.config.slug === 'everything-mcp' && server.type === 'stdio'
          && server.args?.some(arg => /^@danielsimonjr\/everything-mcp@\d/.test(arg))) {
          const prerequisiteController = new AbortController()
          const abortPrerequisite = () => prerequisiteController.abort()
          this.controller.signal.addEventListener('abort', abortPrerequisite, { once: true })
          try {
            await bounded(this.trackInstallation(this.dependencies.verifyEverything(server, prerequisiteController.signal)), 5_000, this.controller.signal)
          } finally {
            prerequisiteController.abort()
            this.controller.signal.removeEventListener('abort', abortPrerequisite)
          }
        }
        client = this.dependencies.createClient(clientConfig(server))
        this.clients.add(client)
        // listTools triggers initialize and a health check; no tool is invoked.
        probingSource = true
        const tools = await bounded(client.listTools(), this.options.timeoutMs, this.controller.signal)
        probingSource = false
        // Chromium provisioning is the only startup tool call: it installs
        // browser files and is explicitly authorized by the app's setup flow.
        // The upstream installer is idempotent when its browser is cached.
        if (source.config.slug === 'playwright' && server.type === 'stdio'
          && server.args?.some(arg => /^@playwright\/mcp@\d/.test(arg))) {
          const install = tools.find(tool => tool.name === 'browser_install')
          if (install) {
            const result = await bounded(client.callTool(install.name, {}, {
              signal: this.controller.signal,
              timeoutMs: this.options.timeoutMs,
            }), this.options.timeoutMs, this.controller.signal)
            if (result && typeof result === 'object' && 'isError' in result && result.isError) {
              throw new Error('Playwright browser installation failed')
            }
          } else {
            const browserController = new AbortController()
            const abortBrowser = () => browserController.abort()
            this.controller.signal.addEventListener('abort', abortBrowser, { once: true })
            try {
              await bounded(this.trackInstallation(this.dependencies.installPlaywrightBrowser(server, browserController.signal)), this.options.timeoutMs, this.controller.signal)
            } finally {
              browserController.abort()
              this.controller.signal.removeEventListener('abort', abortBrowser)
            }
          }
        }
        this.updateStatus(root, source, 'connected')
        return
      } catch (error) {
        if (error instanceof StartupAborted || this.controller.signal.aborted) return
        if (error instanceof RuntimeDeferred) {
          const pending = this.runtimeDeferred.get(root) ?? new Set<string>()
          pending.add(source.config.slug)
          this.runtimeDeferred.set(root, pending)
          this.updateStatus(root, source, 'untested', error.message)
          this.markRetry(root, source.config.slug)
          return
        }
        const message = safeError(error)
        // Package/model/browser downloads can return 401/403 without any MCP
        // source credentials being wrong. Only an authenticated source probe
        // may stop recovery and ask for a new credential.
        const needsAuth = probingSource && usesCredentials
          && /\b401\b|\b403\b|unauthorized|forbidden|authentication|credentials/i.test(message)
        if (needsAuth || attempt + 1 === this.options.attempts) {
          this.updateStatus(root, source, needsAuth ? 'needs_auth' : 'failed', message)
          if (!needsAuth) this.markRetry(root, source.config.slug)
          this.log(`Built-in MCP ${source.config.slug}: ${needsAuth ? 'needs authentication' : 'installation or verification deferred'}`)
          return
        }
      } finally {
        if (client) await this.closeClient(client)
      }
      try {
        await bounded(new Promise(resolve => setTimeout(resolve, this.options.retryDelayMs)), this.options.retryDelayMs + 100, this.controller.signal)
      } catch { return }
    }
  }
}
