import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '../..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

describe('unknown-error toast fallbacks are i18n', () => {
  it('workspace create uses toast.unknownError', () => {
    const source = read('components/workspace/WorkspaceCreationScreen.tsx')
    expect(source).toContain("t('toast.unknownError')")
    expect(source).not.toContain("'Unknown error'")
  })

  it('send-to-workspace uses toast.unknownError', () => {
    const source = read('components/app-shell/SendToWorkspaceDialog.tsx')
    expect(source).toContain("t('toast.unknownError')")
    expect(source).not.toContain("'Unknown error'")
  })

  it('workspace settings save uses toast.unknownError', () => {
    const source = read('pages/settings/WorkspaceSettingsPage.tsx')
    expect(source).toContain('t("toast.unknownError")')
    expect(source).not.toContain("'Unknown error'")
  })

  it('AI settings save uses toast.unknownError', () => {
    const source = read('pages/settings/AiSettingsPage.tsx')
    expect(source).toContain('t("toast.unknownError")')
    expect(source).not.toContain("'Unknown error'")
  })

  it('update checker uses toast.unknownError', () => {
    const source = read('hooks/useUpdateChecker.ts')
    expect(source).toContain("t('toast.unknownError')")
    expect(source).not.toContain("'Unknown error'")
  })

  it('session-load formats unknown errors through i18n', () => {
    const source = read('lib/session-load.ts')
    expect(source).toContain("i18n.t('toast.unknownError')")
    expect(source).not.toContain("'Unknown error'")
  })

  it('App toast fallbacks use toast.unknownError; send-message card stays a later slice', () => {
    const source = read('App.tsx')
    expect(source).toContain("t('toast.unknownError')")
    expect(source.match(/t\('toast\.unknownError'\)/g)?.length).toBe(4)
    expect(source).toContain(
      "`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`",
    )
  })
})
