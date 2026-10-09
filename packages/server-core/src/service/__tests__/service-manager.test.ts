import { describe, expect, it } from 'bun:test'
import { LaunchdRuntime, type LaunchctlRunner } from '../launchd-runtime.ts'
import { buildLaunchAgentFiles } from '../launchd-plist.ts'
import type { ServiceFilesystem } from '../launchd-install.ts'
import { createServiceManager, guardServiceInstall, LaunchdService, UnsupportedService } from '../service-manager.ts'
import { AppManagedService, type ManagedServiceProcess } from '../app-managed.ts'

function createFakeFs() {
  const files = new Map<string, { content: string; mode: number }>()
  const fs: ServiceFilesystem = {
    readFile: async path => files.get(path)?.content ?? null,
    statMode: async path => files.get(path)?.mode ?? null,
    writeFile: async (path, content, mode) => { files.set(path, { content, mode }) },
    mkdir: async () => {},
    unlink: async path => { files.delete(path) },
  }
  return { fs, files }
}

function createRunner(codes: Partial<Record<'bootstrap' | 'bootout' | 'kickstart' | 'print', number>> = {}) {
  const calls: string[][] = []
  const runner: LaunchctlRunner = {
    run: async args => {
      calls.push([...args])
      const verb = args[0] as 'bootstrap' | 'bootout' | 'kickstart' | 'print'
      // A job that was never bootstrapped is "not loaded": default `print` to a
      // non-zero exit so tests exercise the real bootstrap path.
      return { code: codes[verb] ?? (verb === 'print' ? 1 : 0), stdout: '', stderr: '' }
    },
  }
  return { calls, runner }
}

const files = buildLaunchAgentFiles({
  label: 'com.rox.service',
  executable: '/Applications/Rox.app/Contents/MacOS/Rox',
  args: ['--service'],
  environment: { ROX_SERVICE_MANAGED: '1' },
  serviceDirectory: '/Users/x/rox/service',
  launchAgentsDirectory: '/Users/x/Library/LaunchAgents',
  workingDirectory: '/Users/x/rox',
  logDirectory: '/Users/x/rox/logs',
})

describe('launchd runtime control', () => {
  it('drives the per-user gui/<uid> domain with fixed launchctl argv', async () => {
    const { calls, runner } = createRunner()
    const runtime = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner })
    expect(runtime.domain).toBe('gui/501')
    expect(runtime.serviceTarget).toBe('gui/501/com.rox.service')

    await runtime.bootstrap('/Users/x/Library/LaunchAgents/com.rox.service.plist')
    await runtime.kickstart()
    await runtime.bootout()
    expect(calls).toEqual([
      ['bootstrap', 'gui/501', '/Users/x/Library/LaunchAgents/com.rox.service.plist'],
      ['kickstart', '-k', 'gui/501/com.rox.service'],
      ['bootout', 'gui/501/com.rox.service'],
    ])
  })

  it('refuses to mutate launchd from inside the managed service', async () => {
    const { calls, runner } = createRunner()
    const runtime = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner, isInsideService: () => true })
    await expect(runtime.bootstrap('/plist')).rejects.toMatchObject({ code: 'MUTATION_REFUSED' })
    await expect(runtime.bootout()).rejects.toMatchObject({ code: 'MUTATION_REFUSED' })
    await expect(runtime.kickstart()).rejects.toMatchObject({ code: 'MUTATION_REFUSED' })
    expect(calls).toHaveLength(0)
  })

  it('treats an already-unloaded job as success and surfaces other failures', async () => {
    const already = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner: createRunner({ bootout: 3 }).runner })
    await expect(already.bootout()).resolves.toBeUndefined()

    const failing = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner: createRunner({ bootout: 1 }).runner })
    await expect(failing.bootout()).rejects.toMatchObject({ code: 'STOP_FAILED' })

    const { calls, runner } = createRunner({ print: 1 })
    expect(await new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner }).isLoaded()).toBe(false)
    expect(calls).toEqual([['print', 'gui/501/com.rox.service']])
  })
})

