import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectDeviceDiagnostics,
  cpuUsagePercent,
  parseDarwinNetworkCounters,
  parseLaunchAgents,
  parseLinuxNetworkCounters,
  parseProcesses,
  readDiagnosticLog,
} from './device-diagnostics-collector'

describe('bounded host diagnostics', () => {
  it('computes CPU utilization from elapsed counters and rejects invalid samples', () => {
    expect(cpuUsagePercent({ idle: 100, total: 200 }, { idle: 160, total: 300 })).toBe(40)
    expect(cpuUsagePercent({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBeNull()
    expect(cpuUsagePercent({ idle: 100, total: 200 }, { idle: 90, total: 300 })).toBeNull()
  })

  it('parses process names containing spaces, sorts CPU usage, and bounds output', () => {
    const rows = parseProcesses('  120 0.5 1024 /Applications/Rox Helper\n  42 21.2 2048 /usr/bin/bun\n  bad row\n  99 NaN 12 bad')
    expect(rows).toEqual([
      { pid: 42, cpuPercent: 21.2, memoryBytes: 2097152, name: 'bun' },
      { pid: 120, cpuPercent: 0.5, memoryBytes: 1048576, name: 'Rox Helper' },
    ])
    expect(parseProcesses(Array.from({ length: 70 }, (_, i) => `${i + 1} 0.1 10 process`).join('\n'))).toHaveLength(40)
  })

  it('uses the macOS link row once instead of double-counting IPv4 and IPv6 totals', () => {
    const output = 'Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\n'
      + 'en0 1500 <Link#4> aa:bb:cc:dd:ee:ff 1 0 4096 2 0 8192 0\n'
      + 'en0 1500 192.168.1 192.168.1.4 1 - 4096 2 - 8192 -\n'
      + 'lo0 16384 <Link#1> 10 0 100 10 0 100 0\n'
    expect(parseDarwinNetworkCounters(output)).toEqual([
      { name: 'en0', receivedBytes: 4096, sentBytes: 8192 },
      { name: 'lo0', receivedBytes: 100, sentBytes: 100 },
    ])
  })

  it('reads Linux receive/transmit byte columns and skips malformed rows', () => {
    expect(parseLinuxNetworkCounters('Inter-| Receive | Transmit\n eth0: 1000 2 0 0 0 0 0 0 2000 3 0 0 0 0 0 0\n lo: nope')).toEqual([
      { name: 'eth0', receivedBytes: 1000, sentBytes: 2000 },
    ])
  })

  it('keeps launch-agent idle and exit codes distinct from running jobs', () => {
    expect(parseLaunchAgents('PID Status Label\n- 0 com.example.idle\n123 0 com.example.running\n- 78 com.example.failed\ninvalid')).toEqual([
      { label: 'com.example.failed', pid: null, lastExitStatus: 78 },
      { label: 'com.example.idle', pid: null, lastExitStatus: 0 },
      { label: 'com.example.running', pid: 123, lastExitStatus: 0 },
    ])
  })

  it('bounds log reads and removes secrets before returning text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rox-diagnostics-'))
    try {
      const path = join(directory, 'main.log')
      await writeFile(path, `${'old line\n'.repeat(9000)}{"message":"Request failed","token":"do-not-display-token"}\nAuthorization: Bearer abcdefghijklmnop\n`)
      const result = await readDiagnosticLog(path, new AbortController().signal)
      expect(result.status).toBe('available')
      if (result.status !== 'available') return
      expect(result.data.lines.length).toBeLessThanOrEqual(100)
      expect(result.data.truncated).toBe(true)
      expect(result.data.lines.join('\n')).toContain('Request failed')
      expect(result.data.lines.join('\n')).not.toContain('do-not-display-token')
      expect(result.data.lines.join('\n')).not.toContain('abcdefghijklmnop')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reports disabled logging and missing files truthfully', async () => {
    const signal = new AbortController().signal
    expect(await readDiagnosticLog(undefined, signal)).toEqual({ status: 'unavailable', reason: 'disabled' })
    expect(await readDiagnosticLog('/nonexistent/rox-diagnostic.log', signal)).toEqual({ status: 'unavailable', reason: 'no-data' })
  })

  it('returns real host memory and sampled CPU without a background monitor', async () => {
    const snapshot = await collectDeviceDiagnostics({ requestId: 'host-test', kind: 'overview' }, {
      signal: new AbortController().signal,
      logPaths: {},
    })
    expect(snapshot.kind).toBe('overview')
    expect(snapshot.result.status).toBe('available')
    if (snapshot.kind !== 'overview' || snapshot.result.status !== 'available') return
    expect(snapshot.result.data.memoryTotalBytes).toBeGreaterThan(0)
    expect(snapshot.result.data.memoryFreeBytes).toBeGreaterThanOrEqual(0)
    expect(snapshot.result.data.memoryFreeBytes).toBeLessThanOrEqual(snapshot.result.data.memoryTotalBytes)
    expect(snapshot.result.data.cpuCount).toBeGreaterThan(0)
    expect(snapshot.result.data.cpuPercent).not.toBeNull()
  })

  it('cancels the CPU sampling delay and never returns a fabricated sample', async () => {
    const controller = new AbortController()
    const pending = collectDeviceDiagnostics({ requestId: 'cancel-test', kind: 'overview' }, { signal: controller.signal, logPaths: {} })
    controller.abort()
    const snapshot = await pending
    expect(snapshot.result).toEqual({ status: 'unavailable', reason: 'cancelled' })
  })

  it('marks launch agents unsupported on Linux instead of inventing an empty success', async () => {
    const snapshot = await collectDeviceDiagnostics({ requestId: 'unsupported-test', kind: 'launchAgents' }, {
      signal: new AbortController().signal, logPaths: {}, platform: 'linux',
    })
    expect(snapshot.result).toEqual({ status: 'unavailable', reason: 'unsupported-platform' })
  })

  it.skipIf(process.platform !== 'linux')('collects real Linux counters and never fabricates success when a native command fails', async () => {
    const options = { signal: new AbortController().signal, logPaths: {} }
    const [processes, network] = await Promise.all([
      collectDeviceDiagnostics({ requestId: 'processes-test', kind: 'processes' }, options),
      collectDeviceDiagnostics({ requestId: 'network-test', kind: 'network' }, options),
    ])
    expect(network.result.status).toBe('available')
    if (processes.kind === 'processes' && processes.result.status === 'available') {
      expect(processes.result.data.processes.length).toBeGreaterThan(0)
      expect(processes.result.data.processes.length).toBeLessThanOrEqual(40)
    } else {
      // Some restricted Linux runners expose /proc differently to spawned ps.
      // That environment is an explicit unavailable result, never an empty
      // or synthesized process table. Native process evidence needs Electron.
      expect(processes.result).toEqual({ status: 'unavailable', reason: 'failed' })
    }
    if (network.kind === 'network' && network.result.status === 'available') {
      expect(network.result.data.interfaces.some(row => row.receivedBytes !== null && row.sentBytes !== null)).toBe(true)
    }
  })
})
