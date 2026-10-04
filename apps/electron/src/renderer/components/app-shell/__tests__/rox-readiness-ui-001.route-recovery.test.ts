import { describe, expect, it, beforeAll } from 'bun:test'
import * as React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildMainFixture } from './rox-readiness-ui-001.component-harness'

let Fixture: React.ComponentType<Record<string, unknown>>
beforeAll(async () => {
  const directory = mkdtempSync(join(import.meta.dir, '../../../../../../../node_modules/rox-readiness-ui-001-temp-'))
  try { Fixture = (await import(await buildMainFixture(directory))).Fixture }
  finally { rmSync(directory, { recursive: true, force: true }) }
}, 30_000)
async function rendered(props: Record<string, unknown>) {
  return new Promise<string>((resolve, reject) => {
    const sink = new PassThrough()
    let html = ''
    sink.on('data', chunk => { html += chunk.toString() })
    sink.on('end', () => { resolve(html) })
    const { pipe } = renderToPipeableStream(React.createElement(Fixture, props), {
      onAllReady: () => { pipe(sink) }, onError: reject,
    })
  })
}

describe('ROX UI-001 actual MainContentPanel dispatch', () => {
  const cases = [
    ['allSessions/session/session-one', 'ChatPage', 'sessionId', 'session-one'],
    ['sources/source/source-one', 'SourceInfoPage', 'sourceSlug', 'source-one'],
    ['skills/skill/skill-one', 'SkillInfoPage', 'skillSlug', 'skill-one'],
    ['projects/project/project-one', 'ProjectInfoPage', 'projectSlug', 'project-one'],
    ['notes/note/note-one', 'NotesPage', 'selectedNoteId', 'note-one'],
    ['pages/page/page-one', 'PageView', 'pageSlug', 'page-one'],
    ['knowledge/document/knowledge-one', 'KnowledgeEntityPage', 'id', 'knowledge-one'],
    ['extension/extension-one/view-one', 'ExtensionSurfacePage', 'extensionId', 'extension-one'],
    ['terminal/terminal-one', 'TerminalSurfacePage', 'terminalId', 'terminal-one'],
    ['cloud-run/run-one', 'CloudRunSurfacePage', 'runId', 'run-one'],
    ...['dossier', 'radar', 'decisions', 'agents', 'focus'].map(screen => [`${screen}/item/item-one`, 'ExtraScreenHost', 'screen', screen]),
  ]
  for (const [route, host, prop, value] of cases) {
    it(`dispatches ${route} with its own selected entity`, async () => {
      const html = await rendered({ route, workspace: 'workspace-a' })
      if (host === 'ChatPage') {
        // This fixture has no session metadata. Preserve the requested ID
        // without starting a chat load whose workspace cannot be verified.
        expect(html).toContain('data-testid="route-session-missing"')
        expect(html).toContain(`data-route-entity="${value}"`)
        expect(html).not.toContain('data-route-host="ChatPage"')
        return
      }
      if (host === 'SourceInfoPage' || host === 'SkillInfoPage') {
        // SSR cannot run the canonical lookup effect. The selected identity
        // stays explicit while the real browser fixture exercises ready pages.
        expect(html).toContain('data-testid="route-resource-loading"')
        expect(html).toContain(`data-route-entity="${value}"`)
        expect(html).not.toContain('data-route-host="ChatPage"')
        return
      }
      expect(html).toContain(`data-route-host="${host}"`)
      expect(html).toContain(`&quot;${prop}&quot;:&quot;${value}&quot;`)
      expect(html).not.toContain('session.selectConversation')
      if (host === 'SourceInfoPage' || host === 'SkillInfoPage') expect(html).toContain('&quot;workspaceId&quot;:&quot;workspace-a&quot;')
    })
  }
  it('renders an explicit unavailable state for an unsupported navigation state', async () => {
    const html = await rendered({ override: { navigator: 'unsupported-surface' } })
    expect(html).toContain('data-testid="route-unavailable"')
    expect(html).toContain('common.unavailable')
    expect(html).not.toContain('data-route-host="ChatPage"')
  })

  for (const [workspaceId, remoteWorkspaceId] of [
    ['workspace-a', undefined],
    ['remote-workspace-a', 'remote-workspace-a'],
  ] as const) {
    it(`mounts the selected session only with ready matching ${remoteWorkspaceId ? 'remote' : 'local'} metadata`, async () => {
      const html = await rendered({
        route: 'allSessions/session/session-one', workspace: 'workspace-a', remoteWorkspaceId,
        sessions: [{ id: 'session-one', workspaceId }], sessionsReady: true,
      })
      expect(html).toContain('data-route-host="ChatPage"')
      expect(html).toContain('&quot;sessionId&quot;:&quot;session-one&quot;')
      expect(html).not.toContain('route-session-missing')
      expect(html).not.toContain('route-unavailable')
    })
  }

  it('keeps a selected session loading until metadata readiness even if a previous snapshot contains it', async () => {
    const html = await rendered({
      route: 'allSessions/session/session-one', workspace: 'workspace-a',
      sessions: [{ id: 'session-one', workspaceId: 'workspace-a' }], sessionsReady: false,
    })
    expect(html).toContain('data-testid="route-session-loading"')
    expect(html).toContain('data-route-entity="session-one"')
    expect(html).not.toContain('data-route-host="ChatPage"')
    expect(html).not.toContain('chat.sessionNoLongerExists')
  })

  it('rejects known foreign-workspace metadata before mounting ChatPage', async () => {
    const html = await rendered({
      route: 'allSessions/session/session-one', workspace: 'workspace-a',
      sessions: [{ id: 'session-one', workspaceId: 'workspace-b' }], sessionsReady: true,
    })
    expect(html).toContain('data-testid="route-unavailable"')
    expect(html).not.toContain('data-route-host="ChatPage"')
    expect(html).not.toContain('session.selectConversation')
  })
})
