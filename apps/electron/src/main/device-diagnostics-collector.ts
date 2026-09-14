import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { cpus, freemem, networkInterfaces, totalmem } from 'node:os'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { sanitizeSecurityText } from '@craft-agent/shared/openclaw/audit'
import { redactRegisteredSecrets } from '@craft-agent/shared/secrets/redact'
import { redactSensitiveValues } from '@craft-agent/shared/utils/redaction'
import type {
  DeviceDiagnosticLogSource,
  DeviceDiagnosticRequest,
  DeviceDiagnosticSnapshot,
  DeviceLaunchAgent,
  DeviceLogTail,
  DeviceProcess,
  DiagnosticResult,
} from '../shared/device-diagnostics'

const MAX_LOG_BYTES = 32 * 1024
const MAX_LOG_LINES = 100

type CpuCounters = { idle: number; total: number }
type NetworkCounters = { name: string; receivedBytes: number; sentBytes: number }

export interface DeviceDiagnosticCollectorOptions {
  signal: AbortSignal
  logPaths: Partial<Record<DeviceDiagnosticLogSource, string | undefined>>
  platform?: NodeJS.Platform
}

export function cpuUsagePercent(before: CpuCounters, after: CpuCounters): number | null {
  const elapsed = after.total - before.total
  const idle = after.idle - before.idle
  if (elapsed <= 0 || idle < 0 || idle > elapsed) return null
  return Math.round((1 - idle / elapsed) * 1000) / 10
}

function readCpuCounters(): CpuCounters {
  return cpus().reduce((sum, cpu) => ({
    idle: sum.idle + cpu.times.idle,
    total: sum.total + Object.values(cpu.times).reduce((total, value) => total + value, 0),
  }), { idle: 0, total: 0 })
}

export function parseProcesses(output: string): DeviceProcess[] {
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(.+)$/)
    if (!match) return []
    const pid = Number(match[1])
    const cpuPercent = Number(match[2])
    const memoryBytes = Number(match[3]) * 1024
    if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isFinite(cpuPercent) || !Number.isSafeInteger(memoryBytes)) return []
    return [{ pid, cpuPercent, memoryBytes, name: basename(match[4]!).slice(0, 160) }]
  }).sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes || a.pid - b.pid).slice(0, 40)
}

export function parseLinuxNetworkCounters(output: string): NetworkCounters[] {
  return output.split('\n').flatMap(line => {
    const separator = line.indexOf(':')
    if (separator < 0) return []
    const name = line.slice(0, separator).trim()
    const fields = line.slice(separator + 1).trim().split(/\s+/)
    const receivedBytes = Number(fields[0])
    const sentBytes = Number(fields[8])
    if (!name || fields.length < 16 || !Number.isSafeInteger(receivedBytes) || !Number.isSafeInteger(sentBytes) || receivedBytes < 0 || sentBytes < 0) return []
    return [{ name, receivedBytes, sentBytes }]
  }).slice(0, 80)
}

export function parseDarwinNetworkCounters(output: string): NetworkCounters[] {
  const lines = output.trim().split('\n')
  const header = lines.shift()?.trim().split(/\s+/) ?? []
  const receivedColumn = header.indexOf('Ibytes')
  const sentColumn = header.indexOf('Obytes')
  if (receivedColumn < 0 || sentColumn < 0) return []
  const interfaces = new Map<string, NetworkCounters>()
  for (const line of lines) {
    const fields = line.trim().split(/\s+/)
    // Link counters cover the complete interface. Address rows repeat totals.
    if (!fields[2]?.startsWith('<Link#')) continue
    const missingAddress = header.length - fields.length
    if (missingAddress < 0 || missingAddress > 1) continue
    const name = fields[0]?.replace(/\*$/, '')
    const receivedBytes = Number(fields[receivedColumn - missingAddress])
    const sentBytes = Number(fields[sentColumn - missingAddress])
    if (!name || !Number.isSafeInteger(receivedBytes) || !Number.isSafeInteger(sentBytes) || receivedBytes < 0 || sentBytes < 0) continue
    interfaces.set(name, { name, receivedBytes, sentBytes })
  }
  return [...interfaces.values()].slice(0, 80)
}

export function parseLaunchAgents(output: string): DeviceLaunchAgent[] {
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+|-)\s+(-?\d+)\s+([^\s]+)$/)
    if (!match) return []
    const pid = match[1] === '-' ? null : Number(match[1])
    const lastExitStatus = Number(match[2])
    if ((pid !== null && (!Number.isSafeInteger(pid) || pid < 1)) || !Number.isSafeInteger(lastExitStatus)) return []
    return [{ pid, lastExitStatus, label: match[3]!.slice(0, 180) }]
  }).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 250)
}

function safeLogLine(line: string): string {
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return sanitizeSecurityText(redactRegisteredSecrets(value))
    if (Array.isArray(value)) return value.map(scrub)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, scrub(nested)]))
    return value
  }
  try {
    // Scrub structured values before serializing so benign quoted messages
    // survive the stricter sanitizer used for unstructured text.
    return redactRegisteredSecrets(JSON.stringify(scrub(redactSensitiveValues(JSON.parse(line))))).slice(0, 2000)
  } catch {
    return sanitizeSecurityText(redactRegisteredSecrets(line)).slice(0, 2000)
  }
}

