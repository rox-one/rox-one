/**
 * SSRF guard for Home fetches. Every hop (the first request and each redirect)
 * must pass: https only, default port (443; 80 only if http is explicitly
 * allowed), no credentials, a hostname that is not an internal name, and DNS
 * answers that are all public unicast addresses.
 */
import { isIP } from 'node:net'

export type UrlGuardVerdict = { ok: true; url: URL } | { ok: false; why: string }
export type ResolveHost = (hostname: string) => Promise<string[]>

const BLOCKED_NAMES = /^(localhost|metadata|metadata\.google\.internal|instance-data)$|\.(localhost|local|internal|intranet|lan|home\.arpa)$/i

/** CIDR table for IPv4: [network, prefix]. */
const V4_BLOCKED: Array<[number, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([ip, p]) => [v4ToInt(ip as string)!, p as number])

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null
    n = n * 256 + Number(p)
  }
  return n
}

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip)
  if (n === null) return true
  return V4_BLOCKED.some(([net, p]) => Math.floor(n / 2 ** (32 - p)) === Math.floor(net / 2 ** (32 - p)))
}

/** Expand an IPv6 literal into 8 16-bit groups (handles :: and a dotted tail). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const n = v4ToInt(dotted[1]!)
    if (n === null) return null
    s = s.slice(0, -dotted[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0) return null
  const all = [...head, ...Array(fill).fill('0'), ...tail]
  if (all.length !== 8) return null
  const out = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return out.some(Number.isNaN) ? null : out
}

function v6Blocked(ip: string): boolean {
  const g = v6Groups(ip)
  if (!g) return true
  const embeddedV4 = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`
  if (g.slice(0, 7).every((x) => x === 0)) return true // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Blocked(embeddedV4()) // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return v4Blocked(embeddedV4()) // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Blocked(embeddedV4()) // NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return true // fc00::/7 unique local (incl. fd00:ec2::254)
  if ((g[0]! & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true // fec0::/10 site-local
  if ((g[0]! & 0xff00) === 0xff00) return true // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // discard
  if (g[0] === 0x2002) return v4Blocked(`${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`) // 6to4
  return false
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, '').split('%')[0]!)
  if (kind === 4) return v4Blocked(ip)
  if (kind === 6) return v6Blocked(ip)
  return true
}

export async function checkUrl(raw: string, resolve: ResolveHost, opts: { allowHttp?: boolean } = {}): Promise<UrlGuardVerdict> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, why: 'unparseable' }
  }
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) return { ok: false, why: 'scheme' }
  if (url.username || url.password) return { ok: false, why: 'credentials' }
  if (url.port !== '' && url.port !== '443' && url.port !== '80') return { ok: false, why: 'port' }
  if (url.port === '80' && url.protocol === 'https:') return { ok: false, why: 'port' }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return { ok: false, why: 'host' }
  if (isIP(host)) return isBlockedAddress(host) ? { ok: false, why: 'address' } : { ok: true, url }
  if (BLOCKED_NAMES.test(host) || !host.includes('.')) return { ok: false, why: 'host' }
  let addrs: string[]
  try {
    addrs = await resolve(host)
  } catch {
    return { ok: false, why: 'dns' }
  }
  if (addrs.length === 0 || addrs.some(isBlockedAddress)) return { ok: false, why: 'address' }
  return { ok: true, url }
}
