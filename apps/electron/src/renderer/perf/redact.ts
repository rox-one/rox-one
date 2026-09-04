/**
 * Local-only redaction for perf telemetry.
 * Never persist raw paths, emails, tokens, or message bodies.
 */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const TOKEN = /\b(?:sk-|ghp_|github_pat_|xox[baprs]-|Bearer\s+)[A-Za-z0-9._\-\/=+]{8,}\b/gi
const ABS_PATH = /(?:\/(?:Users|home|var|tmp|opt|workspace)\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+)/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

const DROP_KEYS = new Set([
  'content',
  'text',
  'body',
  'prompt',
  'message',
  'messages',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'password',
  'secret',
  'authorization',
  'email',
  'path',
  'rootPath',
  'workingDirectory',
])

export function redactString(value: string): string {
  return value
    .replace(TOKEN, '[redacted-token]')
    .replace(EMAIL, '[redacted-email]')
    .replace(ABS_PATH, '[redacted-path]')
    .replace(UUID, '[redacted-id]')
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]'
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(key)) {
        out[key] = '[redacted]'
        continue
      }
      out[key] = redactValue(child, depth + 1)
    }
    return out
  }
  return '[redacted]'
}

export function redactSessionId(sessionId: string): string {
  if (sessionId.length <= 8) return sessionId
  return `${sessionId.slice(0, 8)}…`
}
