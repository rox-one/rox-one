/**
 * Cognee runtime manager (cognee integration PR3).
 *
 * Installs the graph-memory Python runtime ON DEMAND (never at app start) into
 * `~/rox/runtime/cognee`:
 *   1. a pinned `uv` binary, sha256-verified against constants below;
 *   2. a uv-managed CPython 3.12;
 *   3. a venv synced from the sidecar's hash-locked `requirements.lock`
 *      (`uv pip sync --require-hashes`) plus the sidecar package itself.
 * The install is resumable: each step writes a marker, and a crash re-runs only
 * missing steps. A failed install leaves the native memory stack untouched.
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const UV_VERSION = '0.12.17'
export const PYTHON_VERSION = '3.12'
/** Bump to force re-sync of the venv (e.g. new requirements.lock). */
export const RUNTIME_LAYOUT_VERSION = 1

/** sha256 of the official uv release archives for {@link UV_VERSION}. */
export const UV_SHA256: Record<string, { file: string; sha256: string }> = {
  'darwin-arm64': { file: 'uv-aarch64-apple-darwin.tar.gz', sha256: '85f00cbdc6dd3e97eba4c31b4d014375a9fdfe8f570023b84e5102fc3456896b' },
  'darwin-x64': { file: 'uv-x86_64-apple-darwin.tar.gz', sha256: '8dcf05a8c809bb3c471d2b614788ba27a6e41298fc8c31ac84b5f4339fd468e5' },
  'linux-x64': { file: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: 'fa82fd8dde8e8eefdecada6aa0889666556cfceb690d06e0c3bca49eb3070a63' },
  'linux-arm64': { file: 'uv-aarch64-unknown-linux-gnu.tar.gz', sha256: 'd636d1b678e9e7f367ecb22b46bd1cabbed234d6bc3b4d96365d2b507f72f86c' },
  'win32-x64': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'a252121d5b59398fcb137c6ea448176459a44010f33f67e0072305a637119ca7' },
}

