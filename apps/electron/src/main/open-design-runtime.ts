import { spawn, type SpawnOptions } from 'child_process'
import { randomBytes } from 'crypto'
import { chmod, mkdir, readFile, realpath, writeFile } from 'fs/promises'
import { isAbsolute, join, resolve } from 'path'
import { createConnection } from 'net'
import { StringDecoder } from 'string_decoder'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'

import {
  OPEN_DESIGN_IPC_CHANNELS,
  validateOpenDesignInitialUrl,
  type OpenDesignRuntimeReason,
  type OpenDesignRuntimeStatus,
  type OpenDesignRuntimeState,
} from '../shared/open-design'

type OpenDesignAppName = 'daemon' | 'web'
type SidecarRuntimeState = 'idle' | 'running' | 'starting' | 'stopped' | 'unknown'

interface SidecarStatusSnapshot {
  state: SidecarRuntimeState
  url: string | null
}

interface OpenDesignWindowLike {
  close(): void
  hasWindow(): boolean
  open(url: string): Promise<void> | void
}

type ReadPackageFileFn = (path: string, encoding: BufferEncoding) => Promise<string | Buffer>
type RealpathFn = (path: string) => Promise<string>
type WriteFileFn = typeof writeFile

export interface OpenDesignRootResolution {
  message?: string
  ok: boolean
  reason?: Extract<OpenDesignRuntimeReason, 'invalid-root' | 'not-configured'>
  root?: string
}

interface CurrentRuntime {
  dataRoot: string
  failureReason?: OpenDesignRuntimeReason
  ipcBase: string
  namespace: string
  root: string
  runtimeRoot: string
  state: Exclude<OpenDesignRuntimeState, 'disabled' | 'idle'>
  updatedAt: number
  webUrl?: string
}

export interface OpenDesignRuntimeManagerDeps {
  chmod?: typeof chmod
  env?: NodeJS.ProcessEnv
  mkdir?: typeof mkdir
  now?: () => number
  readFile?: ReadPackageFileFn
  realpath?: RealpathFn
  requestSidecar?: typeof requestOpenDesignSidecar
  runCommand?: typeof runBufferedCommand
  userDataDir: string
  windowController?: OpenDesignWindowLike
  writeFile?: WriteFileFn
}

export interface BufferedCommandResult {
  stderr: string
  stdout: string
}

export interface BufferedCommandRequest {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
}

export function isTrustedOpenDesignIpcEvent({
  event,
  isRegisteredRoxWebContents,
  isTrustedMainFrameUrl,
}: {
  event: IpcMainInvokeEvent
  isRegisteredRoxWebContents: (sender: WebContents) => boolean
  isTrustedMainFrameUrl: (url: string) => boolean
}): boolean {
  const mainFrame = event.sender.mainFrame
  if (!mainFrame || !event.senderFrame || event.senderFrame !== mainFrame) return false
  if (!isRegisteredRoxWebContents(event.sender)) return false
  return isTrustedMainFrameUrl(mainFrame.url)
}

const OPEN_DESIGN_ROOT_ENV = 'ROX_OPEN_DESIGN_ROOT'
const DATA_DIR_ENV = 'OD_DATA_DIR'
const SIDECAR_BASE_ENV = 'OD_SIDECAR_BASE'
const SIDECAR_IPC_BASE_ENV = 'OD_SIDECAR_IPC_BASE'
const JSON_IPC_MAX_FRAME_BYTES = 1024 * 1024
const START_TIMEOUT_MS = 120_000
const BOOTSTRAP_TIMEOUT_MS = 300_000
const BUILD_TIMEOUT_MS = 120_000
const STATUS_TIMEOUT_MS = 800
const SHUTDOWN_TIMEOUT_MS = 1500
const WAIT_READY_TIMEOUT_MS = 45_000
const WAIT_STOP_TIMEOUT_MS = 5000
const NAMESPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const OPEN_DESIGN_NPMRC_FILENAME = 'open-design-empty.npmrc'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/'

