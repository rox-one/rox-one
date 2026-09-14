/** Read results belong to their workspace and latest user intent, including A → B → A switches. */
export class NotesRequestTracker {
  private scope: string | null | undefined
  private active = new Map<string, symbol>()

  setScope(scope: string | null): void {
    if (this.scope === scope) return
    this.scope = scope
    this.cancelAll()
  }

  cancelAll(): void { this.active.clear() }
  cancel(key: string): void { this.active.delete(key) }

  begin(key: string, scope = this.scope) {
    if (scope !== this.scope) return { isCurrent: () => false }
    const token = Symbol(key)
    this.active.set(key, token)
    return { isCurrent: () => this.active.get(key) === token }
  }
}

/** A write acknowledgement cannot mark subsequently typed text as saved. */
export function noteSaveAcknowledgesCurrentDraft(
  saved: { workspaceId: string; noteId: string; content: string },
  current: { workspaceId: string | null; noteId: string | null; content: string },
): boolean {
  return saved.workspaceId === current.workspaceId && saved.noteId === current.noteId && saved.content === current.content
}
