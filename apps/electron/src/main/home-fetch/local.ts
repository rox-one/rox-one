/**
 * Local data for Home widgets: this machine's stats and a read-only docker
 * container list. Neither takes renderer input, so there is nothing to
 * validate beyond the sender check in ipc.ts.
 */
import { request } from 'node:http'
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import os from 'node:os'
import type { HomeDockerContainer, HomeDockerResult, HomeSystemStats } from '../../shared/home-fetch'

let lastCpu: { idle: number; total: number } | null = null

function cpuTimes(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

export async function readSystemStats(): Promise<HomeSystemStats> {
  const now = cpuTimes()
  const prev = lastCpu
  lastCpu = now
  const dt = prev ? now.total - prev.total : 0
  const cpu = prev && dt > 0 ? Math.min(1, Math.max(0, 1 - (now.idle - prev.idle) / dt)) : null
  let diskTotal: number | null = null
  let diskUsed: number | null = null
  try {
    const s = await statfs(process.platform === 'win32' ? homedir().slice(0, 3) : '/')
    diskTotal = s.blocks * s.bsize
    diskUsed = (s.blocks - s.bavail) * s.bsize
  } catch {
    // statfs unsupported: leave disk unknown
  }
  const [a, b, c] = os.loadavg()
  return {
    platform: process.platform,
    cpus: os.cpus().length,
    load: [a ?? 0, b ?? 0, c ?? 0],
    cpu,
    memTotal: os.totalmem(),
    memUsed: os.totalmem() - os.freemem(),
    diskTotal,
    diskUsed,
    uptimeSec: Math.round(os.uptime()),
  }
}

export function dockerSocketPath(platform = process.platform, home = homedir(), exists = existsSync): string | null {
  if (platform === 'win32') return '\\\\.\\pipe\\docker_engine'
  const candidates = ['/var/run/docker.sock', `${home}/.docker/run/docker.sock`, `${home}/.colima/default/docker.sock`, `${home}/.orbstack/run/docker.sock`]
  return candidates.find((p) => exists(p)) ?? null
}

/** Engine JSON → the minimal view; drops everything else (env, mounts, labels). */
export function mapContainers(raw: unknown): HomeDockerContainer[] | null {
  if (!Array.isArray(raw)) return null
  const out: HomeDockerContainer[] = []
  for (const c of raw.slice(0, 200)) {
    if (!c || typeof c !== 'object') continue
    const v = c as Record<string, unknown>
    const names = Array.isArray(v.Names) ? v.Names.filter((n): n is string => typeof n === 'string') : []
    const id = typeof v.Id === 'string' ? v.Id.slice(0, 12) : ''
    if (!id) continue
    out.push({
      id,
      name: (names[0] ?? id).replace(/^\//, '').slice(0, 120),
      image: typeof v.Image === 'string' ? v.Image.slice(0, 200) : '',
      state: typeof v.State === 'string' ? v.State.slice(0, 20) : '',
      status: typeof v.Status === 'string' ? v.Status.slice(0, 80) : '',
    })
  }
  return out
}

const MAX_BYTES = 2 * 1024 * 1024

export function listDockerContainers(socketPath = dockerSocketPath()): Promise<HomeDockerResult> {
  if (!socketPath) return Promise.resolve({ status: 'error', reason: 'unavailable' })
  return new Promise((resolve) => {
    const req = request({ socketPath, path: '/containers/json?all=1', method: 'GET', timeout: 3000, headers: { host: 'docker' } }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BYTES) { req.destroy(); resolve({ status: 'error', reason: 'invalid' }) } else chunks.push(chunk)
      })
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ status: 'error', reason: 'unavailable' })
        try {
          const containers = mapContainers(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          resolve(containers ? { status: 'ok', containers } : { status: 'error', reason: 'invalid' })
        } catch {
          resolve({ status: 'error', reason: 'invalid' })
        }
      })
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 'error', reason: 'timeout' }) })
    req.on('error', () => resolve({ status: 'error', reason: 'unavailable' }))
    req.end()
  })
}
