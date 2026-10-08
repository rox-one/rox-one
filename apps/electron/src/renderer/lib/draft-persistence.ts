import type { SessionDraft } from '@rox/shared/config'
/** Serialize writes per session; immutable snapshots survive workspace changes. */
export class DraftPersistence {
  private readonly pending = new Map<string, Promise<void>>()
  private readonly failed = new Map<string, SessionDraft>()
  constructor(private readonly write: (id: string, draft: SessionDraft) => Promise<unknown>) {}
  save(id: string, draft: SessionDraft): Promise<void> {
    const snapshot = structuredClone(draft)
    this.failed.delete(id)
    const previous = this.pending.get(id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(async () => { await this.write(id, snapshot) })
    this.pending.set(id, next)
    void next.then(() => { if (this.pending.get(id) === next) this.pending.delete(id) }, () => {
      if (this.pending.get(id) === next) this.failed.set(id, snapshot)
    })
    return next
  }
  async flush(): Promise<void> {
    // Retrying a workspace switch also retries the latest unsaved snapshots.
    for (const [id, draft] of [...this.failed]) void this.save(id, draft).catch(() => {})
    await Promise.all([...this.pending.values()])
  }
}
