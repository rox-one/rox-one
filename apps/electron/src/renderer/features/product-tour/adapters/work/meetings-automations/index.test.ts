import { describe, expect, it } from 'bun:test'
import type { LocalMeeting } from '../../../../../../shared/meetings-local'
import type { TourBinding, TourScope } from '../../../contracts'
import { deriveMeetingsAutomationSignals, meetingsAutomationCapabilities } from './index'

const scope: TourScope = { workspaceId: 'ws-a', panelId: 'panel-a', entityId: 'meeting-a' }
const binding: TourBinding = { ...scope, clientProfileId: 'profile', runToken: 'run-a' }
const meeting = {
  id: 'meeting-a', workspaceId: 'ws-a', updatedAt: 10, summary: null, audio: null,
  transcript: { status: 'none', progress: 0 }, actions: [], documents: [], extractedDecisions: [],
} as unknown as LocalMeeting
const withArtifact = { ...meeting, summary: { text: 'Private native summary', generated: false, updatedAt: 10 } }
const operation = { binding, operationToken: 'op-a', at: 100 }
const opened = {
  scope, observation: operation, selectedId: meeting.id, meeting: withArtifact,
  expectedMeetingId: meeting.id, expectedUpdatedAt: 10, artifactRendered: true,
  at: 110, eventToken: 'native-open-a',
}

describe('A11 native Meetings and Automation learning', () => {
  it('T-MEETINGS-RESULT only observes a real current artifact', () => {
    expect(deriveMeetingsAutomationSignals(opened)).toEqual([{
      name: 'meeting.artifact-opened', binding, operationToken: 'op-a', operationStartedAt: 100,
      level: 'observed', origin: 'ui-observation', at: 110, eventToken: 'native-open-a',
    }])
    expect(deriveMeetingsAutomationSignals({ ...opened, meeting })).toEqual([])
    expect(deriveMeetingsAutomationSignals({ ...opened, artifactRendered: false })).toEqual([])
    expect(deriveMeetingsAutomationSignals({ ...opened, observation: null })).toEqual([])
  })

  it('T-MEETINGS-RESULT rejects foreign scopes, stale versions and selection changes', () => {
    for (const foreign of [
      { ...scope, workspaceId: 'ws-b' }, { ...scope, panelId: 'panel-b' },
      { ...scope, entityId: 'meeting-b' }, { ...scope, sessionId: 'session-b' },
    ]) expect(deriveMeetingsAutomationSignals({ ...opened, scope: foreign })).toEqual([])
    expect(deriveMeetingsAutomationSignals({ ...opened, selectedId: 'meeting-b' })).toEqual([])
    expect(deriveMeetingsAutomationSignals({ ...opened, meeting: { ...withArtifact, workspaceId: 'ws-b' } })).toEqual([])
    expect(deriveMeetingsAutomationSignals({ ...opened, meeting: { ...withArtifact, updatedAt: 11 } })).toEqual([])
    expect(deriveMeetingsAutomationSignals({ ...opened, at: 99 })).toEqual([])
  })

  it('a late completion preserves its original run identity and never upgrades acknowledgement', () => {
    const [signal] = deriveMeetingsAutomationSignals(opened)
    expect(signal?.binding.runToken).toBe('run-a')
    expect(signal?.level).toBe('observed')
    expect(Object.keys(signal ?? {})).not.toContain('text')
    expect(JSON.stringify(signal)).not.toContain('Private native summary')
  })

  it('T-MEETINGS-LIST and DOMAIN-18 report missing/unavailable artifacts honestly', () => {
    const available = { surface: 'meetings' as const, apiAvailable: true, loadState: 'ready' as const,
      workspaceId: 'ws-a', selectedId: meeting.id, meeting }
    expect(meetingsAutomationCapabilities(available)).toEqual({
      'meetings.available': { state: 'ready' },
      'meeting.artifact-present': { state: 'pending', reason: 'missing-entity' },
    })
    expect(meetingsAutomationCapabilities({ ...available, apiAvailable: false })['meetings.available'])
      .toEqual({ state: 'unavailable', reason: 'api-unavailable' })
    expect(meetingsAutomationCapabilities({ ...available, loadState: 'loading' })['meetings.available'])
      .toEqual({ state: 'pending', reason: 'installing' })
    expect(meetingsAutomationCapabilities({ ...available, meeting: withArtifact })['meeting.artifact-present'])
      .toEqual({ state: 'ready' })
    expect(meetingsAutomationCapabilities({ ...available, meeting: withArtifact, selectedId: 'foreign' })['meeting.artifact-present'])
      .toEqual({ state: 'pending', reason: 'missing-entity' })
  })

  it('T-AUTOMATION-TRIGGER/ACTION/CONTROL require the actual selected entity', () => {
    const actual = { surface: 'automation' as const, apiAvailable: true, workspaceId: 'ws-a',
      selectedId: 'automation-a', automation: { id: 'automation-a', revision: 'native-revision' } }
    expect(meetingsAutomationCapabilities(actual)).toEqual({
      'automations.available': { state: 'ready' }, 'automation.entity-present': { state: 'ready' },
    })
    expect(meetingsAutomationCapabilities({ ...actual, automation: undefined })['automation.entity-present'])
      .toEqual({ state: 'pending', reason: 'missing-entity' })
    expect(meetingsAutomationCapabilities({ ...actual, selectedId: 'foreign' })['automation.entity-present'])
      .toEqual({ state: 'pending', reason: 'missing-entity' })
    expect(meetingsAutomationCapabilities({ ...actual, workspaceId: null })['automations.available'])
      .toEqual({ state: 'unavailable', reason: 'api-unavailable' })
  })
})
