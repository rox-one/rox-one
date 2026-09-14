import { test, expect } from '@playwright/test'
import { bootMeetingApp, evidenceRow, writeEvidence } from './harness.ts'
import { createPlaywrightElectronFactory, isElectronAppBuilt } from './electron-factory.ts'
import { setMeetingElectronFactory } from './harness.ts'
import {
  addLinkedNote,
  emptyMeetingShare,
  revokeMember,
} from '../../../packages/server-core/src/meetings/sharing.ts'
import { exportMeeting, importMeeting } from '../../../packages/server-core/src/meetings/exports.ts'
import { deleteMeetingWithRetention } from '../../../packages/server-core/src/meetings/retention.ts'

test('E32 private+shared note, revoke, export/import, delete cascade', async () => {
  const owner = { accountId: 'acct-1', workspaceId: 'ws-a' }
  const member = { accountId: 'acct-2', workspaceId: 'ws-a' }
  let record = emptyMeetingShare({
    meetingId: 'm1',
    workspaceId: 'ws-a',
    title: 'Standup',
    ownerId: 'acct-1',
  })
  record = {
    ...record,
    members: [...record.members, { accountId: 'acct-2', role: 'member' }],
    transcript: 'roadmap',
    externalCopies: [{ id: 'mail-1', provider: 'mail', status: 'sent' }],
  }
  record = addLinkedNote(record, {
    id: 'private',
    ownerId: 'acct-1',
    audience: 'private',
    text: 'salary-band',
    revision: 1,
  })
  record = addLinkedNote(record, {
    id: 'shared',
    ownerId: 'acct-1',
    audience: 'shared',
    text: 'roadmap Friday',
    revision: 1,
  })
  const shared = exportMeeting(record, owner, { format: 'json', audience: 'shared' })
  expect(shared.ok).toBe(true)
  if (!shared.ok) return
  expect(shared.bundle.notes.some((note) => note.audience === 'private')).toBe(false)
  const imported = importMeeting(shared.bundle, owner)
  expect(imported.ok).toBe(true)
  const revoked = revokeMember(record, owner, 'acct-2', 4)
  if ('ok' in revoked) throw new Error('expected record')
  expect(exportMeeting(revoked, member, { format: 'json', now: 4 }).ok).toBe(false)
  const deleted = deleteMeetingWithRetention({
    record,
    meetings: [{ id: 'm1', workspaceId: 'ws-a', title: 'Standup', updatedAt: 1 }],
    actor: { workspaceId: 'ws-a', allowed: true },
  })
  expect(deleted.cascade.externalCopies[0]?.status).toBe('external-retained')
  expect(deleted.record.deleted).toBe(true)

  if (!isElectronAppBuilt()) {
    writeEvidence(evidenceRow('E3', 'not_run', {
      caseId: 'E32',
      command: 'bun run test:meetings:e2e',
      blocker: 'apps/electron dist/main.cjs or renderer is not built',
    }))
    throw new Error('E32 E3 is not_run until Electron renderer+main are built')
  }
  setMeetingElectronFactory(createPlaywrightElectronFactory())
  const h = await bootMeetingApp({ caseId: 'e32-export' })
  try {
    expect((await h.gateway.counts()).forbiddenCalls).toBe(0)
    writeEvidence(evidenceRow('E3', 'passed', { caseId: 'E32' }))
  } finally {
    await h.dispose()
    setMeetingElectronFactory(null)
  }
})
