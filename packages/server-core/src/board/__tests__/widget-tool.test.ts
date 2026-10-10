import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionSafeAllowedToolNames, getSessionSafeBlockedToolNames, handleShowWidget, type SessionToolContext } from '../../../../session-tools-core/src/index.ts'
import { shouldAllowToolInMode } from '@rox/shared/agent'
import { WIDGET_BRIDGE_GLOBAL } from '@rox/shared/widgets/wrap'
import { buildBoardWidgetToolCallbacks } from '../tool-callbacks.ts'
import { WidgetStore } from '../widget-store.ts'
import { widgetTicketRegistryFor } from '../widget-tickets.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'widget-tool-')); dirs.push(root)
  const ctx = {
    sessionId: 'session-1',
    workspacePath: root,
    boardWidgets: buildBoardWidgetToolCallbacks({
      workspaceId: 'workspace-a',
      workspaceRootPath: root,
      createdBy: 'owner-1',
      sessionId: 'session-1',
    }),
  } as unknown as SessionToolContext
  return { root, ctx }
}

test('show_widget routes through the same store the board RPC writes', async () => {
  const f = fixture()
  const result = await handleShowWidget(f.ctx, { title: 'Chart', widget_code: '<p id="widget-marker">hi</p>', name: 'chart' })
  expect(result.isError).toBeFalsy()
  const record = JSON.parse(result.content[0].text)
  expect(record).toMatchObject({ widgetId: 'chart', name: 'chart', kind: 'html', revision: 1 })

  // The bytes the tool staged are exactly what a board mount reads from the store.
  const document = new WidgetStore(f.root, 'workspace-a').readDocument('chart')
  expect(document.indexOf(WIDGET_BRIDGE_GLOBAL)).toBeGreaterThanOrEqual(0)
  expect(document.indexOf('widget-marker')).toBeGreaterThan(document.indexOf(WIDGET_BRIDGE_GLOBAL))
  expect(readFileSync(join(f.root, 'board', 'widgets', 'chart', 'index.html'), 'utf8')).toBe(document)

  // The same shared registry the RPC handlers use saw the put.
  expect(widgetTicketRegistryFor(f.root).generationOf('chart')).toBe(1)
})

test('show_widget reports the typed kind refusal for a2ui and stores nothing', async () => {
  const f = fixture()
  const result = await handleShowWidget(f.ctx, {
    title: 'A2UI',
    kind: 'a2ui',
    name: 'a2ui-widget',
    widget_code: '{"version":"0.9","createSurface":{"surfaceId":"s","catalogId":"c"}}',
  })
  expect(result.isError).toBe(true)
  expect(result.content[0].text).toContain('UNSUPPORTED_WIDGET_KIND')
})

test('show_widget is blocked in the restrictive (Explore/Safe) mode', () => {
  expect(getSessionSafeBlockedToolNames().has('show_widget')).toBe(true)
  expect(getSessionSafeAllowedToolNames().has('show_widget')).toBe(false)
  expect(getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' }).has('mcp__session__show_widget')).toBe(false)
  const verdict = shouldAllowToolInMode('mcp__session__show_widget', {}, 'safe')
  expect(verdict.allowed).toBe(false)
})