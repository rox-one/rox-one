import { describe, expect, it } from 'bun:test'
import { formatOrgMemberIdentity } from '../organization-member-identity'

const labels = { userId: 'User ID', username: 'Username', email: 'Email' }

describe('formatOrgMemberIdentity', () => {
  it('shows userId, username, and email together', () => {
    const formatted = formatOrgMemberIdentity(
      { userId: 'user_abc', username: 'ada', email: 'ada@example.com' },
      labels,
      '—',
    )
    expect(formatted.userId).toBe('user_abc')
    expect(formatted.username).toBe('ada')
    expect(formatted.email).toBe('ada@example.com')
    expect(formatted.summary).toBe('User ID: user_abc · Username: ada · Email: ada@example.com')
  })

  it('uses the empty marker when username or email is missing', () => {
    const formatted = formatOrgMemberIdentity({ userId: 'user_local' }, labels, '—')
    expect(formatted.summary).toBe('User ID: user_local · Username: — · Email: —')
  })
})
