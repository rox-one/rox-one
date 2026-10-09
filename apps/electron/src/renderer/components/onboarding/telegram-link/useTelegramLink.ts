/**
 * Telegram account linking — renderer state machine.
 *
 * The dialog owns presentation; this hook owns the flow:
 *   start → open the deep link → poll the pending link → confirm the 8-char
 *   code → 30-minute countdown. It never invents states: an absent client or an
 *   unreachable service surfaces as `unavailable`.
 *
 * The link-service client is injected by the caller (it holds the base URL and
 * bearer token). When the caller has none, the Electron bridge is used if the
 * host exposes it, otherwise the dialog states the service is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  TelegramLinkError,
  type TelegramLinkClient,
  type TelegramLinkErrorCode,
  type TelegramLinkPhase,
} from '@rox/shared/telegram-link/client'

/** Dialog-facing state. Service phases are collapsed to what the UI renders. */
export type TelegramLinkView = 'idle' | 'waiting' | 'code' | 'confirmed' | 'expired' | 'unavailable'

export type TelegramLinkFailure = TelegramLinkErrorCode | 'unavailable'

export interface UseTelegramLinkOptions {
  /** Whether the dialog is open; polling and the countdown stop when closed. */
  open: boolean
  /** Link-service client. Omit to fall back to the Electron bridge. */
  client?: TelegramLinkClient
  /** Account id passed to `/api/link/start`. */
  accountId?: string
  /** Opens the Telegram deep link (shell.openExternal). */
  openExternal?: (url: string) => void | Promise<void>
  /** Called once when the link is confirmed. */
  onLinked?: () => void
  /** Poll cadence while waiting for the code. */
  pollMs?: number
  /** Countdown tick cadence. */
  tickMs?: number
  /** Clock seam. */
  now?: () => number
}

export interface UseTelegramLink {
  status: TelegramLinkView
  /** Creates a link (if needed) and opens Telegram. */
  start: () => Promise<void>
  /** Confirms the 8-char code. */
  submitCode: (code: string) => Promise<void>
  /** Milliseconds left before the link expires (0 when unknown/expired). */
  remainingMs: number
  /** Last confirm/start failure; cleared on the next attempt. */
  error: TelegramLinkFailure | null
  /** Code auto-returned by the service, for pre-filling the manual field. */
  deliveredCode: string | null
  /** Masked phone shared with the bot, when available. */
  phoneMasked: string | null
}

const DEFAULT_POLL_MS = 3000
const DEFAULT_TICK_MS = 1000

/** Phases during which polling/countdown are live. */
const ACTIVE_VIEWS: Record<TelegramLinkView, boolean> = {
  idle: false,
  waiting: true,
  code: true,
  confirmed: false,
  expired: false,
  unavailable: false,
}

/** The subset of the Electron bridge the link flow relies on. */
interface TelegramBridgeApi {
  tgLinkStart: () => Promise<Record<string, unknown>>
  tgLinkStatus: () => Promise<Record<string, unknown>>
  tgLinkVerify: (code: string) => Promise<Record<string, unknown>>
}

function isTelegramBridge(value: unknown): value is TelegramBridgeApi {
  if (!value || typeof value !== 'object') return false
  return 'tgLinkStart' in value && typeof value.tgLinkStart === 'function'
    && 'tgLinkStatus' in value && typeof value.tgLinkStatus === 'function'
    && 'tgLinkVerify' in value && typeof value.tgLinkVerify === 'function'
}

function toServicePhase(value: unknown): TelegramLinkPhase {
  switch (value) {
    case 'waiting': case 'waiting-code': return 'waiting'
    case 'code_issued': case 'code-sent': return 'code_issued'
    case 'confirmed': case 'linked': return 'confirmed'
    case 'expired': return 'expired'
    default: return 'waiting'
  }
}

function bridgeFailure(raw: unknown): never {
  if (raw === 'INVALID_CODE') throw new TelegramLinkError('invalid_code')
  if (raw === 'expired') throw new TelegramLinkError('expired')
  throw new TelegramLinkError('network')
}

/**
 * Adapts the Electron bridge (main owns the token) to the client surface.
 * Supports both the service vocabulary and the legacy shorthand.
 */
function bridgeClient(): TelegramLinkClient | undefined {
  if (typeof window === 'undefined') return undefined
  const api: unknown = window.electronAPI
  if (!isTelegramBridge(api)) return undefined
  return {
    async start() {
      const result = await api.tgLinkStart()
      if (!result.ok) return bridgeFailure(result.error)
      const linkId = typeof result.linkId === 'string' ? result.linkId : ''
      const deepLink = typeof result.deepLink === 'string' ? result.deepLink : typeof result.tgDeepLink === 'string' ? result.tgDeepLink : ''
      const expiresAt = typeof result.expiresAt === 'number' ? result.expiresAt : Number.NaN
      if (!linkId || !deepLink || !Number.isFinite(expiresAt)) throw new TelegramLinkError('invalid_response')
      return { linkId, deepLink, expiresAt }
    },
    async status() {
      const result = await api.tgLinkStatus()
      if (!result.ok) return bridgeFailure(result.error)
      const status = toServicePhase(result.status)
      const code = typeof result.code === 'string' && result.code ? result.code : undefined
      const phoneMasked = typeof result.phoneMasked === 'string' && result.phoneMasked ? result.phoneMasked : undefined
      return { status, ...(code ? { code } : {}), ...(phoneMasked ? { phoneMasked } : {}) }
    },
    async confirm(_linkId, code) {
      const result = await api.tgLinkVerify(code)
      if (!result.ok) return bridgeFailure(result.error)
      if (toServicePhase(result.status) === 'expired') throw new TelegramLinkError('expired')
      // The tg-link RPC answers a wrong code with `ok: true, status: 'invalid'`
      // (a successful negative), so it must not be read as a confirmation.
      if (result.status === 'invalid') throw new TelegramLinkError('invalid_code')
      return { status: 'confirmed' }
    },
  }
}