function publicStatus(input: {
  canOpen: boolean
  enabled: boolean
  message?: string
  reason?: OpenDesignRuntimeReason
  state: OpenDesignRuntimeState
  updatedAt: number
  windowOpen: boolean
}): OpenDesignRuntimeStatus {
  return input
}

function sanitizePublicError(reason: OpenDesignRuntimeReason): string {
  switch (reason) {
    case 'not-configured':
      return `Set ${OPEN_DESIGN_ROOT_ENV} to a local Open Design checkout.`
    case 'invalid-root':
      return 'Configured Open Design root failed validation.'
    case 'invalid-url':
      return 'Open Design reported an unsafe local web URL.'
    case 'ipc-unreachable':
      return 'Open Design sidecar IPC is not reachable.'
    case 'start-failed':
      return 'Open Design failed to start.'
    case 'stop-failed':
      return 'Open Design did not stop in time.'
    case 'stopped':
      return 'Open Design is stopped.'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parsePackageName(raw: string, label: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${label} package.json is not valid JSON`)
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} package.json must be an object`)
  }
  const name = (parsed as { name?: unknown }).name
  if (typeof name !== 'string') {
    throw new Error(`${label} package.json must include a string name`)
  }
  return name
}

export function createOpenDesignNamespace(random = randomBytes): string {
  return `rox-${random(16).toString('hex')}`
}

export function normalizeOpenDesignNamespace(namespace: string): string {
  if (!NAMESPACE_RE.test(namespace) || namespace.includes('/') || namespace.includes('\\')) {
    throw new Error('Open Design namespace contains unsupported characters')
  }
  return namespace
}

export function resolveOpenDesignIpcPath({
  app,
  ipcBase,
  namespace,
  platform = process.platform,
}: {
  app: OpenDesignAppName
  ipcBase: string
  namespace: string
  platform?: NodeJS.Platform
}): string {
  normalizeOpenDesignNamespace(namespace)
  if (app !== 'daemon' && app !== 'web') {
    throw new Error(`unsupported Open Design sidecar app: ${app}`)
  }
  if (platform === 'win32') {
    return `\\\\.\\pipe\\open-design-${namespace}-${app}`
  }
  return join(resolve(ipcBase), namespace, `${app}.sock`)
}

export async function resolveConfiguredOpenDesignRoot({
  env = process.env,
  readPackageFile = (path: string, encoding: BufferEncoding) => readFile(path, encoding),
  realpathFn = realpath,
}: {
  env?: NodeJS.ProcessEnv
  readPackageFile?: ReadPackageFileFn
  realpathFn?: RealpathFn
} = {}): Promise<OpenDesignRootResolution> {
  const configured = env[OPEN_DESIGN_ROOT_ENV]
  if (configured == null || configured.trim() === '') {
    return {
      ok: false,
      reason: 'not-configured',
      message: sanitizePublicError('not-configured'),
    }
  }
  if (configured.includes('\0') || configured.trim() !== configured || !isAbsolute(configured)) {
    return {
      ok: false,
      reason: 'invalid-root',
      message: sanitizePublicError('invalid-root'),
    }
  }

  try {
    // Trust boundary: ROX runs the explicit same-UID checkout chosen by
    // ROX_OPEN_DESIGN_ROOT. A hostile checkout at that path is equivalent to
    // running local user code and is outside the renderer trust boundary.
    const root = await realpathFn(configured)
    if (!isAbsolute(root)) {
      throw new Error('resolved root is not absolute')
    }
    const [rootPackage, toolsDevPackage] = await Promise.all([
      readPackageFile(join(root, 'package.json'), 'utf8'),
      readPackageFile(join(root, 'tools', 'dev', 'package.json'), 'utf8'),
    ])
    if (parsePackageName(String(rootPackage), 'Open Design root') !== 'open-design') {
      throw new Error('root package name mismatch')
    }
    if (parsePackageName(String(toolsDevPackage), 'Open Design tools-dev') !== '@open-design/tools-dev') {
      throw new Error('tools-dev package name mismatch')
    }
    return { ok: true, root }
  } catch {
    return {
      ok: false,
      reason: 'invalid-root',
      message: sanitizePublicError('invalid-root'),
    }
  }
}

