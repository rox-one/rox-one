import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const hooks = join(import.meta.dir, '..')
const inboxQueue = join(import.meta.dir, '../../pages/inbox/InboxQueue.tsx')

describe('WebUI desktop-only inbox sources (S8-07)', () => {
  it('does not treat missing knowledge/skills/sender APIs as load errors on web', () => {
    const source = readFileSync(join(hooks, 'useInboxItems.ts'), 'utf8')
    expect(source).toContain('isWebUI')
    expect(source).toContain('if (isWebUI) return []')
    expect(source).toContain("throw new Error('This source is unavailable in the current runtime')")
  })

  it('shows a desktop-only hint instead of a source-error toast on web', () => {
    const source = readFileSync(inboxQueue, 'utf8')
    expect(source).toContain("t('inbox.desktopOnlyHint')")
    expect(source).toContain('data-testid="inbox-desktop-only-hint"')
    expect(source).toContain('isWebUI')
  })
})