describe('launchd service backend', () => {
  function service(codes?: Partial<Record<'print', number>>) {
    const { fs, files: written } = createFakeFs()
    const { calls, runner } = createRunner(codes)
    const runtime = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner })
    return {
      backend: new LaunchdService({
        files, fs, runtime,
        serviceDirectory: files.serviceDirectory,
        launchAgentsDirectory: files.plistPath.replace(`/${files.label}.plist`, ''),
        now: () => 123,
      }),
      written,
      calls,
      fs,
    }
  }

  it('installs, starts, stops, restarts and uninstalls against launchd', async () => {
    const { backend, written, calls } = service()
    expect(await backend.getStatus()).toMatchObject({ state: 'not-installed', autostart: false })

    const installed = await backend.install()
    expect(installed.ok).toBe(true)
    expect(written.has(files.plistPath)).toBe(true)
    expect(written.get(files.envFile.path)?.mode).toBe(0o600)
    expect(written.get(files.wrapper.path)?.mode).toBe(0o700)
    expect(await backend.getStatus()).toMatchObject({ state: 'installed', autostart: true })

    expect((await backend.start()).status.state).toBe('running')
    expect(calls.at(-1)).toEqual(['bootstrap', 'gui/501', files.plistPath])

    expect((await backend.stop()).status.state).toBe('stopped')
    expect((await backend.restart()).status.state).toBe('running')
    expect(calls.at(-1)).toEqual(['bootstrap', 'gui/501', files.plistPath])

    expect((await backend.uninstall()).status.state).toBe('not-installed')
    expect(written.size).toBe(0)
  })

  it('refuses to clobber a system LaunchDaemon path', async () => {
    const { backend } = service()
    const rogue = new LaunchdService({
      files: { ...files, plistPath: '/Library/LaunchDaemons/com.rox.service.plist' },
      fs: createFakeFs().fs,
      runtime: new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner: createRunner().runner }),
      serviceDirectory: files.serviceDirectory,
      launchAgentsDirectory: '/Users/x/Library/LaunchAgents',
    })
    expect((await rogue.install()).status).toMatchObject({ state: 'failed', safeError: 'SYSTEM_DAEMON_CONFLICT' })
    expect((await backend.getStatus()).state).toBe('not-installed')
  })

  it('reports a failed state when the launchctl bootstrap fails', async () => {
    const { fs } = createFakeFs()
    const { runner } = createRunner({ bootstrap: 1 })
    const backend = new LaunchdService({
      files, fs,
      runtime: new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner }),
      serviceDirectory: files.serviceDirectory,
      launchAgentsDirectory: '/Users/x/Library/LaunchAgents',
    })
    await backend.install()
    expect((await backend.start()).status).toMatchObject({ state: 'failed', safeError: 'START_FAILED' })
  })
})

describe('service platform dispatch', () => {
  it('selects launchd on darwin, app-managed when requested, and unsupported elsewhere', async () => {
    const launchd = createServiceManager({
      platform: 'darwin',
      launchd: {
        files, fs: createFakeFs().fs,
        runtime: new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner: createRunner().runner }),
        serviceDirectory: files.serviceDirectory,
        launchAgentsDirectory: '/Users/x/Library/LaunchAgents',
      },
    })
    expect(launchd).toBeInstanceOf(LaunchdService)

    const linux = createServiceManager({ platform: 'linux' })
    expect(linux).toBeInstanceOf(UnsupportedService)
    expect((await linux.getStatus())).toMatchObject({ state: 'unsupported', platform: 'linux', safeError: 'UNSUPPORTED_PLATFORM' })
    expect((await linux.install()).ok).toBe(false)

    const appManaged = createServiceManager({
      platform: 'linux',
      appManaged: { spawn: () => { throw new Error('unused') } },
    })
    expect(appManaged).toBeInstanceOf(AppManagedService)
  })
})

describe('unsupported-platform guard', () => {
  it('refuses install from an untrusted (ad-hoc/unsigned) build but passes everything else through', async () => {
    const unsupported = new UnsupportedService('linux')
    const blocked = guardServiceInstall(unsupported, () => false)
    const blockedInstall = await blocked.install()
    expect(blockedInstall).toMatchObject({ ok: false, status: { state: 'failed', safeError: 'UNSIGNED_BUILD' } })
    expect((await blocked.getStatus()).safeError).toBe('UNSUPPORTED_PLATFORM')

    const trusted = guardServiceInstall(unsupported, () => true)
    expect((await trusted.install()).status.safeError).toBe('UNSUPPORTED_PLATFORM')
  })
})

describe('app-managed backend', () => {
  class FakeChild {
    readonly pid = 4321
    private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null
    kill(signal?: NodeJS.Signals | number): boolean {
      this.exitListener?.(0, (signal as NodeJS.Signals) ?? null)
      return true
    }
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
    once(event: 'error', listener: () => void): this
    once(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | (() => void)): this {
      if (event === 'exit') this.exitListener = listener as (code: number | null, signal: NodeJS.Signals | null) => void
      return this
    }
  }

  it('installs/starts/stops/uninstalls and refuses start before install', async () => {
    const children: FakeChild[] = []
    const backend = new AppManagedService({ spawn: () => { const child = new FakeChild(); children.push(child); return child as ManagedServiceProcess } })
    expect((await backend.start()).status.state).toBe('not-installed')
    await backend.install()
    const running = await backend.start()
    expect(running).toMatchObject({ ok: true, status: { state: 'running', platform: 'app-managed' } })
    expect(children).toHaveLength(1)
    // Idempotent: a second start does not spawn another child.
    await backend.start()
    expect(children).toHaveLength(1)

    expect((await backend.stop()).status.state).toBe('stopped')
    await backend.shutdown()
    expect((await backend.uninstall()).status.state).toBe('not-installed')
  })
})