import { redactRegisteredSecrets } from '@rox/shared/secrets/redact'

const PRIVATE_FIELD = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|credential|credentials|env|environment|envOverrides|thumbnailBase64|base64|dataUrl)$/i
const MAX_DEPTH = 12
const MAX_ENTRIES = 10_000

/** Applied before either the journal, content blob or transport receives data. */
export function sanitizeRuntimeTrace(value: unknown): unknown {
  const ancestors = new WeakSet<object>()
  let remaining = MAX_ENTRIES
  const scrubText = (text: string): string => redactRegisteredSecrets(text)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+\/_=.-]+/gi, '$1 [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)\s*[=:]\s*["']?)[^\s"'&;,}\n]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === 'string') return scrubText(node)
    if (node === null || typeof node !== 'object') return node
    if (depth > MAX_DEPTH || --remaining < 0) return '[Trace depth/size limit]'
    if (ancestors.has(node)) return '[Circular]'
    ancestors.add(node)
    try {
      if (Array.isArray(node)) return node.slice(0, MAX_ENTRIES).map(item => walk(item, depth + 1))
      const output: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(node)) {
        if (--remaining < 0) { output.traceTruncated = true; break }
        output[key] = PRIVATE_FIELD.test(key) ? '[REDACTED]' : walk(entry, depth + 1)
      }
      return output
    } finally { ancestors.delete(node) }
  }
  return walk(value, 0)
}
