/**
 * Mailbox handle rules (spec §2.3): [a-z0-9._-], 3–32 chars, no leading/
 * trailing dot, no "..", reserved/service names refused. Collisions resolve
 * to handle2, handle3, …
 */

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'postmaster', 'abuse', 'admin', 'administrator', 'root', 'support', 'noreply', 'no-reply', 'dmarc', 'security',
  'hostmaster', 'webmaster', 'mailer-daemon', 'info', 'billing', 'help', 'rox', 'team', 'system', 'mail', 'www',
  'api', 'mx', 'smtp', 'imap', 'jmap', 'autoconfig', 'autodiscover', 'mta-sts', 'sales', 'legal', 'privacy',
  'news', 'newsletter', 'bounce', 'bounces', 'devnull', 'nobody', 'test', 'official', 'staff', 'owner',
])

const RU_TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim().toLowerCase()
  if (s.includes('@')) s = s.split('@')[0]!
  s = s.replace(/^@+/, '')
  s = Array.from(s).map((ch) => RU_TRANSLIT[ch] ?? ch).join('')
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  s = s.replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '')
  s = s.replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '')
  if (s.length > 32) s = s.slice(0, 32).replace(/[._-]+$/g, '')
  if (s.length < 3) return null
  return s
}

export function isAllowedHandle(handle: string): boolean {
  return normalizeHandle(handle) === handle && !RESERVED_HANDLES.has(handle)
}

/** First allowed handle from the candidates, else the fallback. */
export function pickHandle(candidates: ReadonlyArray<string | null | undefined>, fallback = 'mark'): string {
  for (const c of candidates) {
    const h = normalizeHandle(c)
    if (h && !RESERVED_HANDLES.has(h)) return h
  }
  return fallback
}

/** handle, handle2, handle3, … (keeps within 32 chars). */
export function* handleVariants(handle: string, max = 50): Generator<string> {
  yield handle
  for (let i = 2; i <= max; i++) {
    const suffix = String(i)
    yield handle.slice(0, 32 - suffix.length) + suffix
  }
}
