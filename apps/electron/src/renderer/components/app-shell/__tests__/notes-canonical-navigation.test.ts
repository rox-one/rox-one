import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routes } from '../../../../shared/routes'
import { invokeShellNavigationCallback } from './rox-readiness-ui-001.shell-callback'

const appShellPath = join(__dirname, '../AppShell.tsx')
const chatPageSource = readFileSync(join(__dirname, '../../../pages/ChatPage.tsx'), 'utf8')

describe('Notes shell navigation', () => {
  it('opens the workspace-local Notes surface instead of a knowledge provider', () => {
    expect(invokeShellNavigationCallback(appShellPath, { name: 'handleNotesClick' }))
      .toEqual([routes.view.notes()])
  })

  it('resolves imported chat notes to local Notes, not SiYuan', () => {
    expect(chatPageSource).toContain('lookupImportedNote')
    expect(chatPageSource).toContain('routes.view.notes(migrated.destinationNoteId)')
    expect(chatPageSource).not.toContain('lookupMigratedSiyuanId')
    expect(chatPageSource).not.toContain('notesLegacy')
    expect(chatPageSource).not.toContain('migrated?.siyuanId')
  })
})
