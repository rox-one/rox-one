/**
 * Jam (jam.dev) session recorder loader for the web UI.
 *
 * Consent model
 * -------------
 * The web UI has no shared consent store yet, so consent is persisted locally
 * under `JAM_CONSENT_KEY` (`localStorage['rox.jam.enabled'] === '1'`). The team
 * id is baked in at build time via `VITE_JAM_TEAM` (public, safe to embed).
 *
 * Nothing is loaded until BOTH are true:
 *   - consent was granted (`rox.jam.enabled === '1'`), and
 *   - a team id is configured (`VITE_JAM_TEAM`).
 *
 * No meta tag, recorder script, capture script or cookie touches the page while
 * the consent flag is off. The team id mirrors the marketing site snippet
 * (apps/marketing layout) which uses the same `jam:team` meta + module scripts.
 */

/** Persisted consent flag. Must equal `'1'` for Jam to be allowed to load. */
export const JAM_CONSENT_KEY = 'rox.jam.enabled'

/** Official Jam recorder entry points (verified against the marketing snippet). */
export const JAM_RECORDER_SRC = 'https://js.jam.dev/recorder.js'
export const JAM_CAPTURE_SRC = 'https://js.jam.dev/capture.js'

function storage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined
  } catch {
    // Access can throw in hardened/private browsing contexts.
    return undefined
  }
}

/** True once the user has granted Jam consent (independent of team config). */
export function isConsented(): boolean {
  return storage()?.getItem(JAM_CONSENT_KEY) === '1'
}

/** Build-time configured Jam team id, or `undefined` when not configured. */
export function jamTeamId(): string | undefined {
  const raw = import.meta.env.VITE_JAM_TEAM
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined
}

let injected = false

/** True once the recorder tags have been injected in this document. */
export function isInjected(): boolean {
  return injected
}

/** Whether the recorder is allowed to load right now (consent + team id). */
export function isEnabled(): boolean {
  return isConsented() && jamTeamId() !== undefined
}

/**
 * Inject the `jam:team` meta tag and the official recorder/capture module
 * scripts exactly once. Returns `true` when this call performed the injection.
 * Safe to call in non-DOM environments (returns `false`).
 */
export function injectJamRecorder(team: string): boolean {
  if (injected) return false
  const id = team.trim()
  if (!id) return false
  if (typeof document === 'undefined' || !document.head) return false

  const meta = document.createElement('meta')
  meta.name = 'jam:team'
  meta.content = id
  document.head.appendChild(meta)

  for (const src of [JAM_RECORDER_SRC, JAM_CAPTURE_SRC]) {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = src
    document.head.appendChild(script)
  }

  injected = true
  return true
}

/**
 * Grant consent and load the recorder when a team id is configured. This is the
 * explicit user-consent entry point (e.g. a settings toggle).
 */
export function enable(): void {
  storage()?.setItem(JAM_CONSENT_KEY, '1')
  const team = jamTeamId()
  if (team) injectJamRecorder(team)
}

/**
 * Revoke consent. Removes the injected tags so a subsequent reload does not
 * re-load them; a page reload is required to fully stop an already-running
 * recorder. The injected guard stays set to avoid double injection.
 */
export function disable(): void {
  storage()?.removeItem(JAM_CONSENT_KEY)
  if (typeof document !== 'undefined' && document.head) {
    for (const el of Array.from(
      document.head.querySelectorAll('meta[name="jam:team"], script[src^="https://js.jam.dev/"]'),
    )) {
      el.remove()
    }
  }
}

/**
 * Boot hook. Loads the recorder only when consent was previously granted; a
 * no-op otherwise, so the flag being off means nothing Jam-related loads.
 */
export function applyConsent(): void {
  if (!isConsented()) return
  const team = jamTeamId()
  if (team) injectJamRecorder(team)
}