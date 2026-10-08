/**
 * Renderer-side extraction of human-readable messages from unknown rejection
 * values.
 *
 * RPC failures arrive as plain `{ code, message, data? }` objects, not Error
 * instances: the preload's invoke wrapper re-throws them that way because
 * contextBridge rebuilds native Errors from `message` only (custom properties
 * such as `code` are dropped). Code that assumes `instanceof Error` and falls
 * back to `String(error)` renders those objects as "[object Object]".
 *
 * Real `Error` values (uncoded failures, non-bridged callers) are handled too.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; error?: unknown; code?: unknown }
    if (typeof record.message === 'string' && record.message.trim()) return record.message
    if (typeof record.error === 'string' && record.error.trim()) return record.error
    if (typeof record.code === 'string' && record.code.trim()) return record.code
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}