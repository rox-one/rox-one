const SECRET_KEY = /^(authorization|cookie|set-cookie|password|passwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|sharedownerkey|x-api-key)$/i
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/-]+=*|sk-[a-z0-9]{8,}|ghp_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,})/i

export const REDACTED = '[redacted]'

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}

export function redactText(value: string): string {
  return value.replace(SECRET_VALUE, REDACTED)
}

export function redactTelemetryPayload(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value)
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => redactTelemetryPayload(item))

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    out[key] = isSecretKey(key) ? REDACTED : redactTelemetryPayload(nested)
  }
  return out
}

export function estimatePayloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}
