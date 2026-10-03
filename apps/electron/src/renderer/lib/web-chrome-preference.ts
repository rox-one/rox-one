/** Browser-only CSS material preference. It conveys no native shell capability. */
export const WEB_CHROME_PREFERENCE_KEY = 'rox-web-chrome-material-v1'
const WEB_CHROME_PREFERENCE_CHANGED = 'rox:web-chrome-preference-changed'

export type WebChromeMaterialPreference = 'system' | 'glass' | 'opaque'
export interface WebChromePreference {
  enabled: boolean
  preference: WebChromeMaterialPreference
}

type WebChromeStorage = Pick<Storage, 'getItem' | 'setItem'>
interface WebChromeHost extends Pick<EventTarget, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'> {
  localStorage: WebChromeStorage
}

const DEFAULT_PREFERENCE: WebChromePreference = { enabled: true, preference: 'system' }

function parsePreference(raw: unknown): WebChromePreference {
  if (raw && typeof raw === 'object') {
    const value = raw as Partial<WebChromePreference>
    if (typeof value.enabled === 'boolean' && ['system', 'glass', 'opaque'].includes(value.preference ?? '')) {
      return { enabled: value.enabled, preference: value.preference! }
    }
  }
  return { ...DEFAULT_PREFERENCE }
}

function browserStorage(): WebChromeStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

export function readWebChromePreference(storage: WebChromeStorage | undefined = browserStorage()): WebChromePreference {
  try {
    const raw = storage?.getItem(WEB_CHROME_PREFERENCE_KEY)
    return raw ? parsePreference(JSON.parse(raw)) : { ...DEFAULT_PREFERENCE }
  } catch {
    return { ...DEFAULT_PREFERENCE }
  }
}

/** A disabled shell and an explicit opaque choice both stop browser CSS glass. */
export function resolveWebChromeMaterial(preference: WebChromePreference): 'glass' | 'solid' {
  return preference.enabled && preference.preference !== 'opaque' ? 'glass' : 'solid'
}

/** Commit only after local persistence can be read back. Storage failures propagate. */
export function saveWebChromePreference(
  patch: { enabled?: boolean; materialPreference?: WebChromeMaterialPreference },
  host: WebChromeHost = window,
): WebChromePreference {
  const current = readWebChromePreference(host.localStorage)
  const next = { enabled: patch.enabled ?? current.enabled, preference: patch.materialPreference ?? current.preference }
  if (typeof next.enabled !== 'boolean' || !['system', 'glass', 'opaque'].includes(next.preference)) {
    throw new Error('Invalid browser chrome preference')
  }
  const serialized = JSON.stringify(next)
  host.localStorage.setItem(WEB_CHROME_PREFERENCE_KEY, serialized)
  if (host.localStorage.getItem(WEB_CHROME_PREFERENCE_KEY) !== serialized) {
    throw new Error('Browser chrome preference could not be read back')
  }
  const saved = parsePreference(JSON.parse(serialized))
  host.dispatchEvent(new Event(WEB_CHROME_PREFERENCE_CHANGED))
  return saved
}

/** Same-tab writes emit a local event; other tabs use the browser storage event. */
export function subscribeWebChromePreference(
  onPreference: (preference: WebChromePreference) => void,
  host: WebChromeHost = window,
): () => void {
  let stopped = false
  const reread = () => {
    if (!stopped) {
      let storage: WebChromeStorage | undefined
      try { storage = host.localStorage } catch { /* Storage may be unavailable in a restricted browser. */ }
      onPreference(readWebChromePreference(storage))
    }
  }
  const onStorage = (event: Event) => {
    const storageEvent = event as StorageEvent
    try {
      if (storageEvent.storageArea && storageEvent.storageArea !== host.localStorage) return
    } catch { return }
    const key = storageEvent.key
    if (key === WEB_CHROME_PREFERENCE_KEY || key === null) reread()
  }
  host.addEventListener(WEB_CHROME_PREFERENCE_CHANGED, reread)
  host.addEventListener('storage', onStorage)
  reread()
  return () => {
    stopped = true
    host.removeEventListener(WEB_CHROME_PREFERENCE_CHANGED, reread)
    host.removeEventListener('storage', onStorage)
  }
}
