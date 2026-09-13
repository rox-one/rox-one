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
    expect(inbox).toContain('disabled={!proposal.revisionId}')
  })

  it('creates, approves, and rejects through meetings RPC helpers, not localStorage', () => {
    expect(page).toContain('createNativeProposalViaRpc')
    expect(page).toContain('approveNativeProposalViaRpc')
    expect(page).toContain('rejectNativeProposalViaRpc')
    expect(page).toContain('openNativeProposalTargetViaRpc')
    expect(page).toContain('navigate(result.route)')
    expect(page).toContain('startNativeMeetingViaRpc')
    expect(page).toContain('searchNativeMeetingsViaRpc')
    expect(page).toContain('meetings.nativeCatalog')
    expect(page).toContain('meetings.searchIntent')
    expect(page).not.toContain('crypto.randomUUID')
    expect(page).not.toContain('localStorage')
    expect(page).not.toContain('conation')
  })
})
