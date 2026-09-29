import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const inbox = readFileSync(join(__dirname, '../ProposalInbox.tsx'), 'utf8')
const page = readFileSync(join(__dirname, '../../MeetingsPage.tsx'), 'utf8')

describe('meetings UI create/approve/reject RPC wiring', () => {
  it('does not approve or reject by flipping local status', () => {
    expect(inbox).not.toContain("status: 'approved'")
    expect(inbox).not.toContain("status: 'rejected'")
    expect(inbox).toContain('onApprove')
    expect(inbox).toContain('onReject')
    expect(inbox).toContain('proposal-approve')
    expect(inbox).toContain('proposal-reject')
    expect(inbox).toContain('onOpenTarget')
    expect(inbox).toContain('proposal-target-link')
    expect(inbox).toContain('disabled={!proposal.revisionId || !props.onOpenTarget}')
  })

  it('Встречи persists through the local meetings IPC (files on disk), not localStorage', () => {
    expect(page).toContain('api.list(workspaceId)')
    expect(page).toContain('api.importAudio(')
    expect(page).toContain('startRecording(')
    expect(page).not.toContain('crypto.randomUUID')
    expect(page).not.toContain('localStorage')
    expect(page).not.toContain('conation')
  })
})