function isAllowedInheritedEnvKey(key: string, platform: NodeJS.Platform): boolean {
  const normalized = key.toUpperCase()
  if (
    normalized === 'PATH'
    || normalized === 'HOME'
    || normalized === 'USERPROFILE'
    || normalized === 'TMPDIR'
    || normalized === 'TEMP'
    || normalized === 'TMP'
    || normalized === 'LANG'
    || normalized.startsWith('LC_')
  ) {
    return true
  }

  return platform === 'win32' && (
    normalized === 'COMSPEC'
    || normalized === 'PATHEXT'
    || normalized === 'SYSTEMROOT'
    || normalized === 'WINDIR'
  )
}

export function sanitizeOpenDesignEnv(parentEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value == null || !isAllowedInheritedEnvKey(key, platform)) continue
    env[key] = value
  }
  return env
}

function withOpenDesignNpmIsolation(
  parentEnv: NodeJS.ProcessEnv,
  npmUserConfigPath: string,
): NodeJS.ProcessEnv {
  return {
    ...sanitizeOpenDesignEnv(parentEnv),
    COREPACK_ENABLE_PROJECT_SPEC: '1',
    NPM_CONFIG_USERCONFIG: npmUserConfigPath,
    npm_config_registry: NPM_REGISTRY_URL,
    npm_config_userconfig: npmUserConfigPath,
  }
}

interface OpenDesignCommandOptions {
  npmUserConfigPath: string
  parentEnv: NodeJS.ProcessEnv
  root: string
}

export function buildOpenDesignBootstrapCommand({
  npmUserConfigPath,
  parentEnv,
  root,
}: OpenDesignCommandOptions): BufferedCommandRequest {
  return {
    command: 'mise',
    args: ['exec', '--', 'corepack', 'pnpm', 'install', '--frozen-lockfile'],
    cwd: root,
    env: withOpenDesignNpmIsolation(parentEnv, npmUserConfigPath),
    timeoutMs: BOOTSTRAP_TIMEOUT_MS,
  }
}

export function buildToolsDevBuildCommand({
  npmUserConfigPath,
  parentEnv,
  root,
}: OpenDesignCommandOptions): BufferedCommandRequest {
  return {
    command: 'mise',
    args: ['exec', '--', 'corepack', 'pnpm', '--filter', '@open-design/tools-dev', 'build'],
    cwd: root,
    env: withOpenDesignNpmIsolation(parentEnv, npmUserConfigPath),
    timeoutMs: BUILD_TIMEOUT_MS,
  }
}

export function buildToolsDevStartCommand({
  dataRoot,
  ipcBase,
  namespace,
  npmUserConfigPath,
  parentEnv,
  root,
  runtimeRoot,
}: {
  dataRoot: string
  ipcBase: string
  namespace: string
  npmUserConfigPath: string
  parentEnv: NodeJS.ProcessEnv
  root: string
  runtimeRoot: string
}): BufferedCommandRequest {
  const safeNamespace = normalizeOpenDesignNamespace(namespace)
  return {
    command: 'mise',
    args: [
      'exec',
      '--',
      'corepack',
      'pnpm',
      'tools-dev',
      'start',
      'web',
      '--namespace',
      safeNamespace,
      '--tools-dev-root',
      runtimeRoot,
      '--no-env-file',
      '--json',
    ],
    cwd: root,
    env: {
      ...withOpenDesignNpmIsolation(parentEnv, npmUserConfigPath),
      [DATA_DIR_ENV]: dataRoot,
      [SIDECAR_BASE_ENV]: runtimeRoot,
      [SIDECAR_IPC_BASE_ENV]: ipcBase,
    },
    timeoutMs: START_TIMEOUT_MS,
  }
}

function isMissingToolsDevCommand(error: unknown): boolean {
  const message = errorMessage(error)
  return /tools-dev/i.test(message) && /(not found|cannot find|enoent|no such file)/i.test(message)
}

function redactBufferedOutput(text: string): string {
  return text
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL)[A-Z0-9_]*=)[^\s]+/gi, '$1[redacted]')
    .replace(/:\/\/([^/@\s]+)@/g, '://[redacted]@')
}

