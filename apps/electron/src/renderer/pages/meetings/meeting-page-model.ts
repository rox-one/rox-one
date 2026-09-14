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
