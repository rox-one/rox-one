/**
 * CogneeGraphProvider: GraphMemoryProvider over the cognee sidecar process.
 *
 * - Lazy: nothing spawns until the first ingest/search; a cold search returns
 *   [] immediately and kicks off warm-up in the background (never blocks a turn).
 * - Idle-killed after `idleMs` without requests; restarts on next use.
 * - The LLM key is passed only through the child env; it is never logged and
 *   never included in errors or status.
 */
import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import type {
  GraphMemoryDocument,
  GraphMemoryHit,
  GraphMemoryProvider,
  GraphMemoryState,
  GraphMemoryStatus,
  GraphSearchMode,
} from '@rox/shared/memory/graph-provider'

export const DEFAULT_IDLE_MS = 10 * 60_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const MAX_PENDING = 64

export interface SidecarLaunch {
  python: string
  env: Record<string, string>
}

export interface CogneeProviderDeps {
  workspaceId: string
  /** Storage root, `~/rox/memory/cognee/<workspaceId>`. */
  storageDir: string
  /** Ensure the runtime is installed; resolves the python path or null (unavailable). */
  ensureRuntime: () => Promise<string | null>
  /** Resolve the LLM key (build-time shared key / credential store). Never logged. */
  resolveLlmKey: () => Promise<string | null>
  llmEndpoint?: string
  llmModel?: string
  llmFallbackModel?: string
  idleMs?: number
  requestTimeoutMs?: number
  /** Test seam. */
  spawnFn?: (cmd: string, args: string[], env: Record<string, string>) => ChildProcess
  logger?: { warn: (m: string, e?: unknown) => void }
  /** Master toggle (Settings → Память); checked on every call. */
  isEnabled?: () => boolean
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class CogneeGraphProvider implements GraphMemoryProvider {
  readonly id = 'cognee'
  private child: ChildProcess | null = null
  private starting: Promise<boolean> | null = null
  private state: GraphMemoryState = 'cold'
  private safeError: string | undefined
  private documents: number | undefined
  private nextId = 1
  private pending = new Map<number, Pending>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: CogneeProviderDeps) {}

  status(): GraphMemoryStatus {
    if (this.deps.isEnabled && !this.deps.isEnabled()) return { state: 'disabled', provider: this.id }
    return {
      state: this.state,
      provider: this.id,
      ...(this.documents !== undefined ? { documents: this.documents } : {}),
      ...(this.safeError ? { safeError: this.safeError } : {}),
    }
  }

  private enabled(): boolean {
    return !this.deps.isEnabled || this.deps.isEnabled()
  }

  /** Start (or join) the sidecar; resolves true when ready. */
  warm(): Promise<boolean> {
    if (this.child && this.state === 'ready') return Promise.resolve(true)
    this.starting ??= this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<boolean> {
    this.state = 'warming'
    try {
      const python = await this.deps.ensureRuntime()
      if (!python) {
        this.state = 'not_installed'
        return false
      }
      const key = (await this.deps.resolveLlmKey()) ?? ''
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        ROX_COGNEE_ROOT: this.deps.storageDir,
        ROX_COGNEE_LLM_ENDPOINT: this.deps.llmEndpoint ?? 'https://api.rox.one/v1',
        ROX_COGNEE_LLM_MODEL: this.deps.llmModel ?? 'rox/r1-max',
        ROX_COGNEE_LLM_FALLBACK_MODEL: this.deps.llmFallbackModel ?? 'rox/fast',
        ROX_COGNEE_LLM_API_KEY: key,
        // Also expose under the build-injected name for diagnostics (never logged).
        ROX_SHARED_API_KEY: key,
      }
      if (process.platform === 'win32') {
        for (const k of ['SYSTEMROOT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
          if (process.env[k]) env[k] = process.env[k]!
        }
      }
      const spawnFn =
        this.deps.spawnFn ??
        ((cmd, args, e) => spawn(cmd, args, { env: e, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }))
      const child = spawnFn(python, ['-m', 'rox_cognee_sidecar'], env)
      this.child = child
      child.on('exit', () => this.onExit(child))
      child.on('error', err => {
        this.deps.logger?.warn('cognee sidecar spawn error', err)
        this.onExit(child)
      })
      // stderr is drained but not forwarded verbatim (could echo document text).
      child.stderr?.on('data', () => {})
      createInterface({ input: child.stdout! }).on('line', line => this.onLine(line))
      const hello = (await this.request('hello', {}, 30_000)) as { protocol?: number } | null
      if (!hello || hello.protocol !== 1) throw new Error('sidecar protocol mismatch')
      this.state = 'ready'
      this.safeError = undefined
      this.touch()
      void this.refreshStatus()
      return true
    } catch (err) {
      this.deps.logger?.warn('cognee sidecar start failed', err)
      this.state = 'failed'
      this.safeError = 'sidecar unavailable'
      this.kill()
      return false
    }
  }

  private async refreshStatus(): Promise<void> {
    try {
      const s = (await this.request('status', {})) as { documents?: number }
      if (typeof s?.documents === 'number') this.documents = s.documents
    } catch {
      /* status is best-effort */
    }
  }

  private onLine(line: string): void {
    let frame: { id?: unknown; result?: unknown; error?: { code?: string; message?: string } }
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }
    if (typeof frame.id !== 'number') return
    const p = this.pending.get(frame.id)
    if (!p) return
    this.pending.delete(frame.id)
    clearTimeout(p.timer)
    if (frame.error) p.reject(new Error(`sidecar ${String(frame.error.code ?? 'error')}`))
    else p.resolve(frame.result)
  }

