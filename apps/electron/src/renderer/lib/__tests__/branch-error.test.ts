import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { branchErrorDescription } from '../branch-error'

const copy = {
  fallback: 'Failed to create branch',
  sameProvider: 'same-provider-copy',
}

const chatPage = readFileSync(join(import.meta.dir, '../../pages/ChatPage.tsx'), 'utf8')
const chatDisplay = readFileSync(
  join(import.meta.dir, '../../components/app-shell/ChatDisplay.tsx'),
  'utf8',
)

describe('branchErrorDescription', () => {
  it('uses fallback when the error is empty or leaks OMP/Craft', () => {
    expect(branchErrorDescription(undefined, copy)).toBe(copy.fallback)
    expect(branchErrorDescription(new Error('   '), copy)).toBe(copy.fallback)
    expect(branchErrorDescription(new Error('Failed to create OMP connection'), copy)).toBe(
      copy.fallback,
    )
  })

  it('maps same-provider backend errors to the dedicated copy', () => {
    expect(
      branchErrorDescription(new Error('source and target providers must match'), copy),
    ).toBe(copy.sameProvider)
    expect(
      branchErrorDescription(
        new Error(
          'Branching is only supported within the same provider/backend. Switch this panel connection and try again.',
        ),
        copy,
      ),
    ).toBe(copy.sameProvider)
  })

  it('keeps non-leaking backend messages', () => {
    expect(branchErrorDescription(new Error('timeout after 5s'), copy)).toBe('timeout after 5s')
  })
})

describe('session branch copy is i18n', () => {
  it('uses toast and chat keys instead of hardcoded English', () => {
    for (const source of [chatPage, chatDisplay]) {
      expect(source).toContain("t('toast.couldNotCreateBranch')")
      expect(source).toContain("t('toast.createBranchFailed')")
      expect(source).toContain("t('toast.branchSameProvider')")
      expect(source).toContain("t('chat.branchOf'")
      expect(source).not.toContain("'Failed to create branch'")
      expect(source).not.toContain('`Branch of ${')
      expect(source).not.toContain("'Unknown error'")
    }
    expect(chatDisplay).toContain("t('toast.unknownError')")
    expect(chatDisplay).not.toContain('Branching is only supported within the same provider/backend')
  })
})
