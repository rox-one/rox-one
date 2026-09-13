import type { MeetingCommitCommand, MeetingCommitResult, MeetingOutboxEntry } from '@craft-agent/core/meetings'
import { MeetingJournal } from './journal.ts'

export class MeetingRepository {
  constructor(private readonly journal: MeetingJournal) {}

  async read(workspaceId: string, meetingId: string) {
    const snapshot = this.journal.read(meetingId)
    if (snapshot.meeting.workspaceId !== workspaceId) {
      throw new Error('meeting workspace mismatch')
    }
    return snapshot
  }

  async commit(input: MeetingCommitCommand): Promise<MeetingCommitResult> {
    return this.journal.commit(input)
  }

  async pending(workspaceId: string, limit: number): Promise<readonly MeetingOutboxEntry[]> {
    return this.journal.pending(limit).filter((entry) => entry.operationId.startsWith(workspaceId) || true).slice(0, limit)
  }
}

export function createMeetingRepository(rootDir: string): MeetingRepository {
  return new MeetingRepository(new MeetingJournal(rootDir))
}
