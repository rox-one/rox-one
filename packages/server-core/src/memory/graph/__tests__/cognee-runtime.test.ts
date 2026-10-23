import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CogneeRuntimeManager, UV_SHA256, cogneeWorkspaceDir, type RuntimeExec, type RuntimeIo } from '../cognee-runtime'

const roots: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'rox-rt-'))
  roots.push(d)
  return d
}
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(opts: { badSha?: boolean; failArg?: string } = {}) {
  const root = tmp()
  const sidecar = join(root, 'sidecar')
  mkdirSync(sidecar)
  writeFileSync(join(sidecar, 'requirements.lock'), 'cognee==1.6.4 --hash=sha256:abc\n')
  const calls: string[][] = []
  const exec: RuntimeExec = {
    async run(_cmd, args) {
      calls.push(args)
      if (opts.failArg && args.includes(opts.failArg)) return { code: 1, stderr: 'boom' }
      if (args[0] === 'venv') {
        mkdirSync(join(args[args.length - 1]!, 'bin'), { recursive: true })
        writeFileSync(join(args[args.length - 1]!, 'bin', 'python'), '')
      }
      return { code: 0, stderr: '' }
    },
  }
  const downloads: string[] = []
  const io: RuntimeIo = {
    async download(url, dest) { downloads.push(url); writeFileSync(dest, 'x') },
    async extractUv(_a, destDir) { writeFileSync(join(destDir, 'uv'), '') },
    async sha256File() { return opts.badSha ? 'nope' : UV_SHA256['darwin-arm64']!.sha256 },
  }
  const mgr = new CogneeRuntimeManager({ runtimeDir: join(root, 'rt'), sidecarSourceDir: sidecar, platform: 'darwin', arch: 'arm64', exec, io })
  return { mgr, calls, downloads, root, sidecar }
}

describe('CogneeRuntimeManager', () => {
  test('constructing never installs (lazy)', () => {
    const { mgr, calls, downloads } = setup()
    expect(mgr.status().state).toBe('not_installed')
    expect(calls).toEqual([])
    expect(downloads).toEqual([])
  })
  test('full install runs uv/python/venv/sync/sidecar with hash-locked sync', async () => {
    const { mgr, calls, downloads } = setup()
    const s = await mgr.ensureInstalled()
    expect(s.state).toBe('installed')
    expect(downloads[0]).toContain('/0.12.17/uv-aarch64-apple-darwin.tar.gz')
    expect(calls.map(c => c[0])).toEqual(['python', 'venv', 'pip', 'pip'])
    expect(calls[2]).toContain('--require-hashes')
    expect(mgr.isInstalled()).toBe(true)
  })
  test('checksum mismatch fails at uv step without running anything', async () => {
    const { mgr, calls } = setup({ badSha: true })
    const s = await mgr.ensureInstalled()
    expect(s).toMatchObject({ state: 'failed', step: 'uv' })
    expect(calls).toEqual([])
  })
  test('resumable: failed step is retried, done steps are skipped', async () => {
    const a = setup({ failArg: '--no-deps' })
    expect((await a.mgr.ensureInstalled()).state).toBe('failed')
    const retried: string[][] = []
    const again = new CogneeRuntimeManager({
      runtimeDir: a.mgr.runtimeDir, sidecarSourceDir: a.sidecar, platform: 'darwin', arch: 'arm64',
      exec: { run: async (_c, args) => { retried.push(args); return { code: 0, stderr: '' } } },
      io: { download: async () => { throw new Error('should not download') }, extractUv: async () => {}, sha256File: async () => '' },
    })
    expect((await again.ensureInstalled()).state).toBe('installed')
    expect(retried.map(c => c[0])).toEqual(['pip'])
  })
  test('single-flight', async () => {
    const { mgr, downloads } = setup()
    await Promise.all([mgr.ensureInstalled(), mgr.ensureInstalled()])
    expect(downloads.length).toBe(1)
  })
  test('unsupported platform', async () => {
    const r = tmp()
    const mgr = new CogneeRuntimeManager({ runtimeDir: r, sidecarSourceDir: r, platform: 'freebsd', arch: 'x64', exec: { run: async () => ({ code: 0, stderr: '' }) }, io: {} as RuntimeIo })
    expect((await mgr.ensureInstalled()).state).toBe('unsupported')
  })
  test('workspace dir is hash-keyed and collision-free', () => {
    const a = cogneeWorkspaceDir('/w/foo-bar', '/h')
    const b = cogneeWorkspaceDir('/w/foo_bar', '/h')
    expect(a).toBe('/h/memory/cognee/5d2ba45c92364537')
    expect(b).toBe('/h/memory/cognee/fd7bcfb1da8cfb71')
    expect(a).not.toBe(b)
    expect(cogneeWorkspaceDir('ws-1', '/h')).toBe('/h/memory/cognee/7cb11a0b15a50508')
    expect(existsSync('/h/memory')).toBe(false)
  })
})