function unavailable(error: unknown): { status: 'unavailable'; reason: 'permission-denied' | 'command-unavailable' | 'no-data' | 'failed' | 'cancelled' } {
  const details = error as { name?: string; code?: string }
  const reason = details.name === 'AbortError' ? 'cancelled'
    : details.code === 'EACCES' || details.code === 'EPERM' || details.code === 'ELOOP' ? 'permission-denied'
      : details.code === 'ENOENT' ? 'command-unavailable'
        : 'failed'
  return { status: 'unavailable', reason }
}

export async function readDiagnosticLog(path: string | undefined, signal: AbortSignal): Promise<DiagnosticResult<DeviceLogTail>> {
  if (!path) return { status: 'unavailable', reason: 'disabled' }
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    signal.throwIfAborted()
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = await file.stat()
    if (!stat.isFile()) return { status: 'unavailable', reason: 'no-data' }
    const start = Math.max(0, stat.size - MAX_LOG_BYTES)
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_LOG_BYTES))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    signal.throwIfAborted()
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/)
    if (start > 0) lines.shift() // Never expose a partial record with a cut-off credential key.
    if (lines.at(-1) === '') lines.pop()
    return { status: 'available', data: { lines: lines.slice(-MAX_LOG_LINES).map(safeLogLine), truncated: start > 0 || lines.length > MAX_LOG_LINES } }
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { status: 'unavailable', reason: 'no-data' }
    return unavailable(error)
  } finally {
    await file?.close()
  }
}

function runFixedCommand(command: '/bin/ps' | '/bin/launchctl' | '/usr/sbin/netstat', args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      signal, timeout: 3000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' },
    }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
}

/** One bounded snapshot per call. This module owns no timers or background monitor. */
export async function collectDeviceDiagnostics(request: DeviceDiagnosticRequest, options: DeviceDiagnosticCollectorOptions): Promise<DeviceDiagnosticSnapshot> {
  const { signal } = options
  const platform = options.platform ?? process.platform
  const base = { sampledAt: Date.now(), platform }
  try {
    signal.throwIfAborted()
    switch (request.kind) {
      case 'overview': {
        const before = readCpuCounters()
        await delay(180, undefined, { signal })
        const cpuPercent = cpuUsagePercent(before, readCpuCounters())
        const memoryTotalBytes = totalmem()
        return {
          ...base, sampledAt: Date.now(), kind: 'overview', result: { status: 'available', data: {
            cpuPercent, cpuCount: cpus().length, memoryTotalBytes,
            memoryFreeBytes: Math.min(memoryTotalBytes, freemem()),
            appMemoryBytes: process.memoryUsage().rss,
            appUptimeSeconds: process.uptime(),
          } },
        }
      }
      case 'processes': {
        if (platform !== 'darwin' && platform !== 'linux') return { ...base, kind: 'processes', result: { status: 'unavailable', reason: 'unsupported-platform' } }
        const output = await runFixedCommand('/bin/ps', ['-axo', 'pid=,pcpu=,rss=,comm='], signal)
        return { ...base, kind: 'processes', result: { status: 'available', data: { processes: parseProcesses(output) } } }
      }
      case 'network': {
        const counters = platform === 'linux'
          ? parseLinuxNetworkCounters(await readFile('/proc/net/dev', { encoding: 'utf8', signal }))
          : platform === 'darwin'
            ? parseDarwinNetworkCounters(await runFixedCommand('/usr/sbin/netstat', ['-ibn'], signal))
            : []
        // Some restricted hosts permit kernel byte counters but deny libuv's
        // address enumeration. Counters remain useful without IP addresses.
        let network: ReturnType<typeof networkInterfaces> = {}
        try { network = networkInterfaces() } catch (error) {
          if (!counters.length) throw error
        }
        const names = [...new Set([...Object.keys(network), ...counters.map(row => row.name)])].slice(0, 80)
        return { ...base, sampledAt: Date.now(), kind: 'network', result: { status: 'available', data: {
          interfaces: names.map(name => {
            const bytes = counters.find(row => row.name === name)
            return { name, receivedBytes: bytes?.receivedBytes ?? null, sentBytes: bytes?.sentBytes ?? null, internal: network[name]?.every(address => address.internal) ?? (name === 'lo' || name === 'lo0') }
          }),
        } } }
      }
      case 'launchAgents': {
        if (platform !== 'darwin') return { ...base, kind: 'launchAgents', result: { status: 'unavailable', reason: 'unsupported-platform' } }
        const output = await runFixedCommand('/bin/launchctl', ['list'], signal)
        return { ...base, kind: 'launchAgents', result: { status: 'available', data: { agents: parseLaunchAgents(output) } } }
      }
      case 'logs':
        return { ...base, kind: 'logs', result: await readDiagnosticLog(options.logPaths[request.source ?? 'main'], signal) }
    }
  } catch (error) {
    return { ...base, kind: request.kind, result: unavailable(error) }
  }
}
