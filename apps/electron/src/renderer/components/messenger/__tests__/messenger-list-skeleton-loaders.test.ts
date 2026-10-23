import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const messengerRoot = join(import.meta.dir, '..')
const screensRoot = join(import.meta.dir, '../../../screens/messenger')

function src(root: string, name: string) {
  return readFileSync(join(root, name), 'utf8')
}

describe('messenger list skeleton loaders (P3.2)', () => {
  it('MessengerListSkeleton uses SE Skeleton + aria-busy row placeholders', () => {
    const body = src(messengerRoot, 'MessengerListSkeleton.tsx')
    expect(body).toContain("from '@rox/ui'")
    expect(body).toContain('<Skeleton')
    expect(body).toContain('aria-busy="true"')
    expect(body).toContain('data-testid={testId}')
    expect(body).not.toMatch(/import\s*\{[^}]*\bSpinner\b/)
    expect(body).not.toMatch(/<Spinner\b/)
    expect(body).not.toMatch(/animate-spin/)
  })

  it('MessengerChannels shows skeleton for channel list, search, conversation, and thread load', () => {
    const body = src(messengerRoot, 'MessengerChannels.tsx')
    expect(body).toContain('MessengerListSkeleton')
    expect(body).toContain('channels.loading')
    expect(body).toContain('messenger-channel-list-loading')
    expect(body).toContain('messenger-conversation-loading')
    expect(body).toContain('messenger-search-loading')
    expect(body).toContain('messenger-thread-loading')
    expect(body).not.toMatch(/import\s*\{[^}]*\bSpinner\b/)
    expect(body).not.toMatch(/<Spinner\b/)
  })

  it('messenger screen sidebar uses skeleton content instead of kind loading spinner', () => {
    const body = src(screensRoot, 'useMessengerScreenSidebar.ts')
    expect(body).toContain('MessengerListSkeleton')
    expect(body).toContain('messenger-sidebar-loading')
    expect(body).toContain('createElement(MessengerListSkeleton')
    expect(body).not.toContain("state: { kind: 'loading' }")
  })

  it('keeps action busy flags on create/send (no list-load Spinner invent)', () => {
    const body = src(messengerRoot, 'MessengerChannels.tsx')
    expect(body).toMatch(/disabled=\{!\w+\.trim\(\) \|\| busy\}/)
    expect(body).toMatch(/disabled=\{\(!text\.trim\(\) && attachments\.length === 0\) \|\| busy\}/)
  })
})
