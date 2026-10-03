import './__test-config-isolation'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addWorkspace } from '@rox/shared/config'
import { loadSession } from '@rox/shared/sessions'
import { setupI18n } from '@rox/shared/i18n'
import { SessionManager } from './SessionManager'

describe('first-session welcome real transcript', () => {
  it('persists a localized assistant question without creating a user message or starting a model', async () => {
    setupI18n()
    const workspace = addWorkspace({ name: 'Welcome test', rootPath: mkdtempSync(join(tmpdir(), 'welcome-workspace-')) })
    const manager = new SessionManager()
    // The test exercises real session creation/storage after the initialization boundary.
    manager.waitForInit = async () => {}
    const session = await manager.ensureFirstSessionWelcome(workspace.id)
    expect(session).not.toBeNull()
    expect(session!.messages).toHaveLength(1)
    expect(session!.messages[0]!.role).toBe('assistant')
    expect(session!.messages[0]!.content).toContain('Как к вам обращаться?')
    expect(session!.isProcessing).toBe(false)
    const stored = loadSession(workspace.rootPath, session!.id)
    expect(stored!.messages).toHaveLength(1)
    expect(stored!.messages[0]!.content).toBe(session!.messages[0]!.content)
    expect(await manager.ensureFirstSessionWelcome(workspace.id)).toBeNull()
    manager.cleanup()
  })
})
