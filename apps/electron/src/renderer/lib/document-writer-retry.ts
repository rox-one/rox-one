/**
 * Notes commit store serialises writers behind a per-directory claim.
 * A lost/contended claim is retried; other failures propagate.
 *
 * Shared by transcript filing and the Notes page so a large save that
 * collides with vault recovery does not drop the draft.
 */
const CLAIM_RETRY_DELAYS_MS = [0, 400, 1000, 2000, 4000, 6000]

/** `MarkdownCommitError` reaches the renderer either as an Error or as a plain RPC object. */
export function claimMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
    const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
    let serialized = ''
    try {
      const json = JSON.stringify(error)
      if (typeof json === 'string') serialized = json
    } catch {
      /* Circular or unserialisable errors carry nothing extra. */
    }
    return [message, code, serialized].filter(Boolean).join(' ')
  }
  return error instanceof Error ? error.message : ''
}

export function isClaimContention(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
  if (code === 'DOCUMENT_BUSY' || code === 'rateLimited') return true
  return /Document claim requires recovery|Document writer is busy|rateLimited/i.test(claimMessage(error))
}

/** Retry a store call whose claim was lost to another writer; other failures propagate. */
export async function withClaimRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const delay of CLAIM_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      return await operation()
    } catch (error) {
      if (!isClaimContention(error)) throw error
      lastError = error
    }
  }
  throw lastError
}
