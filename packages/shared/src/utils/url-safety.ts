/**
 * Classification of external URLs for `shell.openExternal`-style handlers.
 *
 * We use a blocklist instead of an allowlist: the OS only dispatches URL
 * schemes that have a registered handler, so passing through
 * `obsidian://`, `vscode://`, etc. is safe in practice. Known-dangerous
 * schemes (XSS primitives and `file:` as an RCE vector on Windows) stay
 * explicitly blocked, with a per-scheme reason so blocked attempts produce a
 * useful error message instead of a generic "Invalid URL".
 */

export type UrlClassification =
  | { kind: 'dangerous'; scheme?: string; reason: string }
  | { kind: 'internal-deeplink' }
  | { kind: 'safe-external' }

/**
 * Blocked URL schemes (including trailing `:`) mapped to a human-readable
 * reason. The reason flows through to the toast users see when a blocked
 * URL gets clicked, so it should explain *why* not just *what*.
 */
const DANGEROUS_SCHEMES: ReadonlyMap<string, string> = new Map([
  ['javascript:', 'JavaScript URLs can execute arbitrary code in the renderer (XSS vector).'],
  ['data:', 'data: URLs can embed executable content and bypass scheme restrictions.'],
  ['vbscript:', 'VBScript URLs are a legacy script-execution vector.'],
  ['blob:', 'blob: URLs are renderer-scoped and do not resolve outside this window.'],
  [
    'file:',
    'file: URLs are blocked because shell.openExternal can launch local executables on Windows (Electron RCE class). Use an in-app preview block (html-preview, pdf-preview, image-preview, markdown-preview) or open the file from your OS file manager.',
  ],
])

const INTERNAL_DEEPLINK_SCHEMES = new Set(['rox:', 'craftagents:'])

export function classifyExternalUrl(rawUrl: string): UrlClassification {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { kind: 'dangerous', reason: 'URL is empty or whitespace-only.' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { kind: 'dangerous', reason: 'URL is malformed and cannot be parsed.' }
  }

  const protocol = parsed.protocol.toLowerCase()

  const blockedReason = DANGEROUS_SCHEMES.get(protocol)
  if (blockedReason) {
    return { kind: 'dangerous', scheme: protocol, reason: blockedReason }
  }

  if (INTERNAL_DEEPLINK_SCHEMES.has(protocol)) {
    return { kind: 'internal-deeplink' }
  }

  return { kind: 'safe-external' }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  return classifyExternalUrl(rawUrl).kind === 'safe-external'
}

/**
 * Product link policy (Issue 14): where a user-clicked URL should open.
 * `classifyExternalUrl` stays the OS-open blocklist; this table decides
 * internal browser vs OS handler vs blocked.
 */
export type LinkPolicyKind = 'internal-browser' | 'external' | 'deeplink' | 'blocked'

export type LinkPolicy = {
  kind: LinkPolicyKind
  reason: string
}

const AUTH_HOST_MARKERS = [
  'accounts.google.',
  'login.microsoftonline.',
  'login.live.',
  'login.yahoo.',
  'appleid.apple.com',
]

function hostLooksLikeAuth(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host.endsWith('.auth0.com') || host.endsWith('.okta.com') || host.endsWith('.oktacdn.com')) {
    return true
  }
  return AUTH_HOST_MARKERS.some((marker) => host.includes(marker))
}

function pathLooksLikeAuth(pathname: string, search: string): boolean {
  const path = pathname.toLowerCase()
  const query = search.toLowerCase()
  if (
    path.includes('/oauth/')
    || path.includes('/oauth2/')
    || path.includes('/oidc/')
    || path.endsWith('/callback')
    || path.includes('/authorize')
  ) {
    return true
  }
  return query.includes('code=') && query.includes('state=')
}

export function classifyLinkPolicy(rawUrl: string): LinkPolicy {
  const classified = classifyExternalUrl(rawUrl)
  if (classified.kind === 'dangerous') {
    return { kind: 'blocked', reason: classified.reason }
  }
  if (classified.kind === 'internal-deeplink') {
    return { kind: 'deeplink', reason: 'Craft deep link stays inside the app router.' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { kind: 'blocked', reason: 'URL is malformed and cannot be parsed.' }
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol === 'http:' || protocol === 'https:') {
    if (hostLooksLikeAuth(parsed.hostname) || pathLooksLikeAuth(parsed.pathname, parsed.search)) {
      return { kind: 'external', reason: 'Auth and OAuth callbacks open in the system browser.' }
    }
    return { kind: 'internal-browser', reason: 'Safe http/https links open in the Rox browser.' }
  }

  return { kind: 'external', reason: 'Mailto, tel, and custom app schemes open in the OS handler.' }
}

/**
 * Format a `dangerous` classification into a user-facing error message.
 * Returns an empty string for non-dangerous classifications.
 */
export function formatBlockedUrlError(classification: UrlClassification): string {
  if (classification.kind !== 'dangerous') return ''
  const suffix = classification.scheme ? ` (${classification.scheme})` : ''
  return `URL blocked${suffix}. ${classification.reason}`
}
