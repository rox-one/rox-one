/**
 * Bounded, insertion-ordered deduplication cache. Used to make inbound
 * delivery exactly-once from the Cloudflare worker's point of view: a key
 * (Message-ID or a hash of the raw message) is remembered only after a
 * successful SMTP hand-off, and concurrent duplicates share one delivery.
 */
export class IdempotencyCache<T> {
  private readonly done = new Map<string, T>()
  private readonly inflight = new Map<string, Promise<T>>()

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('IdempotencyCache capacity must be a positive integer')
  }

  has(key: string): boolean {
    return this.done.has(key) || this.inflight.has(key)
  }

  get size(): number {
    return this.done.size
  }

  /**
   * Run `fn` at most once per key. A hit returns the cached value with
   * `duplicate: true`; a concurrent call awaits the in-flight result.
   * Rejections are not cached, so a transient SMTP failure can be retried.
   */
  async once(key: string, fn: () => Promise<T>): Promise<{ value: T; duplicate: boolean }> {
    const cached = this.done.get(key)
    if (cached !== undefined) {
      this.store(key, cached)
      return { value: cached, duplicate: true }
    }
    const running = this.inflight.get(key)
    if (running) return { value: await running, duplicate: true }

    const promise = fn()
      .then((value) => {
        this.store(key, value)
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, promise)
    return { value: await promise, duplicate: false }
  }

  private store(key: string, value: T): void {
    this.done.delete(key)
    this.done.set(key, value)
    while (this.done.size > this.capacity) {
      const oldest = this.done.keys().next().value
      if (oldest === undefined) break
      this.done.delete(oldest)
    }
  }
}