function formatBufferedFailure(status: string, stdout: string, stderr: string): string {
  const output = redactBufferedOutput([stderr.trim(), stdout.trim()].filter(Boolean).join('\n')).slice(0, 4096)
  return output.length > 0
    ? `Open Design tools-dev exited with ${status}: ${output}`
    : `Open Design tools-dev exited with ${status}`
}

export async function runBufferedCommand(request: BufferedCommandRequest): Promise<BufferedCommandResult> {
  const options: SpawnOptions = {
    cwd: request.cwd,
    env: request.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }

  return await new Promise<BufferedCommandResult>((resolveRun, rejectRun) => {
    const child = spawn(request.command, request.args, options)
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const timeout = setTimeout(() => {
      settle(() => {
        child.kill()
        rejectRun(new Error('Open Design tools-dev start timed out'))
      })
    }, request.timeoutMs ?? START_TIMEOUT_MS)

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const append = (chunks: Buffer[], chunk: Buffer, currentBytes: number): number => {
      const next = currentBytes + chunk.byteLength
      if (next > JSON_IPC_MAX_FRAME_BYTES) {
        settle(() => {
          child.kill()
          rejectRun(new Error('Open Design tools-dev output exceeded frame limit'))
        })
        return next
      }
      chunks.push(chunk)
      return next
    }

    child.once('error', (error) => {
      settle(() => rejectRun(error))
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes = append(stdoutChunks, chunk, stdoutBytes)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes = append(stderrChunks, chunk, stderrBytes)
    })
    child.once('exit', (code, signal) => {
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        if (code === 0) {
          resolveRun({ stdout, stderr })
          return
        }
        rejectRun(new Error(formatBufferedFailure(String(signal ?? code ?? 'unknown status'), stdout, stderr)))
      })
    })
  })
}

function assertSidecarStatusSnapshot(value: unknown, label: string): SidecarStatusSnapshot {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} status must be an object`)
  }
  const record = value as { state?: unknown; url?: unknown }
  if (
    record.state !== 'idle'
    && record.state !== 'running'
    && record.state !== 'starting'
    && record.state !== 'stopped'
    && record.state !== 'unknown'
  ) {
    throw new Error(`${label} status has an unsupported state`)
  }
  if (record.url !== null && typeof record.url !== 'string') {
    throw new Error(`${label} status url must be a string or null`)
  }
  return { state: record.state, url: record.url }
}

function assertSidecarShutdownResult(value: unknown, label: string): void {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} shutdown result must be an object`)
  }
  if ((value as { accepted?: unknown }).accepted !== true) {
    throw new Error(`${label} shutdown result was not accepted`)
  }
}

export async function requestOpenDesignSidecar<T = unknown>(
  socketPath: string,
  payload: unknown,
  {
    maxFrameBytes = JSON_IPC_MAX_FRAME_BYTES,
    timeoutMs = STATUS_TIMEOUT_MS,
  }: {
    maxFrameBytes?: number
    timeoutMs?: number
  } = {},
): Promise<T> {
  const frame = `${JSON.stringify(payload)}\n`
  if (Buffer.byteLength(frame) > maxFrameBytes) {
    throw new Error('IPC request exceeded frame limit')
  }

  return await new Promise<T>((resolveRequest, rejectRequest) => {
    const socket = createConnection(socketPath)
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let bytes = 0
    let settled = false
    const timeout = setTimeout(() => {
      settle(() => {
        socket.destroy()
        rejectRequest(new Error('IPC request timed out'))
      })
    }, timeoutMs)

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.removeAllListeners()
      callback()
    }

    socket.once('connect', () => {
      socket.write(frame)
    })
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > maxFrameBytes) {
        settle(() => {
          socket.destroy()
          rejectRequest(new Error('IPC response exceeded frame limit'))
        })
        return
      }
      buffer += decoder.write(chunk)
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const responseFrame = buffer.slice(0, newlineIndex)
      settle(() => {
        socket.end()
        let parsed: unknown
        try {
          parsed = JSON.parse(responseFrame)
        } catch {
          rejectRequest(new Error('IPC response was not valid JSON'))
          return
        }
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          rejectRequest(new Error('IPC response must be an object'))
          return
        }
        const response = parsed as { error?: unknown; ok?: unknown; result?: unknown }
        if (response.ok !== true) {
          const error = response.error
          const message = error != null && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'IPC request failed'
          rejectRequest(new Error(message))
          return
        }
        resolveRequest(response.result as T)
      })
    })
    socket.once('error', (error) => {
      settle(() => rejectRequest(error))
    })
  })
}

