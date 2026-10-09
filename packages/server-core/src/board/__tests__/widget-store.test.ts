import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodedError } from '@rox/shared/protocol'
import type { WidgetKind } from '@rox/shared/widgets/types'
import { WIDGET_BRIDGE_GLOBAL } from '@rox/shared/widgets/wrap'
import { MAX_WIDGET_SOURCE_BYTES, WidgetStore } from '../widget-store.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function codeOf(run: () => unknown): string {
  try { run() } catch (error) { if (error instanceof CodedError) return error.code; throw error }
  throw new Error('expected the call to throw a CodedError')
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'widget-store-')); dirs.push(root)
  return { root, store: new WidgetStore(root, 'workspace-a') }
}
function put(store: WidgetStore, overrides: Partial<Parameters<WidgetStore['put']>[0]> = {}) {
  return store.put({
    name: 'chart',
    title: 'Sales chart',
    kind: 'html',
    widgetCode: '<div id="widget-marker">hello</div>',
    createdBy: 'owner-1',
    ...overrides,
  })
}

test('html is wrapped before storage: bridge bytes precede the widget code, sha256 matches bytes', () => {
  const f = fixture()
  const record = put(f.store)
  expect(record).toMatchObject({ widgetId: 'chart', name: 'chart', kind: 'html', revision: 1, createdBy: 'owner-1' })
  const document = readFileSync(join(f.root, 'board', 'widgets', 'chart', 'index.html'), 'utf8')
  const bridgeAt = document.indexOf(WIDGET_BRIDGE_GLOBAL)
  const codeAt = document.indexOf('widget-marker')
  expect(bridgeAt).toBeGreaterThanOrEqual(0)
  expect(codeAt).toBeGreaterThan(bridgeAt)
  expect(record.sha256).toBe(createHash('sha256').update(readFileSync(join(f.root, 'board', 'widgets', 'chart', 'index.html'))).digest('hex'))
  expect(f.store.readDocument('chart')).toBe(document)
})

test('re-put of the same name is a NEW revision sharing the identity and createdAt', () => {
  const f = fixture()
  const first = put(f.store)
  const second = put(f.store, { widgetCode: '<div id="widget-marker">v2</div>' })
  expect(second).toMatchObject({ widgetId: 'chart', revision: 2, createdAt: first.createdAt })
  expect(f.store.read('chart')).toMatchObject({ revision: 2 })
  expect(f.store.readDocument('chart')).toContain('v2')
})

test('name traversal and separators are a typed payload error', () => {
  const f = fixture()
  expect(codeOf(() => put(f.store, { name: '../evil' }))).toBe('INVALID_PAYLOAD')
  expect(codeOf(() => put(f.store, { name: 'a/b' }))).toBe('INVALID_PAYLOAD')
  expect(codeOf(() => put(f.store, { name: '.hidden' }))).toBe('INVALID_PAYLOAD')
  expect(existsSync(join(f.root, 'board', 'widgets'))).toBe(false)
})

test('oversize source is refused before any write', () => {
  const f = fixture()
  expect(codeOf(() => put(f.store, { widgetCode: 'a'.repeat(MAX_WIDGET_SOURCE_BYTES + 1) }))).toBe('INVALID_PAYLOAD')
  expect(existsSync(join(f.root, 'board', 'widgets', 'chart'))).toBe(false)
})

test('a full HTML document (canvas-doc) is refused: the wrapper owns the shell', () => {
  const f = fixture()
  expect(codeOf(() => put(f.store, { widgetCode: '<!doctype html><html><body>x</body></html>' }))).toBe('INVALID_PAYLOAD')
  expect(codeOf(() => put(f.store, { widgetCode: '<html><body>x</body></html>' }))).toBe('INVALID_PAYLOAD')
  expect(existsSync(join(f.root, 'board', 'widgets', 'chart'))).toBe(false)
})

test('a2ui is validated and then refused with a typed kind error — nothing stored', () => {
  const f = fixture()
  const stream = '{"version":"0.9","createSurface":{"surfaceId":"s","catalogId":"c"}}'
  expect(codeOf(() => put(f.store, { kind: 'a2ui', widgetCode: stream }))).toBe('UNSUPPORTED_WIDGET_KIND')
  expect(codeOf(() => put(f.store, { kind: 'a2ui', widgetCode: '{not json}' }))).toBe('INVALID_PAYLOAD')
  expect(existsSync(join(f.root, 'board', 'widgets', 'chart'))).toBe(false)
})

test('an unsupported kind is a typed kind error', () => {
  const f = fixture()
  // Unchecked cast: the wire can carry any string; the store is the runtime boundary.
  expect(codeOf(() => put(f.store, { kind: 'canvas-doc' as unknown as WidgetKind }))).toBe('UNSUPPORTED_WIDGET_KIND')
})

test('a record whose bytes were swapped under it fails readback', () => {
  const f = fixture()
  put(f.store)
  writeFileSync(join(f.root, 'board', 'widgets', 'chart', 'index.html'), '<html>tampered</html>')
  expect(codeOf(() => f.store.readDocument('chart'))).toBe('DOCUMENT_RESULT_UNAVAILABLE')
})

test('a symlinked widget folder is denied', () => {
  const f = fixture()
  put(f.store)
  const folder = join(f.root, 'board', 'widgets', 'chart')
  rmSync(folder, { recursive: true, force: true })
  // Point the missing folder at a real directory elsewhere to simulate a link.
  const outside = mkdtempSync(join(tmpdir(), 'widget-outside-')); dirs.push(outside)
  symlinkSync(outside, folder, 'dir')
  expect(codeOf(() => f.store.read('chart'))).toBe('FORBIDDEN')
})