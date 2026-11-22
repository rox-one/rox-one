/**
 * One staff-tab session for the whole panel.
 *
 * The key never leaves `sessionStorage`, never enters the address bar and is
 * never kept in component state after a sign-in. This module is the single
 * place where a 401 is turned into «show the key form again», so every page of
 * the panel behaves the same way, and it carries the small shared helpers the
 * admin pages read (labels, money parsing, refresh tick).
 */
import { createSignal } from 'solid-js'

import { ApiError } from '@/lib/api'
import { formatCents } from '@/lib/format'
import {
  clearAdminKey,
  clearStaffName,
  getAdminKey,
  getStaffName,
  setAdminKey,
  setStaffName,
} from '@/lib/session'

export interface AuthNote {
  message: string
  requestId: string | null
}

const [authorized, setAuthorized] = createSignal(getAdminKey().length > 0)
const [authNote, setAuthNote] = createSignal<AuthNote | null>(null)
const [staff, setStaff] = createSignal(getStaffName())
const [refreshTick, setRefreshTick] = createSignal(0)

/** Is this tab holding a staff key the layout already accepted? */
export function adminAuthorized(): boolean {
  return authorized()
}

/** Why the last key stopped working; the sign-in form prints it. */
export function adminAuthNote(): AuthNote | null {
  return authNote()
}

/** The name shown in the top bar. Display only; the server signs with its own id. */
export function adminStaffName(): string {
  return staff()
}

/** Pages reload their data when this number changes. */
export function adminRefreshTick(): number {
  return refreshTick()
}

/** Remember a key the server has just accepted. */
export function acceptStaffSession(key: string, staffName: string): void {
  const name = staffName.trim().length > 0 ? staffName.trim() : 'дежурный'
  setAdminKey(key.trim())
  setStaffName(name)
  setStaff(name)
  setAuthNote(null)
  setAuthorized(true)
}

/** «Выйти»: forget the key and the name this tab held. */
export function forgetStaffSession(): void {
  clearAdminKey()
  clearStaffName()
  setStaff('')
  setAuthNote(null)
  setAuthorized(false)
}

/**
 * A 401 from any call means the key is gone (revoked, rotated or never valid).
 * Drop it from the tab and let the layout put the key form back, with the
 * server's own words and the request id.
 */
export function markUnauthorized(error: unknown): void {
  const message =
    error instanceof ApiError && error.message.length > 0
      ? error.message
      : 'Ключ дежурного больше не действует'
  const requestId = error instanceof ApiError ? error.requestId : null
  clearAdminKey()
  setAuthNote({ message, requestId })
  setAuthorized(false)
}

/** A message for a failed staff call, with the code and the request id. */
export function adminErrorText(error: unknown): string {
  if (error instanceof ApiError) return error.toString()
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * The catch-all for a page: a 401 sends the panel back to the key form, every
 * other failure becomes a line the page shows next to its retry button.
 */
export function handleAdminError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    markUnauthorized(error)
    return error.message
  }
  return adminErrorText(error)
}

/** Ask the current page to reload its data, without touching the session. */
export function requestAdminRefresh(): void {
  setRefreshTick((value) => value + 1)
}

// ============================================================
// Small shared readings
// ============================================================

/**
 * A ceiling from the tenant list itself, when the server sends one. Two names
 * may appear (`monthly_cap_cents` from the wallet, `max_monthly_cents` from the
 * profile); the tighter non-zero value wins, and `0` only when both are zero.
 */
export function tenantInlineCap(tenant: { [key: string]: unknown }): number | null {
  const values: number[] = []
  for (const field of ['monthly_cap_cents', 'max_monthly_cents'] as const) {
    const value = tenant[field]
    if (typeof value === 'number') values.push(value)
  }
  if (values.length === 0) return null
  const positive = values.filter((value) => value > 0)
  return positive.length === 0 ? 0 : Math.min(...positive)
}

/** A count the tenant row carries (`keys`, `sandboxes`, …); absent reads as 0. */
export function tenantCount(tenant: { [key: string]: unknown }, field: string): number {
  const value = tenant[field]
  return typeof value === 'number' ? value : 0
}

