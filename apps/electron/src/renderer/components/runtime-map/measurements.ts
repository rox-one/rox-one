import type { Measurement } from '@rox/core/runtime-trace'

/** Keep provenance next to every value; an unknown observation is never zero. */
export function measurementText<T>(measurement: Measurement<T> | undefined, format: (value: T) => string = String): string | undefined {
  if (!measurement || measurement.state !== 'known') return undefined
  const prefix = measurement.origin === 'estimated' ? '≈' : ''
  return `${prefix}${format(measurement.value)}`
}

export function durationText(measurement: Measurement<number> | undefined): string | undefined {
  return measurementText(measurement, ms => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
}

/** Defense in depth for summaries/copy; the server remains the redaction authority. */
export function safeDisplayText(value: string | undefined, maxLength = 262_144): string {
  if (!value) return ''
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*["']?\s*[=:]\s*["']?)(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;&]+/gi, '$1[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted]')
    .slice(0, maxLength)
}

export function safePreview(value: string | undefined, maxLength = 160): string {
  return safeDisplayText(value).replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function contextFill(input: Measurement<number>, window: Measurement<number>): Measurement<number> {
  if (input.state !== 'known' || window.state !== 'known' || window.value <= 0) return { state: 'unknown', reason: 'not-emitted' }
  return { state: 'known', value: input.value / window.value * 100, origin: input.origin === 'estimated' || window.origin === 'estimated' ? 'estimated' : 'derived', source: `${input.source} / ${window.source}` }
}