export function useTelegramLink(options: UseTelegramLinkOptions): UseTelegramLink {
  const {
    open,
    client,
    accountId,
    openExternal,
    onLinked,
    pollMs = DEFAULT_POLL_MS,
    tickMs = DEFAULT_TICK_MS,
    now = Date.now,
  } = options

  const [status, setStatus] = useState<TelegramLinkView>('idle')
  const [remainingMs, setRemainingMs] = useState(0)
  const [error, setError] = useState<TelegramLinkFailure | null>(null)
  const [deliveredCode, setDeliveredCode] = useState<string | null>(null)
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null)

  const linkIdRef = useRef<string | null>(null)
  const deepLinkRef = useRef<string | null>(null)
  const expiresAtRef = useRef<number | null>(null)
  const linkedNotifiedRef = useRef(false)
  const statusRef = useRef(status)
  statusRef.current = status

  const activeClient = useMemo(() => client ?? bridgeClient(), [client])

  const confirmRef = useRef<() => void>(() => {})
  confirmRef.current = () => {
    if (linkedNotifiedRef.current) return
    linkedNotifiedRef.current = true
    onLinked?.()
  }

  const applyPhase = useCallback((phase: TelegramLinkPhase, extras?: { code?: string; phoneMasked?: string }) => {
    if (extras?.code) setDeliveredCode(extras.code)
    if (extras?.phoneMasked) setPhoneMasked(extras.phoneMasked)
    if (phase === 'confirmed') {
      setStatus('confirmed')
      confirmRef.current()
      return
    }
    if (phase === 'expired') setStatus('expired')
    else if (phase === 'code_issued') setStatus('code')
    else setStatus('waiting')
  }, [])

  /** Poll the pending link. Transient failures keep the current state. */
  const refresh = useCallback(async () => {
    const active = activeClient
    const linkId = linkIdRef.current
    if (!active || !linkId) return
    try {
      const result = await active.status(linkId)
      applyPhase(result.status, { code: result.code, phoneMasked: result.phoneMasked })
    } catch {
      /* Transient poll failure: stay honest in the current state. */
    }
  }, [activeClient, applyPhase])

  const start = useCallback(async () => {
    setError(null)
    const active = activeClient
    if (!active) {
      setStatus('unavailable')
      return
    }
    // Re-open an existing, unexpired link instead of minting a new one.
    if (linkIdRef.current && expiresAtRef.current && expiresAtRef.current > now()) {
      const existing = deepLinkRef.current
      if (existing) {
        try {
          await openExternal?.(existing)
        } catch {
          /* Telegram handler unavailable; the link stays pending. */
        }
      }
      await refresh()
      return
    }
    try {
      const result = await active.start(accountId ?? '')
      linkIdRef.current = result.linkId
      deepLinkRef.current = result.deepLink
      expiresAtRef.current = result.expiresAt
      linkedNotifiedRef.current = false
      setRemainingMs(Math.max(0, result.expiresAt - now()))
      applyPhase('waiting')
      try {
        await openExternal?.(result.deepLink)
      } catch {
        /* Telegram handler unavailable; the link stays pending. */
      }
    } catch (failure) {
      if (!(failure instanceof TelegramLinkError)) throw failure
      setStatus('unavailable')
      setError(failure.code)
    }
  }, [accountId, activeClient, applyPhase, now, openExternal, refresh])

  const submitCode = useCallback(async (code: string) => {
    setError(null)
    const active = activeClient
    const linkId = linkIdRef.current
    if (!active || !linkId) {
      setStatus('unavailable')
      return
    }
    try {
      await active.confirm(linkId, code)
      applyPhase('confirmed')
    } catch (failure) {
      if (!(failure instanceof TelegramLinkError)) throw failure
      if (failure.code === 'expired') {
        setStatus('expired')
        return
      }
      if (failure.code === 'invalid_code') setError('invalid_code')
      else setError(failure.code)
    }
  }, [activeClient, applyPhase])

  // Poll while pending; count down to expiry.
  useEffect(() => {
    if (!open) return
    const poll = setInterval(() => {
      if (ACTIVE_VIEWS[statusRef.current]) void refresh()
    }, pollMs)
    const tick = setInterval(() => {
      const expiresAt = expiresAtRef.current
      if (expiresAt === null) return
      const left = Math.max(0, expiresAt - now())
      setRemainingMs(left)
      if (left === 0 && ACTIVE_VIEWS[statusRef.current]) setStatus('expired')
    }, tickMs)
    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [open, pollMs, tickMs, now, refresh])

  // Reset per-open so a reopened dialog starts clean.
  useEffect(() => {
    if (open) return
    linkIdRef.current = null
    deepLinkRef.current = null
    expiresAtRef.current = null
    linkedNotifiedRef.current = false
    setStatus('idle')
    setRemainingMs(0)
    setError(null)
    setDeliveredCode(null)
    setPhoneMasked(null)
  }, [open])

  return { status, start, submitCode, remainingMs, error, deliveredCode, phoneMasked }
}