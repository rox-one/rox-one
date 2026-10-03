import { redactRegisteredSecrets } from '@rox/shared/secrets'

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
      if (Array.isArray(node)) {
        const output: unknown[] = []
        for (let index = 0; index < Math.min(node.length, MAX_ENTRIES); index++) {
          if (--remaining < 0) { output.push('[Trace size limit]'); break }
          const descriptor = Object.getOwnPropertyDescriptor(node, String(index))
          output.push(descriptor && 'value' in descriptor ? walk(descriptor.value, depth + 1) : '[Accessor or hole omitted]')
        }
        return output
      }
      const output: Record<string, unknown> = Object.create(null)
      for (const key of Object.keys(node)) {
        if (--remaining < 0) { output.traceTruncated = true; break }
        const descriptor = Object.getOwnPropertyDescriptor(node, key)
        // Projection must not execute arbitrary accessors, including a private
        // getter that would run before its value can be masked.
        if (PRIVATE_FIELD.test(key)) output[key] = '[REDACTED]'
        else if (descriptor && 'value' in descriptor) output[key] = walk(descriptor.value, depth + 1)
        else output[key] = '[Accessor omitted]'
      }
      return output
    } finally { ancestors.delete(node) }
  }
  return walk(value, 0)
}
