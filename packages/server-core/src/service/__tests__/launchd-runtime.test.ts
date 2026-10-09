import { describe, expect, it } from 'bun:test'
import { LaunchdRuntime, type LaunchctlRunner } from '../launchd-runtime.ts'
import { buildLaunchAgentFiles } from '../launchd-plist.ts'
import type { ServiceFilesystem } from '../launchd-install.ts'
import { LaunchdService } from '../service-manager.ts'

/** Deterministic clock: `sleep` advances virtual time and records each wait. */
function createClock() {
  let time = 0
  const waits: number[] = []
  return {
    now: () => time,
    sleep: async (ms: number) => { waits.push(ms); time += ms },
    totalSlept: () => waits.reduce((sum, ms) => sum + ms, 0),
    waits,
  }
}

/**
 * A launchctl runner whose `print` replies follow a scripted sequence (the last
 * entry repeats); mutating verbs succeed. Models launchd's post-bootout settle
 * window where the first prints still report the job as loaded.
 */
function createScriptedRunner(prints: readonly number[]) {
  const calls: string[][] = []
  let reads = 0
  const runner: LaunchctlRunner = {
    run: async args => {
      calls.push([...args])
      if (args[0] !== 'print') return { code: 0, stdout: '', stderr: '' }
      const code = prints[Math.min(reads, prints.length - 1)] ?? 0
      reads += 1
      return { code, stdout: '', stderr: '' }
    },
  }
  return { calls, runner, printCount: () => reads }
}

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

describe('launchd runtime settle-aware status', () => {
  it('settles a stale-loaded launchctl print after a successful bootout', async () => {
    const clock = createClock()
    // Three stale "loaded" prints, then launchd settles to "not loaded".
    const { runner, printCount } = createScriptedRunner([0, 0, 0, 1])
    const runtime = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner, now: clock.now, sleep: clock.sleep })

    await runtime.bootout()

    expect(await runtime.isLoaded()).toBe(false)
    expect(printCount()).toBe(4)
    expect(clock.totalSlept()).toBeLessThanOrEqual(1000)
  })

  it('does not re-poll when no mutation is pending', async () => {
    const clock = createClock()
    const { runner, printCount } = createScriptedRunner([0])
    const runtime = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner, now: clock.now, sleep: clock.sleep })

    expect(await runtime.isLoaded()).toBe(true)
    expect(printCount()).toBe(1)
    expect(clock.waits).toHaveLength(0)
  })

  it('keeps reporting loaded when stable prints confirm the job is loaded', async () => {
    const clock = createClock()
    const { runner, printCount } = createScriptedRunner([0])
    const runtime = new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner, now: clock.now, sleep: clock.sleep })

    await runtime.bootout()

    // Every post-bootout print still says loaded: the retry budget is consumed,
    // then the last real print is trusted as the settled (loaded) state.
    expect(await runtime.isLoaded()).toBe(true)
    expect(clock.totalSlept()).toBeLessThanOrEqual(1000)
    expect(printCount()).toBeLessThanOrEqual(41)
  })

  it('surfaces the settled not-loaded state through getStatus right after stop', async () => {
    const clock = createClock()
    const { runner } = createScriptedRunner([0, 0, 1])
    const { fs } = createFakeFs()
    const backend = new LaunchdService({
      files,
      fs,
      runtime: new LaunchdRuntime({ label: 'com.rox.service', uid: 501, runner, now: clock.now, sleep: clock.sleep }),
      serviceDirectory: files.serviceDirectory,
      launchAgentsDirectory: '/Users/x/Library/LaunchAgents',
      now: () => 123,
    })

    await backend.install()
    expect((await backend.stop()).status.state).toBe('stopped')
    // The transiently-loaded print must not leak out as `running`.
    expect((await backend.getStatus()).state).toBe('installed')
  })
})