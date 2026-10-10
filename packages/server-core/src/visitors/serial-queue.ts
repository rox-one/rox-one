/**
 * Serialized async queue (port-matrix row a1.6).
 *
 * Every mutation that reaches the visitor grant store is funnelled through one
 * of these so two concurrent invite/revoke calls can never interleave their
 * read-modify-write steps: an operation starts only after the previous one has
 * settled, whatever its outcome. A failed operation never wedges the queue.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  /**
   * Run `operation` after every previously enqueued operation has settled.
   * Rejections are propagated to the caller and do not stall the queue.
   */
  enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(operation)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Resolve once every operation enqueued so far has settled. */
  async drain(): Promise<void> {
    await this.tail
  }
}