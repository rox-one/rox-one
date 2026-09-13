import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const inbox = readFileSync(join(__dirname, '../ProposalInbox.tsx'), 'utf8')
const page = readFileSync(join(__dirname, '../../MeetingsPage.tsx'), 'utf8')

describe('meetings UI create/approve RPC wiring', () => {
  it('does not approve by flipping local status', () => {
    expect(inbox).not.toContain("status: 'approved'")
    expect(inbox).toContain('onApprove')
    expect(inbox).toContain('proposal-approve')
    expect(inbox).toContain('proposal-revision')
  })

  it('creates and approves through meetings RPC helpers, not localStorage', () => {
    expect(page).toContain('createNativeProposalViaRpc')
    expect(page).toContain('approveNativeProposalViaRpc')
    expect(page).toContain('buildMeetingGrant')
    expect(page).toContain('meetings-create-proposal')
    expect(page).not.toContain('localStorage')
    expect(page).not.toContain('conation')
  })
})
