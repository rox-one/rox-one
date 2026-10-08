import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveChromiumExecutable } from '../../../../../test-utils/chromium-executable'

const executablePath = await resolveChromiumExecutable()
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined
beforeAll(async () => {
  if (!existsSync(executablePath)) throw new Error(`Reader DOM verification requires Chromium at ${executablePath}; set CHROMIUM_EXECUTABLE to an installed browser executable.`)
  const bundle = await Bun.build({ entrypoints: [fileURLToPath(new URL('./reader-harness.fixture.tsx', import.meta.url))], target: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
  if (!bundle.success) throw new Error(bundle.logs.map(String).join('\n'))
  const script = await bundle.outputs[0]!.text()
  server = Bun.serve({ port: 0, fetch(request) { return new URL(request.url).pathname === '/entry.js' ? new Response(script, { headers: { 'Content-Type': 'application/javascript' } }) : new Response('<html><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } }) } })
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
}, 30_000)
afterAll(async () => { await browser?.close(); server?.stop(true) })

test('native reader hook observes a real rendered selection and source gallery never subscribes on tour start', async () => {
  const page = await browser!.newPage()
  await page.goto(server!.url.toString())
  await page.getByTestId('choose').waitFor()
  const evidence = () => page.evaluate(() => {
    const state = (window as unknown as { readerEvidence: { signals: unknown[]; captures: number; selections: number; mutations: number; targets: Map<string, { context: unknown; element: HTMLElement }> } }).readerEvidence
    return { signals: state.signals, captures: state.captures, selections: state.selections, mutations: state.mutations, targets: [...state.targets].map(([id, value]) => ({ id, context: value.context, connected: value.element.isConnected })) }
  })
  expect(await evidence()).toMatchObject({ signals: [], captures: 0, selections: 0, mutations: 0, targets: expect.arrayContaining([{ id: 'feed.reader', context: expect.any(Object), connected: true }, { id: 'feed.sources', context: expect.any(Object), connected: true }]) })
  await page.getByTestId('prior').click()
  expect((await evidence()).signals).toEqual([])
  await page.getByTestId('close').click()
  await page.getByTestId('choose').click()
  await page.waitForFunction(() => (window as any).readerEvidence.signals.length === 1)
  expect((await evidence()).signals[0]).toMatchObject({ name: 'feed.item-opened', level: 'observed', binding: { workspaceId: 'fixture-workspace', panelId: 'fixture-panel', runToken: 'fixture-run-a' }, operationToken: 'fixture-operation-1', operationStartedAt: 100 })
  await page.getByTestId('update').click()
  expect((await evidence()).signals).toHaveLength(1)
  await page.getByTestId('tour-toggle').click()
  await page.getByTestId('close').click()
  await page.getByTestId('choose').click()
  expect((await evidence()).signals).toHaveLength(1)
  expect((await evidence()).targets).toEqual([])
  await page.getByTestId('tour-toggle').click()
  await page.getByTestId('new-run').click()
  await page.getByTestId('choose').click()
  await page.waitForFunction(() => (window as any).readerEvidence.signals.length === 2)
  expect((await evidence()).signals[1]).toMatchObject({ binding: { runToken: 'fixture-run-b' } })
  await page.getByTestId('foreign-panel').click()
  await page.getByTestId('choose').click()
  expect((await evidence()).signals).toHaveLength(2)
  expect((await evidence()).mutations).toBe(0)
  await page.close()
}, 30_000)
