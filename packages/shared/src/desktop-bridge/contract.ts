/**
 * Versioned contract for the embedded-surface desktop bridge (`window.roxDesktop`).
 *
 * The preload exposes this bridge only to the host-side Control-UI window, and
 * the same validator runs on both sides: the preload refuses before any IPC is
 * sent, and the main process re-validates the envelope before dispatching. Every
 * call carries an explicit `{ v }` handshake so a future protocol revision can
 * be rejected cleanly instead of silently mis-dispatched.
 */

/** The only bridge protocol revision this build implements. */
export const ROX_DESKTOP_BRIDGE_VERSION = 1

/** Single main-process IPC channel carrying a validated bridge envelope. */
export const ROX_DESKTOP_BRIDGE_CHANNEL = 'rox-desktop:invoke'

/** Global object key the preload exposes through `contextBridge`. */
export const ROX_DESKTOP_BRIDGE_WORLD_KEY = 'roxDesktop'

/**
 * Every method the bridge supports. This is the single source of truth: both
 * the preload gate and the main-process handler map are checked against it, so
 * the two sides cannot drift.
 */
export const ROX_DESKTOP_BRIDGE_METHODS = Object.freeze([
  'browser.open',
  'browser.navigate',
  'browser.releaseScope',
  'device.permissionStatus',
  'app.openLink',
  'gateway.status',
  'notifications.show',
] as const)

export type RoxDesktopBridgeMethod = (typeof ROX_DESKTOP_BRIDGE_METHODS)[number]

/** One registry entry: the method name and the protocol revision that owns it. */
export interface RoxDesktopBridgeMethodSpec {
  readonly method: RoxDesktopBridgeMethod
  readonly version: number
}

/**
 * The method registry. Every entry is pinned to the current bridge revision;
 * a method that needs a breaking payload change gets a new revision here rather
 * than mutating the existing one.
 */
export const ROX_DESKTOP_BRIDGE_REGISTRY: readonly RoxDesktopBridgeMethodSpec[] = Object.freeze(
  ROX_DESKTOP_BRIDGE_METHODS.map(method => Object.freeze({ method, version: ROX_DESKTOP_BRIDGE_VERSION })),
)

const METHOD_LOOKUP: Readonly<Record<string, true>> = Object.freeze(
  Object.fromEntries(ROX_DESKTOP_BRIDGE_METHODS.map(method => [method, true] as const)),
)

/** True when `value` names a registered bridge method. */
export function isRoxDesktopBridgeMethod(value: string): value is RoxDesktopBridgeMethod {
  return METHOD_LOOKUP[value] === true
}

/** The request envelope a caller sends; `v` is the explicit handshake. */
export interface RoxDesktopBridgeRequest {
  readonly v: number
  readonly method: string
  readonly params?: unknown
}

/** Why a bridge request was refused. Never carries payload or secret data. */
export type RoxDesktopBridgeRefusalCode =
  | 'ROX_DESKTOP_BRIDGE_MALFORMED'
  | 'ROX_DESKTOP_BRIDGE_VERSION_MISMATCH'
  | 'ROX_DESKTOP_BRIDGE_UNKNOWN_METHOD'
  | 'ROX_DESKTOP_BRIDGE_HANDLER_FAILED'

/** Typed refusal returned to the caller instead of throwing across the bridge. */
export interface RoxDesktopBridgeRefusal {
  readonly ok: false
  readonly code: RoxDesktopBridgeRefusalCode
  /** The revision this build speaks; a caller can decide to downgrade or warn. */
  readonly expectedVersion: number
  /** Present when the caller supplied a version that is not the expected one. */
  readonly receivedVersion?: number
  /** Present when the refusal is about a specific method name. */
  readonly method?: string
}

/** A validated request, ready for the handler map. */
export interface RoxDesktopBridgeAcceptance {
  readonly ok: true
  readonly method: RoxDesktopBridgeMethod
  readonly params: unknown
}

export type RoxDesktopBridgeValidation = RoxDesktopBridgeAcceptance | RoxDesktopBridgeRefusal

/** A successful bridge call. */
export interface RoxDesktopBridgeSuccess {
  readonly ok: true
  readonly result: unknown
}

/** What a bridge call resolves to: a success or a typed refusal. */
export type RoxDesktopBridgeResponse = RoxDesktopBridgeSuccess | RoxDesktopBridgeRefusal

function refuse(code: RoxDesktopBridgeRefusalCode, extra: Partial<RoxDesktopBridgeRefusal> = {}): RoxDesktopBridgeRefusal {
  return { ok: false, code, expectedVersion: ROX_DESKTOP_BRIDGE_VERSION, ...extra }
}

/**
 * Pure validator shared by the preload and the main process.
 *
 * Order matters: a missing/mistyped envelope is malformed, a recognised shape
 * with the wrong revision is a version mismatch, and only a correct revision
 * with an unregistered name is an unknown method.
 */
export function validateRoxDesktopBridgeRequest(input: unknown): RoxDesktopBridgeValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return refuse('ROX_DESKTOP_BRIDGE_MALFORMED')
  }

  const record = input as Record<string, unknown>
  const version = record.v
  const method = record.method

  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return refuse('ROX_DESKTOP_BRIDGE_MALFORMED')
  }
  if (typeof method !== 'string' || method.length === 0) {
    return refuse('ROX_DESKTOP_BRIDGE_MALFORMED', { receivedVersion: version })
  }
  if (version !== ROX_DESKTOP_BRIDGE_VERSION) {
    return refuse('ROX_DESKTOP_BRIDGE_VERSION_MISMATCH', { receivedVersion: version, method })
  }
  if (!isRoxDesktopBridgeMethod(method)) {
    return refuse('ROX_DESKTOP_BRIDGE_UNKNOWN_METHOD', { receivedVersion: version, method })
  }

  return { ok: true, method, params: record.params }
}