/** `0` means «no ceiling of our own», everything else is money. */
export function capText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return cents === 0 ? 'без потолка' : formatCents(cents)
}

/**
 * «10», «10,50», «$10.50» → integer cents. Anything with a third decimal,
 * a minus sign or letters is rejected instead of being rounded silently.
 */
export function parseDollars(input: string): number | null {
  const compact = input
    .replace(/[\s\u00a0]/g, '')
    .replace(/^\$/, '')
    .replace(',', '.')
  if (compact.length === 0) return null
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(compact)
  if (match === null) return null
  const whole = Number(match[1] ?? '0')
  const fraction = (match[2] ?? '').padEnd(2, '0')
  const cents = whole * 100 + Number(fraction)
  return Number.isSafeInteger(cents) ? cents : null
}

/** Whole non-negative number, for machines and cores. */
export function parseCount(input: string): number | null {
  const raw = input.trim()
  if (!/^\d{1,4}$/.test(raw)) return null
  return Number(raw)
}

/** Cents → the dollar text a staff member edits, with a Russian comma. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/** A key is shown as its public prefix and last four; the secret never lands here. */
export function keyHint(prefix: string | undefined, last4: string): string {
  const start = prefix === undefined || prefix.length === 0 ? '' : prefix
  return `${start}…${last4}`
}

const ACTION_LABELS: Record<string, string> = {
  'tenant.credit': 'Пополнение баланса',
  'tenant.rotate_key': 'Перевыпуск ключа',
  'tenant.limits': 'Изменение лимитов',
  'sandbox.create': 'Запуск машины',
  'sandbox.stop': 'Остановка машины',
  'sandbox.delete': 'Удаление машины',
  'sandbox.extend': 'Продление машины',
  'credit.grant': 'Начисление кредита',
  'killswitch.set': 'Рубильник',
  'killswitch.approve': 'Подтверждение рубильника',
  'ticket.open': 'Новое обращение',
  'ticket.reply': 'Ответ на обращение',
  'ticket.resolve': 'Обращение закрыто',
  'incident.open': 'Новое происшествие',
  'incident.update': 'Обновление происшествия',
  'incident.resolve': 'Происшествие закрыто',
  'abuse.confirm': 'Злоупотребление подтверждено',
  'abuse.dismiss': 'Злоупотребление отклонено',
  'impersonate.start': 'Вход от имени клиента',
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

const LEDGER_LABELS: Record<string, string> = {
  topup: 'пополнение',
  reserve: 'резерв',
  release: 'возврат резерва',
  settle: 'списание',
}

export function ledgerKindLabel(kind: string): string {
  return LEDGER_LABELS[kind] ?? kind
}

const PROVIDER_LABELS: Record<string, string> = {
  daytona: 'Daytona',
  e2b: 'E2B',
  modal: 'Modal',
  cloudflare: 'Cloudflare',
  local: 'локальный',
  native: 'своя машина',
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

const SANDBOX_STATES: Record<string, string> = {
  queued: 'в очереди',
  starting: 'запускается',
  running: 'работает',
  paused: 'на паузе',
  stopping: 'останавливается',
  stopped: 'остановлена',
  failed: 'ошибка',
  expired: 'истёк срок',
}

export function sandboxStateLabel(state: string): string {
  return SANDBOX_STATES[state] ?? state
}

export type AdminTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function sandboxStateTone(state: string): AdminTone {
  switch (state) {
    case 'running':
      return 'success'
    case 'queued':
    case 'starting':
      return 'accent'
    case 'paused':
    case 'stopping':
      return 'warning'
    case 'failed':
    case 'expired':
      return 'danger'
    default:
      return 'neutral'
  }
}

const CREDENTIAL_STATUSES: Record<string, string> = {
  active: 'действует',
  standby: 'в запасе',
  disabled: 'выключен',
  expired: 'истёк',
}

export function credentialStatusLabel(status: string): string {
  return CREDENTIAL_STATUSES[status] ?? status
}

export function credentialStatusTone(status: string): AdminTone {
  switch (status) {
    case 'active':
      return 'success'
    case 'standby':
      return 'accent'
    case 'expired':
      return 'danger'
    default:
      return 'neutral'
  }
}
