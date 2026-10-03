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
})
