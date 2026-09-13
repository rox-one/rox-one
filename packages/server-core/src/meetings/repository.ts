import {
  meetingBindingKey,
  parseMeeting,
  parseMeetingCommand,
  type Meeting,
  type MeetingCommand,
} from '@craft-agent/core/meetings'
import { MeetingJournal, MeetingRevisionConflict, type MeetingJournalSnapshot } from './journal.ts'

export class MeetingRepository {
  private readonly byId = new Map<string, Meeting>()
  private readonly byBinding = new Map<string, string>()

  constructor(private readonly journal: MeetingJournal) {}

  async load(): Promise<MeetingJournalSnapshot> {
    const snapshot = await this.journal.load()
    this.byId.clear()
    this.byBinding.clear()
    for (const event of snapshot.events) {
      if (event.type !== 'create-meeting') continue
      try {
        const meeting = parseMeeting(event.payload.meeting)
        this.index(meeting)
      } catch {
        /* invalid historical payload stays in the journal, not the live index */
      }
    }
    return snapshot
  }

  list(): Meeting[] {
    return [...this.byId.values()].map((meeting) => structuredClone(meeting))
  }

  get(entityId: string): Meeting | undefined {
    const found = this.byId.get(entityId)
    return found ? structuredClone(found) : undefined
  }

  async apply(command: MeetingCommand): Promise<{ snapshot: MeetingJournalSnapshot; meeting?: Meeting; duplicate: boolean }> {
    const parsed = parseMeetingCommand(command)
    await this.load()
    const before = this.journal.state()
    if (before.commandIds.includes(parsed.commandId)) {
      return { snapshot: before, duplicate: true, meeting: this.meetingFromCommand(parsed) }
    }
    if (parsed.type === 'create-meeting') {
      const meeting = parseMeeting(parsed.payload.meeting)
      if (meeting.ref.workspaceId !== parsed.workspaceId) {
        throw new Error('Meeting workspace does not match command')
      }
      if (meeting.callBinding) {
        const existing = this.byBinding.get(meetingBindingKey(meeting.callBinding))
        if (existing) {
          return { snapshot: before, duplicate: true, meeting: this.byId.get(existing) }
        }
      }
      const snapshot = await this.journal.append(parsed, { meeting }, meeting.ref.entityId)
      this.index(meeting)
      return { snapshot, meeting, duplicate: false }
    }
    const snapshot = await this.journal.append(parsed, parsed.payload, parsed.commandId)
    return { snapshot, duplicate: false }
  }

  private meetingFromCommand(command: MeetingCommand): Meeting | undefined {
    try {
      return parseMeeting(command.payload.meeting)
    } catch {
      return undefined
    }
  }

  private index(meeting: Meeting): void {
    this.byId.set(meeting.ref.entityId, meeting)
    if (meeting.callBinding) {
      this.byBinding.set(meetingBindingKey(meeting.callBinding), meeting.ref.entityId)
    }
  }
}

export { MeetingRevisionConflict }
