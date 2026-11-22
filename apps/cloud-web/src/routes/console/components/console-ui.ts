/**
 * Small shared vocabulary for the console pages: how a machine state, a
 * billing mode or an audit action reads in Russian, and how a page hands a
 * CSV to the browser. Nothing here calls the API or holds state.
 */
import type { BadgeTone } from '@/components'
import { ApiError } from '@/lib/api'
import type { GpuSpec } from '@/lib/api'
import { formatDuration } from '@/lib/format'

const STATE_LABELS: Record<string, string> = {
  queued: 'В очереди',
  starting: 'Запускается',
  running: 'Работает',
  paused: 'Пауза',
  stopping: 'Останавливается',
  stopped: 'Остановлена',
  failed: 'Ошибка',
  expired: 'Срок истёк',
}

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state
}

const STATE_TONES: Record<string, BadgeTone> = {
  queued: 'neutral',
  starting: 'accent',
  running: 'success',
  paused: 'warning',
  stopping: 'warning',
  stopped: 'neutral',
  failed: 'danger',
  expired: 'warning',
}

export function stateTone(state: string): BadgeTone {
  return STATE_TONES[state] ?? 'neutral'
}

/** The payer behind one hour: the platform key or the customer's own. */
export function modeLabel(mode: string | null | undefined): string {
  if (mode === 'managed') return 'Ключ Rox'
  if (mode === 'byok') return 'Свой ключ'
  return '—'
}

