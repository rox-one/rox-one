export type MeetingPageState = 'ready' | 'empty' | 'denied' | 'offline' | 'incomplete' | 'deleted'

export type MeetingTrackerView = {
  id: string
  provider: 'github' | 'linear'
  remoteId: string
  htmlUrl: string
  title: string
  verified: boolean
  live: boolean
  fixture?: boolean
  unknown?: boolean
}

export type MeetingArtifactView = {
  id: string
  relativePath: string
  format: string
  mimeType: string
  size: number
  sha256: string
  verified: boolean
  failed?: boolean
  version: number
  url?: string
}

export type MeetingPageItem = {
  id: string
  title: string
  transcript?: string
  manualNotes?: string
  incomplete?: boolean
  artifacts?: readonly MeetingArtifactView[]
  trackers?: readonly MeetingTrackerView[]
}

export type MeetingKnowledgeField = {
  field: string
  before?: unknown
  after?: unknown
}

export type MeetingKnowledgeView = {
  proposedNotApplied: boolean
  conflict?: boolean
  supersededTitle?: string
  fields: readonly MeetingKnowledgeField[]
}

export type ListedMeeting = {
  id?: string
  meetingId?: string
  title: string
  transcript?: string
  manualNotes?: string
  incomplete?: boolean
}

export type MeetingListResult = {
  items?: readonly ListedMeeting[]
  page?: readonly ListedMeeting[]
  state?: MeetingPageState
  denied?: boolean
}

export function toMeetingPageItems(listed: MeetingListResult): MeetingPageItem[] {
  const rows = listed.items ?? listed.page ?? []
  return rows.map((meeting) => ({
    id: meeting.id ?? meeting.meetingId ?? '',
    title: meeting.title,
    transcript: meeting.transcript,
    manualNotes: meeting.manualNotes,
    incomplete: meeting.incomplete,
  }))
}

export function listStateFromResult(listed: MeetingListResult, itemCount: number): MeetingPageState {
  if (listed.state) return listed.state
  if (listed.denied) return 'denied'
  return itemCount === 0 ? 'empty' : 'ready'
}

