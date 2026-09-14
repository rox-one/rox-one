/** UI request ownership: duplicate clicks coalesce; results from another workspace are ignored. */
export class MeetingRequestTracker {
  private scope: string | null | undefined
  private generation = 0
  private active = new Map<string, symbol>()

  setScope(scope: string | null): void {
    if (this.scope === scope) return
    this.scope = scope
    this.generation += 1
    this.active.clear()
  }

  isPending(key: string): boolean {
    return this.active.has(key)
  }

  cancelAll(): void {
    this.generation += 1
    this.active.clear()
  }

  cancel(key: string): void {
    this.active.delete(key)
  }

  begin(key: string) {
    if (this.active.has(key)) return null
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

export type MeetingDraft = {
  title: string
  kind: 'create_task' | 'create_note'
  noteText: string
  noteSeq: number
  segmentId: string
  replacement: string
}

export const EMPTY_MEETING_DRAFT: Readonly<MeetingDraft> = {
  title: '', kind: 'create_task', noteText: '', noteSeq: 0, segmentId: '', replacement: '',
}

/** A successful write must not erase text the user continued editing while it was pending. */
export function clearSubmittedDraftFields(
  current: MeetingDraft,
  submitted: Partial<Pick<MeetingDraft, 'title' | 'noteText' | 'segmentId' | 'replacement'>>,
): MeetingDraft {
  const next = { ...current }
  for (const key of Object.keys(submitted) as Array<keyof typeof submitted>) {
    if (current[key] === submitted[key]) next[key] = ''
  }
  return next
}

export function meetingStatusKey(status: string): string {
  return ['planned', 'permission_required', 'capturing', 'paused', 'finalizing', 'completed', 'failed', 'cancelled'].includes(status)
    ? `meetings.state.${status}` : 'common.unknown'
}
