/**
 * Production wiring for the cognee graph layer: real download/extract/exec,
 * the LLM key resolver and the per-workspace provider resolver. Nothing here
 * runs at import time; every side effect happens on first graph-memory use.
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { GraphMemoryProvider } from '@rox/shared/memory/graph-provider'
import { CogneeGraphProvider } from './cognee-provider'
import { CogneeRuntimeManager, cogneeWorkspaceDir, type RuntimeExec, type RuntimeIo } from './cognee-runtime'

const INSTALL_STEP_TIMEOUT_MS = 15 * 60_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000

export const nodeRuntimeExec: RuntimeExec = {
  run(cmd, args, opts) {
    return new Promise(resolve => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        shell: false,
      })
      let stderr = ''
      let settled = false
      const finish = (code: number, errText: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, stderr: errText })
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        finish(-1, 'timeout')
      }, INSTALL_STEP_TIMEOUT_MS)
      timer.unref?.()
      child.stderr?.on('data', d => {
        if (stderr.length < 4000) stderr += String(d)
      })
      child.on('error', () => finish(-1, 'spawn failed'))
      child.on('exit', code => finish(code ?? -1, stderr))
    })
  },
}

export const nodeRuntimeIo: RuntimeIo = {
  async download(url, dest) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS)
    timer.unref?.()
    const tmp = `${dest}.part`
    try {
      const res = await fetch(url, { redirect: 'follow', signal: ac.signal })
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))
      renameSync(tmp, dest)
    } catch (err) {
      rmSync(tmp, { force: true })
      throw err
    } finally {
      clearTimeout(timer)
    }
  },
  async extractUv(archive, destDir) {
    // uv archives: <triple>/uv in a .tar.gz (unix) or uv.exe at the zip root (windows).
    // bsdtar (macOS, Windows 10+) and GNU tar both handle these with plain -x.
    const tmp = join(destDir, '.extract')
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    const isZip = archive.endsWith('.zip')
    const r = await nodeRuntimeExec.run(process.platform === 'win32' ? 'tar.exe' : 'tar', [isZip ? '-xf' : '-xzf', archive, '-C', tmp], {})
    if (r.code !== 0) throw new Error('uv extract failed')
    const name = isZip ? 'uv.exe' : 'uv'
    const found = [join(tmp, name), ...readdirSync(tmp).map(d => join(tmp, d, name))].find(p => existsSync(p))
    if (!found) throw new Error('uv binary not found in archive')
    renameSync(found, join(destDir, name))
    if (!isZip) chmodSync(join(destDir, name), 0o755)
    rmSync(tmp, { recursive: true, force: true })
  },
  sha256File(path) {
    return new Promise((resolve, reject) => {
      const h = createHash('sha256')
      createReadStream(path)
        .on('data', d => h.update(d))
        .on('error', reject)
        .on('end', () => resolve(h.digest('hex')))
    })
  },
}

/**
 * Shared Rox key: injected at build time (`--define:process.env.ROX_SHARED_API_KEY`
 * in scripts/electron-build-main.ts) with ROX_API_KEY as a dev fallback.
 * Never logged; only handed to the sidecar's environment.
 */
export async function resolveSharedRoxKey(): Promise<string | null> {
  const k = process.env.ROX_SHARED_API_KEY || process.env.ROX_API_KEY || ''
  return k.trim() ? k.trim() : null
}

export interface CogneeResolverOptions {
  sidecarSourceDir: string
  isEnabled: () => boolean
  resolveLlmKey?: () => Promise<string | null>
  logger?: { warn: (m: string, e?: unknown) => void }
}

/** Builds a `GraphMemoryProviderResolver` with one lazy provider per workspace. */
export function createCogneeProviderResolver(opts: CogneeResolverOptions) {
  let runtime: CogneeRuntimeManager | null = null
  const getRuntime = () =>
    (runtime ??= new CogneeRuntimeManager({
      sidecarSourceDir: opts.sidecarSourceDir,
      exec: nodeRuntimeExec,
      io: nodeRuntimeIo,
      ...(opts.logger ? { logger: opts.logger } : {}),
    }))
  const providers = new Map<string, CogneeGraphProvider>()
  const resolver = (ctx: { workspaceRoot: string; workspaceId?: string }): GraphMemoryProvider | null => {
    if (!opts.isEnabled()) return null
    const id = ctx.workspaceId || createHash('sha1').update(ctx.workspaceRoot).digest('hex').slice(0, 16)
    let p = providers.get(id)
    if (!p) {
      p = new CogneeGraphProvider({
        workspaceId: id,
        storageDir: cogneeWorkspaceDir(id),
        ensureRuntime: async () => {
          const s = await getRuntime().ensureInstalled()
          return s.state === 'installed' ? s.python : null
        },
        resolveLlmKey: opts.resolveLlmKey ?? resolveSharedRoxKey,
        isEnabled: opts.isEnabled,
        ...(opts.logger ? { logger: opts.logger } : {}),
      })
      providers.set(id, p)
    }
    return p
  }
  const shutdownAll = () => {
    for (const p of providers.values()) p.shutdown()
  }
  return { resolver, shutdownAll, runtime: getRuntime }
}

/** Remove runtime downloads (not user memory). */
export function removeCogneeRuntime(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
