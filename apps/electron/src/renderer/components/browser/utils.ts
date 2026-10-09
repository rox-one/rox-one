/**
 * Shared browser component utilities
 */

export function getHostname(url: string): string {
  try {
    if (url === 'about:blank' || !url) return 'New Tab'
    const parsed = new URL(url)

    if (parsed.protocol === 'file:') {
      const decodedPath = decodeURIComponent(parsed.pathname || '')
      if (!decodedPath || decodedPath === '/' || decodedPath.endsWith('/')) return 'Local File'

      const normalizedPath = decodedPath.replace(/\/+$/, '')
      const fileName = normalizedPath.split('/').filter(Boolean).at(-1)
      return fileName || 'Local File'
    }

    const hostname = parsed.hostname.replace(/^www\./, '')
    if (hostname) return hostname

    return parsed.protocol.replace(/:$/, '') || url
  } catch {
    return url
  }
}