async function mkdirPrivate(
  dir: string,
  mkdirFn: typeof mkdir,
  chmodFn: typeof chmod,
): Promise<void> {
  await mkdirFn(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    await chmodFn(dir, 0o700)
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

export class OpenDesignRuntimeManager {
  private readonly chmodFn: typeof chmod
  private readonly env: NodeJS.ProcessEnv
  private readonly mkdirFn: typeof mkdir
  private readonly now: () => number
  private readonly readFileFn: ReadPackageFileFn
  private readonly realpathFn: RealpathFn
  private readonly requestSidecarFn: typeof requestOpenDesignSidecar
  private readonly runCommandFn: typeof runBufferedCommand
  private readonly userDataDir: string
  private readonly windowController: OpenDesignWindowLike | undefined
  private readonly writeFileFn: WriteFileFn
  private bootstrappedRoot: string | null = null
  private bootstrapPromise: Promise<void> | null = null
  private current: CurrentRuntime | null = null
  private startPromise: Promise<OpenDesignRuntimeStatus> | null = null
  private stopPromise: Promise<OpenDesignRuntimeStatus> | null = null

  constructor(deps: OpenDesignRuntimeManagerDeps) {
    this.chmodFn = deps.chmod ?? chmod
    this.env = deps.env ?? process.env
    this.mkdirFn = deps.mkdir ?? mkdir
    this.now = deps.now ?? Date.now
    this.readFileFn = deps.readFile ?? ((path, encoding) => readFile(path, encoding))
    this.realpathFn = deps.realpath ?? realpath
    this.requestSidecarFn = deps.requestSidecar ?? requestOpenDesignSidecar
    this.runCommandFn = deps.runCommand ?? runBufferedCommand
    this.userDataDir = deps.userDataDir
    this.windowController = deps.windowController
    this.writeFileFn = deps.writeFile ?? writeFile
  }

  hasActiveRuntime(): boolean {
    return this.current != null || this.startPromise != null || this.stopPromise != null
  }

  async open(): Promise<OpenDesignRuntimeStatus> {
    const status = await this.ensureStarted()
    if (status.state !== 'running' || this.current?.webUrl == null) {
      return status
    }

    try {
      await this.windowController?.open(this.current.webUrl)
      return await this.status()
    } catch {
      if (this.current) {
        this.current.state = 'error'
        this.current.updatedAt = this.now()
      }
      return publicStatus({
        canOpen: true,
        enabled: true,
        message: sanitizePublicError('invalid-url'),
        reason: 'invalid-url',
        state: 'error',
        updatedAt: this.now(),
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    }
  }

  async status(): Promise<OpenDesignRuntimeStatus> {
    const current = this.current
    if (!current) {
      const root = await this.resolveRoot()
      if (!root.ok) return this.disabledStatus(root.reason ?? 'invalid-root')
      return publicStatus({
        canOpen: true,
        enabled: true,
        state: 'idle',
        updatedAt: this.now(),
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    }

    if (current.failureReason != null) {
      return publicStatus({
        canOpen: false,
        enabled: true,
        message: sanitizePublicError(current.failureReason),
        reason: current.failureReason,
        state: 'error',
        updatedAt: current.updatedAt,
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    }

    if (current.state === 'starting' || current.state === 'stopping') {
      return publicStatus({
        canOpen: current.state !== 'stopping',
        enabled: true,
        state: current.state,
        updatedAt: current.updatedAt,
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    }

    try {
      const { web } = await this.inspectCurrent()
      if (web.url != null && web.state === 'running') {
        current.webUrl = validateOpenDesignInitialUrl(web.url)
        current.state = 'running'
        current.updatedAt = this.now()
        return publicStatus({
          canOpen: true,
          enabled: true,
          state: 'running',
          updatedAt: current.updatedAt,
          windowOpen: this.windowController?.hasWindow() ?? false,
        })
      }
      current.state = web.state === 'starting' ? 'starting' : 'error'
      current.updatedAt = this.now()
      return publicStatus({
        canOpen: true,
        enabled: true,
        message: sanitizePublicError('ipc-unreachable'),
        reason: 'ipc-unreachable',
        state: current.state,
        updatedAt: current.updatedAt,
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    } catch (error) {
      const reason: OpenDesignRuntimeReason = errorMessage(error).includes('web URL') ? 'invalid-url' : 'ipc-unreachable'
      current.state = 'error'
      current.failureReason = reason
      current.updatedAt = this.now()
      return publicStatus({
        canOpen: true,
        enabled: true,
        message: sanitizePublicError(reason),
        reason,
        state: 'error',
        updatedAt: current.updatedAt,
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    }
  }

  async stop(): Promise<OpenDesignRuntimeStatus> {
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined)
    }
    if (this.stopPromise) return await this.stopPromise
    this.stopPromise = this.stopCurrent().finally(() => {
      this.stopPromise = null
    })
    return await this.stopPromise
  }

  private async ensureStarted(): Promise<OpenDesignRuntimeStatus> {
    if (this.stopPromise) {
      await this.stopPromise.catch(() => undefined)
    }
    if (this.startPromise) return await this.startPromise
    const current = this.current
    if (current?.state === 'running') {
      const status = await this.status()
      if (status.state === 'running') return status
    }
    if (current?.failureReason != null || current?.state === 'error') {
      const stopped = await this.shutdownNamespace(current)
      if (!stopped) {
        current.failureReason = current.failureReason ?? 'start-failed'
        current.state = 'error'
        current.updatedAt = this.now()
        return await this.status()
      }
      this.current = null
    }
    this.startPromise = this.startFresh().finally(() => {
      this.startPromise = null
    })
    return await this.startPromise
  }

  private async startFresh(): Promise<OpenDesignRuntimeStatus> {
    const root = await this.resolveRoot()
    if (!root.ok || root.root == null) {
      this.current = null
      return this.disabledStatus(root.reason ?? 'invalid-root')
    }

    const namespace = createOpenDesignNamespace()
    const dataRoot = join(this.userDataDir, 'data')
    const runtimeRoot = join(this.userDataDir, 'sidecar')
    const ipcBase = join(this.userDataDir, 'ipc')
    this.current = {
      dataRoot,
      ipcBase,
      namespace,
      root: root.root,
      runtimeRoot,
      state: 'starting',
      updatedAt: this.now(),
    }

    try {
      await mkdirPrivate(this.userDataDir, this.mkdirFn, this.chmodFn)
      await mkdirPrivate(dataRoot, this.mkdirFn, this.chmodFn)
      await mkdirPrivate(runtimeRoot, this.mkdirFn, this.chmodFn)
      await mkdirPrivate(ipcBase, this.mkdirFn, this.chmodFn)
      const npmUserConfigPath = join(this.userDataDir, OPEN_DESIGN_NPMRC_FILENAME)
      await this.prepareNpmUserConfig(npmUserConfigPath)
      await this.ensureBootstrapped(root.root, npmUserConfigPath)

      await this.startToolsDev({
        dataRoot,
        ipcBase,
        namespace,
        npmUserConfigPath,
        parentEnv: this.env,
        root: root.root,
        runtimeRoot,
      })

      const web = await this.waitForReady()
      this.current.webUrl = web.url
      this.current.state = 'running'
      this.current.updatedAt = this.now()
      return publicStatus({
        canOpen: true,
        enabled: true,
        state: 'running',
        updatedAt: this.current.updatedAt,
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    } catch (error) {
      const failedCurrent = this.current
      const reason: OpenDesignRuntimeReason = errorMessage(error).includes('web URL') ? 'invalid-url' : 'start-failed'
      if (failedCurrent) {
        failedCurrent.state = 'stopping'
        failedCurrent.updatedAt = this.now()
        const stopped = await this.shutdownNamespace(failedCurrent)
        if (stopped && this.current === failedCurrent) {
          this.current = null
        } else if (this.current === failedCurrent) {
          failedCurrent.state = 'error'
          failedCurrent.failureReason = reason
          failedCurrent.updatedAt = this.now()
        }
      }
      return publicStatus({
        canOpen: true,
        enabled: true,
        message: sanitizePublicError(reason),
        reason,
        state: 'error',
        updatedAt: this.now(),
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    }
  }

  private async stopCurrent(): Promise<OpenDesignRuntimeStatus> {
    const current = this.current
    this.windowController?.close()
    if (!current) {
      return await this.status()
    }
    current.state = 'stopping'
    current.updatedAt = this.now()

    const stopped = await this.shutdownNamespace(current)
    if (!stopped) {
      current.state = 'error'
      current.failureReason = 'stop-failed'
      current.updatedAt = this.now()
      return publicStatus({
        canOpen: false,
        enabled: true,
        message: sanitizePublicError('stop-failed'),
        reason: 'stop-failed',
        state: 'error',
        updatedAt: current.updatedAt,
        windowOpen: this.windowController?.hasWindow() ?? false,
      })
    }

    this.current = null
    const root = await this.resolveRoot()
    if (!root.ok) return this.disabledStatus(root.reason ?? 'not-configured')
    return publicStatus({
      canOpen: true,
      enabled: true,
      message: sanitizePublicError('stopped'),
      reason: 'stopped',
      state: 'idle',
      updatedAt: this.now(),
      windowOpen: false,
    })
  }

  private disabledStatus(reason: Extract<OpenDesignRuntimeReason, 'invalid-root' | 'not-configured'>): OpenDesignRuntimeStatus {
    return publicStatus({
      canOpen: false,
      enabled: false,
      message: sanitizePublicError(reason),
      reason,
      state: 'disabled',
      updatedAt: this.now(),
      windowOpen: this.windowController?.hasWindow() ?? false,
    })
  }

  private async resolveRoot(): Promise<OpenDesignRootResolution> {
    return await resolveConfiguredOpenDesignRoot({
      env: this.env,
      readPackageFile: this.readFileFn,
      realpathFn: this.realpathFn,
    })
  }

  private async prepareNpmUserConfig(npmUserConfigPath: string): Promise<void> {
    await this.writeFileFn(npmUserConfigPath, '', { mode: 0o600 })
    if (process.platform !== 'win32') {
      await this.chmodFn(npmUserConfigPath, 0o600)
    }
  }

  private async ensureBootstrapped(root: string, npmUserConfigPath: string): Promise<void> {
    if (this.bootstrappedRoot === root) return
    if (this.bootstrapPromise) {
      await this.bootstrapPromise
      if (this.bootstrappedRoot === root) return
    }

    if (!this.bootstrapPromise) {
      // The configured checkout is trusted same-UID code. Bootstrap runs only
      // through the project-pinned toolchain and with a bridge-owned npmrc.
      this.bootstrapPromise = this.runCommandFn(buildOpenDesignBootstrapCommand({
        npmUserConfigPath,
        parentEnv: this.env,
        root,
      })).then(() => {
        this.bootstrappedRoot = root
      }).finally(() => {
        this.bootstrapPromise = null
      })
    }
    await this.bootstrapPromise
  }

  private async startToolsDev(options: {
    dataRoot: string
    ipcBase: string
    namespace: string
    npmUserConfigPath: string
    parentEnv: NodeJS.ProcessEnv
    root: string
    runtimeRoot: string
  }): Promise<void> {
    const startCommand = buildToolsDevStartCommand(options)
    try {
      await this.runCommandFn(startCommand)
      return
    } catch (error) {
      if (!isMissingToolsDevCommand(error)) throw error
    }

    await this.runCommandFn(buildToolsDevBuildCommand({
      npmUserConfigPath: options.npmUserConfigPath,
      parentEnv: options.parentEnv,
      root: options.root,
    }))
    await this.runCommandFn(startCommand)
  }

  private ipcPath(app: OpenDesignAppName, current = this.current): string {
    if (!current) throw new Error('Open Design runtime is not initialized')
    return resolveOpenDesignIpcPath({ app, ipcBase: current.ipcBase, namespace: current.namespace })
  }

  private async requestStatus(app: OpenDesignAppName, current = this.current): Promise<SidecarStatusSnapshot> {
    const result = await this.requestSidecarFn(this.ipcPath(app, current), { type: 'status' }, { timeoutMs: STATUS_TIMEOUT_MS })
    return assertSidecarStatusSnapshot(result, app)
  }

  private async requestShutdown(app: OpenDesignAppName, current = this.current): Promise<void> {
    const result = await this.requestSidecarFn(this.ipcPath(app, current), { type: 'shutdown' }, { timeoutMs: SHUTDOWN_TIMEOUT_MS })
    assertSidecarShutdownResult(result, app)
  }

  private async shutdownNamespace(current: CurrentRuntime): Promise<boolean> {
    await this.requestShutdown('web', current).catch(() => undefined)
    const webUnreachable = await this.waitUntilUnreachable('web', current)
    await this.requestShutdown('daemon', current).catch(() => undefined)
    const daemonUnreachable = await this.waitUntilUnreachable('daemon', current)
    return webUnreachable && daemonUnreachable
  }

  private async inspectCurrent(): Promise<{ daemon: SidecarStatusSnapshot; web: SidecarStatusSnapshot }> {
    const current = this.current
    if (!current) throw new Error('Open Design runtime is not initialized')
    const [daemon, web] = await Promise.all([
      this.requestStatus('daemon', current),
      this.requestStatus('web', current),
    ])
    return { daemon, web }
  }

  private async waitForReady(): Promise<{ url: string }> {
    const startedAt = this.now()
    while (this.now() - startedAt < WAIT_READY_TIMEOUT_MS) {
      const current = this.current
      if (!current) throw new Error('Open Design runtime is not initialized')
      try {
        const { daemon, web } = await this.inspectCurrent()
        if (daemon.state === 'running' && web.state === 'running' && web.url != null) {
          const normalized = validateOpenDesignInitialUrl(web.url)
          return { url: normalized }
        }
      } catch (error) {
        if (errorMessage(error).includes('web URL')) {
          throw error
        }
        // Sidecars can expose their sockets after the tools-dev command exits.
      }
      await wait(150)
    }
    throw new Error('Open Design sidecars did not expose status in time')
  }

  private async waitUntilUnreachable(app: OpenDesignAppName, current: CurrentRuntime): Promise<boolean> {
    const startedAt = this.now()
    while (this.now() - startedAt < WAIT_STOP_TIMEOUT_MS) {
      try {
        await this.requestStatus(app, current)
      } catch {
        return true
      }
      await wait(120)
    }
    return false
  }

}

export function registerOpenDesignIpcHandlers({
  ipcMain,
  isTrustedSender,
  runtime,
}: {
  ipcMain: Pick<IpcMain, 'handle'>
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  runtime: Pick<OpenDesignRuntimeManager, 'open' | 'status' | 'stop'>
}): void {
  const trusted = async (
    event: IpcMainInvokeEvent,
    operation: () => Promise<OpenDesignRuntimeStatus>,
  ): Promise<OpenDesignRuntimeStatus> => {
    if (!isTrustedSender(event)) {
      throw new Error('Open Design IPC is only available to Rox renderer windows')
    }
    return await operation()
  }

  ipcMain.handle(OPEN_DESIGN_IPC_CHANNELS.OPEN, (event) => trusted(event, () => runtime.open()))
  ipcMain.handle(OPEN_DESIGN_IPC_CHANNELS.STATUS, (event) => trusted(event, () => runtime.status()))
  ipcMain.handle(OPEN_DESIGN_IPC_CHANNELS.STOP, (event) => trusted(event, () => runtime.stop()))
}