/** `{ type: 'h100', count: 1 }` → `1×H100`; `null` when there is no card. */
export function gpuName(gpu: GpuSpec | null | undefined): string | null {
  if (gpu === null || gpu === undefined) return null
  const type = gpu.type.trim()
  if (type.length === 0) return null
  return `${gpu.count}×${type.toUpperCase()}`
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

export function coresLabel(count: number | null | undefined): string {
  if (count === null || count === undefined || count <= 0) return '—'
  return `${count} ${plural(count, 'ядро', 'ядра', 'ядер')}`
}

export interface MachineSize {
  cpu?: number | null
  memoryGb?: number | null
  diskGb?: number | null
  gpu?: GpuSpec | null
}

/** One machine size in the product's words: `2 CPU · 4 GB RAM · 8 GB SSD`. */
export function sizeLine(size: MachineSize): string {
  const parts: string[] = []
  if (size.cpu !== null && size.cpu !== undefined && size.cpu > 0) parts.push(`${size.cpu} CPU`)
  if (size.memoryGb !== null && size.memoryGb !== undefined && size.memoryGb > 0) {
    parts.push(`${size.memoryGb} GB RAM`)
  }
  if (size.diskGb !== null && size.diskGb !== undefined && size.diskGb > 0) {
    parts.push(`${size.diskGb} GB SSD`)
  }
  const card = gpuName(size.gpu)
  if (card !== null) parts.push(card)
  return parts.length === 0 ? '—' : parts.join(' · ')
}

/** `900` → `15 мин`, `3600` → `1 ч`, `86400` → `24 ч`. */
export function ttlLabel(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} ч`
  if (seconds % 60 === 0) return `${seconds / 60} мин`
  return formatDuration(seconds)
}

/** The public site names behind the region ids; anything unknown stays its id. */
export function regionLabel(id: string | null | undefined): string {
  if (id === null || id === undefined || id.length === 0) return 'площадка не указана'
  if (id === 'us') return 'США, Запад 1'
  if (id === 'us-west-4') return 'США, Запад 4'
  return id
}

const REGION_FLAGS: Record<string, string> = {
  us: '🇺🇸',
  'us-west-4': '🇺🇸',
  'us-east': '🇺🇸',
  'eu-central': '🇩🇪',
  'eu-west': '🇪🇺',
  eu: '🇪🇺',
  uk: '🇬🇧',
  ap: '🌏',
  asia: '🌏',
}

/** A country flag for the region; an unknown region gets a globe, never a guess. */
export function regionFlag(id: string | null | undefined): string {
  return REGION_FLAGS[id ?? ''] ?? '🌐'
}

/**
 * The friendly name a person sees in the prompt and the page: the image
 * family, disk and CPU×RAM, e.g. `rox-computer-medium-8G-2x4`.
 */
export function machineDisplayName(spec?: {
  snapshot?: string | null
  image?: string | null
  cpu?: number | null
  memoryGb?: number | null
  diskGb?: number | null
}): string {
  const source = spec?.snapshot ?? spec?.image ?? ''
  // A vendor image name is a build detail, not a machine family. The image
  // family is used only when it is Rox's own short name; everything else is
  // the plain base name, so `daytonaio/sandbox:0.11.0` never reaches a title.
  const vendor = /daytona|sandbox:|^[a-z0-9.-]+\/[a-z]/i.test(source)
  const family = vendor
    ? 'base'
    : source.replace(/^rox-(?:cloud-)?/, '').replace(/-?\d+x\d+$/, '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'base'
  const cpu = spec?.cpu ?? 1
  const ram = spec?.memoryGb ?? 1
  const disk = typeof spec?.diskGb === 'number' ? `${spec.diskGb}G-` : ''
  return `rox-computer-${family}-${disk}${cpu}x${ram}`
}

const AUDIT_LABELS: Record<string, string> = {
  'sandbox.create': 'Запуск машины',
  'sandbox.stop': 'Остановка машины',
  'sandbox.delete': 'Удаление машины',
  'sandbox.extend': 'Продление машины',
  'sandbox.preview': 'Ссылка на сайт',
  'sandbox.ssh': 'SSH-доступ',
  'sandbox.snapshot': 'Снимок машины',
  'sandbox.ssh_key': 'SSH-ключ',
  'tenant.guest': 'Гостевой вход',
  'tenant.credit': 'Пополнение баланса',
  'tenant.rotate_key': 'Перевыпуск ключа',
  'tenant.limits': 'Изменение лимитов',
  'credit.grant': 'Начисление на счёт',
  'ticket.open': 'Обращение открыто',
  'ticket.reply': 'Ответ по обращению',
  'ticket.resolve': 'Обращение закрыто',
  'killswitch.set': 'Рубильник',
  'killswitch.approve': 'Рубильник подтверждён',
  'abuse.confirm': 'Подтверждено злоупотребление',
  'abuse.dismiss': 'Отклонено злоупотребление',
  'incident.open': 'Происшествие открыто',
  'incident.update': 'Происшествие обновлено',
  'incident.resolve': 'Происшествие закрыто',
  'impersonate.start': 'Вход дежурного',
}

export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action
}

/** Upstream names never reach a customer. The service's own words stay, while
 * the provider behind them and its hosts are said in Rox's words: an error
 * never names the company that runs the machine. */
function customerSafe(text: string): string {
  return text
    .replace(/Провайдер\s*«[^»]*»/g, 'Сервис машин')
    .replace(/ssh\.app\.daytona\.io/gi, 'ssh.rox.computer')
    .replace(/daytonaproxy\d*\.net/gi, 'preview.rox.computer')
    .replace(/(?:[a-z0-9-]+\.)*daytona\.(?:io|net|com)/gi, 'rox.computer')
    .replace(/daytona/gi, 'Rox')
}

/** One line for an alert: the server's words plus its code, when it has one. */
export function errorText(err: unknown): string {
  const text =
    err instanceof ApiError ? err.toString() : err instanceof Error ? err.message : String(err)
  return customerSafe(text)
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * A UTF-8 CSV with a BOM, so Excel opens Russian labels instead of mojibake.
 * The rows are already formatted for a person: dates and money as printed.
 */
export function downloadCsv(
  filename: string,
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): void {
  const text = [header.map(csvCell).join(',')]
  for (const row of rows) text.push(row.map(csvCell).join(','))
  const joined = text.join('\r\n')
  const blob = new Blob([`\uFEFF${joined}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Today's date as `2026-11-22`, for a CSV file name. */
export function todayStamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
