const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
    if (parsed.username || parsed.password) return true
    const host = parsed.hostname.toLowerCase()
    if (PRIVATE_HOSTS.has(host)) return true
    if (host.endsWith('.local')) return true
    if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
    return false
  } catch { return true }
}
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1)
    return parsed.toString()
  } catch { return url }
}
export function dedupeSources<T extends { url: string }>(sources: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const source of sources) {
    if (isBlockedUrl(source.url)) continue
    const key = canonicalUrl(source.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(source)
  }
  return out
}
