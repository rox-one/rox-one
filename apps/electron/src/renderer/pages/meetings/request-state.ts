/** UI request ownership recovered from Golden Gate; committed scopes own results. */
export class MeetingRequestTracker {
  private scope: string | null | undefined
  private generation = 0
  private active = new Map<string, symbol>()

  setScope(scope: string | null | undefined): void {
    if (this.scope === scope) return
    this.scope = scope
    this.cancelAll()
  }

  hasScope(scope: string | null): boolean {
    return this.scope !== undefined && this.scope === scope
  }

  isPending(key: string): boolean { return this.active.has(key) }
  cancelAll(): void { this.generation += 1; this.active.clear() }
  cancel(key: string): void { this.active.delete(key) }

  beginLatest(key: string, scope: string | null) {
    if (!this.hasScope(scope)) return null
    this.cancel(key)
    return this.begin(key, scope)
  }

  begin(key: string, scope = this.scope) {
    if (scope === undefined || scope !== this.scope || this.active.has(key)) return null
    const generation = this.generation
    const token = Symbol(key)
    this.active.set(key, token)
    const isCurrent = () => this.generation === generation && this.active.get(key) === token
    return {
      isCurrent,
      finish: () => {
        if (!isCurrent()) return false
        this.active.delete(key)
        return true
      },
    }
  }
}