  private onExit(child: ChildProcess): void {
    if (this.child !== child) return
    this.child = null
    if (this.state === 'ready' || this.state === 'warming') this.state = 'cold'
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('sidecar exited'))
    }
    this.pending.clear()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const child = this.child
    if (!child?.stdin || child.stdin.destroyed) return Promise.reject(new Error('sidecar not running'))
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error('sidecar busy'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('sidecar timeout'))
      }, timeoutMs ?? this.deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`, err => {
        if (err) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new Error('sidecar write failed'))
        }
      })
    })
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.shutdown(), this.deps.idleMs ?? DEFAULT_IDLE_MS)
    this.idleTimer.unref?.()
  }

  async ingest(docs: readonly GraphMemoryDocument[]): Promise<void> {
    if (!this.enabled() || docs.length === 0) return
    if (!(await this.warm())) return
    this.touch()
    const payload = docs
      .filter(d => d.provenance?.originClass === 'owner' || d.provenance?.originClass === 'agent')
      .map(d => ({ id: d.id, source: d.source, text: d.text, provenance: d.provenance }))
    for (let i = 0; i < payload.length; i += 100) {
      await this.request('add', { docs: payload.slice(i, i + 100) })
    }
  }

  /** Run graph extraction (LLM-heavy). Callers gate this with the daily cost cap. */
  async cognify(sources?: string[]): Promise<void> {
    if (!this.enabled() || !(await this.warm())) return
    this.touch()
    await this.request('cognify', sources ? { sources } : {}, 30 * 60_000)
    void this.refreshStatus()
  }

  async search(
    query: string,
    opts?: { mode?: GraphSearchMode; limit?: number; signal?: AbortSignal },
  ): Promise<GraphMemoryHit[]> {
    if (!this.enabled()) return []
    if (this.state !== 'ready' || !this.child) {
      // Never block a turn on cold start: warm in background, answer empty now.
      void this.warm()
      return []
    }
    this.touch()
    const raw = (await this.request('search', {
      query,
      mode: opts?.mode ?? 'chunks',
      limit: Math.min(50, Math.max(1, opts?.limit ?? 8)),
    })) as unknown
    if (opts?.signal?.aborted || !Array.isArray(raw)) return []
    const observedAt = new Date().toISOString()
    return raw
      .filter((h): h is { id: string; source: string; text: string; score?: number; known?: boolean } =>
        !!h && typeof h.id === 'string' && typeof h.text === 'string')
      .map(h => ({
        id: h.id,
        source: (h.source as GraphMemoryHit['source']) ?? 'notes',
        text: h.text,
        score: typeof h.score === 'number' ? h.score : 0,
        // Graph-derived facts are agent-synthesised from gated inputs.
        provenance: { originClass: 'agent', sessionKind: 'subagent', observedAt },
      }))
  }

  async forget(ids: readonly string[]): Promise<void> {
    if (ids.length === 0 || !(await this.warm())) return
    this.touch()
    await this.request('delete', { ids: [...ids] })
  }

  shutdown(): void {
    const child = this.child
    if (!child) return
    try {
      child.stdin?.write(`${JSON.stringify({ id: 0, method: 'shutdown', params: {} })}\n`)
      child.stdin?.end()
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => this.kill(), 5_000)
    t.unref?.()
  }

  private kill(): void {
    const child = this.child
    if (!child) return
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    this.onExit(child)
  }
}