export function uvDownloadUrl(file: string): string {
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${file}`
}

export function defaultRoxHome(): string {
  return process.env.ROX_HOME || join(homedir(), 'rox')
}

export function cogneeRuntimeDir(roxHome = defaultRoxHome()): string {
  return join(roxHome, 'runtime', 'cognee')
}

/**
 * Per-workspace storage root: `~/rox/memory/cognee/<hash16>`.
 * Uses a sha1 prefix of the raw id so path-like / punctuated ids cannot collide
 * after sanitisation (e.g. `/w/foo-bar` vs `/w/foo_bar`).
 */
export function cogneeWorkspaceDir(workspaceId: string, roxHome = defaultRoxHome()): string {
  const raw = workspaceId.trim() || 'default'
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16)
  return join(roxHome, 'memory', 'cognee', hash)
}

export type InstallStep = 'uv' | 'python' | 'venv' | 'sidecar'
export const INSTALL_STEPS: readonly InstallStep[] = ['uv', 'python', 'venv', 'sidecar']

export interface RuntimeExec {
  /** Run a binary with args; resolves exit code. Must not use a shell. */
  run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> }): Promise<{ code: number; stderr: string }>
}

export interface RuntimeIo {
  download(url: string, dest: string): Promise<void>
  /** Extract a uv archive so that the `uv` binary lands at `destDir/uv[.exe]`. */
  extractUv(archive: string, destDir: string): Promise<void>
  sha256File(path: string): Promise<string>
}

export interface CogneeRuntimeDeps {
  runtimeDir?: string
  /** Directory of packages/cognee-sidecar as shipped in app resources. */
  sidecarSourceDir: string
  platform?: string
  arch?: string
  exec: RuntimeExec
  io: RuntimeIo
  logger?: { info?: (m: string) => void; warn: (m: string, e?: unknown) => void }
}

export type RuntimeState =
  | { state: 'not_installed' }
  | { state: 'installing'; step: InstallStep }
  | { state: 'installed'; python: string }
  | { state: 'failed'; step: InstallStep; safeError: string }
  | { state: 'unsupported'; platformKey: string }

export class CogneeRuntimeManager {
  private readonly dir: string
  private readonly platformKey: string
  private installing: Promise<RuntimeState> | null = null
  private current: RuntimeState

  constructor(private readonly deps: CogneeRuntimeDeps) {
    this.dir = deps.runtimeDir ?? cogneeRuntimeDir()
    this.platformKey = `${deps.platform ?? process.platform}-${deps.arch ?? process.arch}`
    this.current = this.isInstalled() ? { state: 'installed', python: this.pythonPath() } : { state: 'not_installed' }
  }

  get runtimeDir(): string {
    return this.dir
  }

  private get isWin(): boolean {
    return this.platformKey.startsWith('win32')
  }

  uvPath(): string {
    return join(this.dir, 'bin', this.isWin ? 'uv.exe' : 'uv')
  }

  pythonPath(): string {
    return this.isWin ? join(this.dir, 'venv', 'Scripts', 'python.exe') : join(this.dir, 'venv', 'bin', 'python')
  }

  private marker(step: InstallStep): string {
    return join(this.dir, 'state', `${step}.done`)
  }

  private stepDone(step: InstallStep): boolean {
    try {
      return readFileSync(this.marker(step), 'utf8').trim() === this.stamp()
    } catch {
      return false
    }
  }

  private stamp(): string {
    let lockHash = 'nolock'
    let srcHash = 'nosrc'
    try {
      lockHash = createHash('sha256').update(readFileSync(join(this.deps.sidecarSourceDir, 'requirements.lock'))).digest('hex').slice(0, 16)
    } catch {
      /* missing lock -> venv step will fail loudly */
    }
    try {
      srcHash = this.hashSidecarSources().slice(0, 16)
    } catch {
      /* missing sources -> sidecar step will fail loudly */
    }
    return `v${RUNTIME_LAYOUT_VERSION}:uv${UV_VERSION}:py${PYTHON_VERSION}:${lockHash}:${srcHash}`
  }

  /** Content hash of pyproject + Python package so code updates invalidate the sidecar step. */
  private hashSidecarSources(): string {
    const h = createHash('sha256')
    const root = this.deps.sidecarSourceDir
    const files: string[] = [join(root, 'pyproject.toml')]
    const pkg = join(root, 'rox_cognee_sidecar')
    if (existsSync(pkg)) {
      for (const name of readdirSync(pkg).sort()) {
        if (name.endsWith('.py')) files.push(join(pkg, name))
      }
    }
    for (const f of files) {
      try {
        h.update(f)
        h.update(readFileSync(f))
      } catch {
        /* skip missing */
      }
    }
    return h.digest('hex')
  }

  isInstalled(): boolean {
    return INSTALL_STEPS.every(s => this.stepDone(s)) && existsSync(this.pythonPath())
  }

  status(): RuntimeState {
    return this.current
  }

  /** Idempotent, single-flight, resumable install. */
  ensureInstalled(): Promise<RuntimeState> {
    if (this.isInstalled()) return Promise.resolve((this.current = { state: 'installed', python: this.pythonPath() }))
    if (!UV_SHA256[this.platformKey]) return Promise.resolve((this.current = { state: 'unsupported', platformKey: this.platformKey }))
    this.installing ??= this.install().finally(() => {
      this.installing = null
    })
    return this.installing
  }

  private async install(): Promise<RuntimeState> {
    mkdirSync(join(this.dir, 'state'), { recursive: true })
    for (const step of INSTALL_STEPS) {
      if (this.stepDone(step)) continue
      this.current = { state: 'installing', step }
      try {
        await this.runStep(step)
        writeFileSync(this.marker(step), this.stamp())
      } catch (err) {
        this.deps.logger?.warn(`cognee runtime: step ${step} failed`, err)
        const safeError = err instanceof Error ? err.message.slice(0, 200) : 'install failed'
        return (this.current = { state: 'failed', step, safeError })
      }
    }
    return (this.current = { state: 'installed', python: this.pythonPath() })
  }

  private uvEnv(): Record<string, string> {
    return {
      UV_PYTHON_INSTALL_DIR: join(this.dir, 'python'),
      UV_CACHE_DIR: join(this.dir, 'cache'),
      UV_NO_CONFIG: '1',
      UV_PYTHON_PREFERENCE: 'only-managed',
    }
  }

  private async mustRun(args: string[]): Promise<void> {
    const r = await this.deps.exec.run(this.uvPath(), args, { cwd: this.dir, env: this.uvEnv() })
    if (r.code !== 0) throw new Error(`uv ${args[0]} ${args[1] ?? ''} exited ${r.code}`)
  }

  private async runStep(step: InstallStep): Promise<void> {
    switch (step) {
      case 'uv': {
        const asset = UV_SHA256[this.platformKey]!
        const dl = join(this.dir, 'download', asset.file)
        mkdirSync(join(this.dir, 'download'), { recursive: true })
        await this.deps.io.download(uvDownloadUrl(asset.file), dl)
        const got = await this.deps.io.sha256File(dl)
        if (got !== asset.sha256) {
          rmSync(dl, { force: true })
          throw new Error('uv checksum mismatch')
        }
        mkdirSync(join(this.dir, 'bin'), { recursive: true })
        await this.deps.io.extractUv(dl, join(this.dir, 'bin'))
        rmSync(dl, { force: true })
        if (!existsSync(this.uvPath())) throw new Error('uv binary missing after extract')
        return
      }
      case 'python':
        return this.mustRun(['python', 'install', PYTHON_VERSION])
      case 'venv':
        rmSync(join(this.dir, 'venv'), { recursive: true, force: true })
        await this.mustRun(['venv', '--python', PYTHON_VERSION, join(this.dir, 'venv')])
        return this.mustRun([
          'pip', 'sync', '--require-hashes', '--python', this.pythonPath(),
          join(this.deps.sidecarSourceDir, 'requirements.lock'),
        ])
      case 'sidecar':
        // --no-build-isolation: build backend (setuptools) comes from the
        // hash-locked venv sync, so we never fetch an unpinned hatchling/etc.
        return this.mustRun([
          'pip', 'install', '--no-deps', '--no-build-isolation',
          '--python', this.pythonPath(), this.deps.sidecarSourceDir,
        ])
    }
  }

  /** Remove the runtime (not user memory data). */
  uninstall(): void {
    rmSync(this.dir, { recursive: true, force: true })
    this.current = { state: 'not_installed' }
  }
}
