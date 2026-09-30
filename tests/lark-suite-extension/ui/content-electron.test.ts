import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, mkdir, writeFile, readdir, rename, rm, realpath } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { _electron } from 'playwright'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

const root = resolve(import.meta.dir, '../../..')
const documentEndKey = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
let app: Awaited<ReturnType<typeof _electron.launch>> | null = null
let profile = ''

type TaskAttempt = { requestId: string; ids: string[]; titles: string[]; receipt?: { written: number; rejected: string[] }; error?: string }
type HeldResponse = { result: any; release(): void }
type NativeDocumentTrace = { at: number; direction: 'request' | 'response' | 'event'; requestId?: string; channel: string; args?: unknown[]; result?: unknown; error?: unknown }

/** Transparent owned transport interruption. Native request/response bytes,
 * authentication and handlers are unchanged. Handshakes are never retained. */
async function nativeTransportTap(nativePort: number) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const state = { port: (server.address() as { port: number }).port, taskAttempts: [] as TaskAttempt[],
    holdNextTaskAck: false, heldTask: null as HeldResponse | null,
    holdMarkdownNote: null as string | null, heldMarkdown: null as HeldResponse | null,
    connections: 0, errors: [] as string[], documentTrace: [] as NativeDocumentTrace[] }
  const sockets = new Set<WebSocket>()
  const bytes = (raw: RawData) => Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
  server.on('connection', client => {
    state.connections += 1
    const upstream = new WebSocket(`ws://127.0.0.1:${nativePort}`)
    sockets.add(client); sockets.add(upstream)
    const queue: { message: Buffer; binary: boolean }[] = []
    const requests = new Map<string, { task?: TaskAttempt; markdownNote?: string; documentChannel?: string }>()
    client.on('message', (raw, binary) => {
      const message = bytes(raw)
      const envelope = JSON.parse(message.toString())
      if (envelope.type === 'request' && envelope.channel === 'personalTasks:put') {
        const tasks = envelope.args[0] as { id: string; title: string }[]
        const attempt = { requestId: envelope.id, ids: tasks.map(task => task.id), titles: tasks.map(task => task.title) }
        state.taskAttempts.push(attempt)
        requests.set(envelope.id, { task: attempt })
      } else if (envelope.type === 'request' && envelope.channel === 'content:commitMarkdown') {
        requests.set(envelope.id, { markdownNote: envelope.args[0].noteId, documentChannel: envelope.channel })
        state.documentTrace.push({ at: Date.now(), direction: 'request', requestId: envelope.id, channel: envelope.channel, args: envelope.args })
      } else if (envelope.type === 'request' && envelope.channel === 'notes:read') {
        requests.set(envelope.id, { documentChannel: envelope.channel })
        state.documentTrace.push({ at: Date.now(), direction: 'request', requestId: envelope.id, channel: envelope.channel, args: envelope.args })
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(message, { binary })
      else queue.push({ message, binary })
    })
    upstream.on('open', () => { for (const { message, binary } of queue.splice(0)) upstream.send(message, { binary }) })
    upstream.on('message', (raw, binary) => {
      const message = bytes(raw)
      const envelope = JSON.parse(message.toString())
      const request = requests.get(envelope.id)
      if (request && (envelope.type === 'response' || envelope.type === 'error')) {
        requests.delete(envelope.id)
        if (request.documentChannel) state.documentTrace.push({ at: Date.now(), direction: 'response', requestId: envelope.id,
          channel: request.documentChannel, result: envelope.result, error: envelope.error })
        const held = { result: envelope.result, release: () => { if (client.readyState === WebSocket.OPEN) client.send(message, { binary }) } }
        if (request.task) {
          if (envelope.error) request.task.error = envelope.error.message
          else request.task.receipt = envelope.result
          if (state.holdNextTaskAck && envelope.result?.written === 1 && envelope.result.rejected.length === 0) {
            state.holdNextTaskAck = false; state.heldTask = held; return
          }
        }
        if (request.markdownNote && request.markdownNote === state.holdMarkdownNote && envelope.type === 'response') {
          state.holdMarkdownNote = null; state.heldMarkdown = held; return
        }
      }
      if (envelope.type === 'event' && envelope.channel === 'notes:changed') {
        state.documentTrace.push({ at: Date.now(), direction: 'event', channel: envelope.channel, args: envelope.args })
      }
      if (client.readyState === WebSocket.OPEN) client.send(message, { binary })
    })
    client.on('close', () => { sockets.delete(client); upstream.close() })
    upstream.on('close', () => { sockets.delete(upstream); client.close() })
    client.on('error', error => state.errors.push(error.message))
    upstream.on('error', error => state.errors.push(error.message))
  })
  return { ...state, state, close: async () => {
    state.heldTask?.release(); state.heldMarkdown?.release()
    for (const socket of sockets) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}

async function until(observe: () => Promise<boolean>, label: string, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await observe()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out observing ${label}`)
}

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

async function sourceHashes() {
  const files = [
    'apps/electron/src/renderer/pages/NotesPage.tsx',
    'apps/electron/src/renderer/pages/notes/NoteInspector.tsx',
    'apps/electron/src/renderer/pages/notes/NotesViewHost.tsx',
    'packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx',
    'apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx',
    'apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx',
    'apps/electron/src/renderer/components/app-shell/AppShell.tsx',
    'apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx',
    'apps/electron/src/renderer/context/AppShellContext.tsx',
    'apps/electron/src/renderer/pages/ProjectInfoPage.tsx',
    'apps/electron/src/renderer/platform/home/QuickTaskInput.tsx',
    'apps/electron/src/renderer/platform/home/quick-task-input.css',
    'apps/electron/src/renderer/platform/home/widgets.tsx',
    'apps/electron/src/renderer/lib/personal-tasks.ts',
    'apps/electron/src/renderer/lib/personal-tasks-sync.ts',
    'apps/electron/src/renderer/lib/extra-screens/personal-task-bridge.ts',
    'packages/server-core/src/tasks/personal-persist.ts',
    'apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx',
    'apps/electron/src/transport/channel-map.ts',
    'apps/electron/src/transport/build-api.ts',
    'apps/electron/src/preload/bootstrap.ts',
    'packages/server-core/src/transport/client.ts',
    'packages/server-core/src/handlers/rpc/content.ts',
    'packages/server-core/src/handlers/rpc/notes.ts',
    'packages/server-core/src/handlers/rpc/personal-tasks.ts',
    'packages/server-core/src/docs/block-tree-service.ts',
    'packages/core/src/docs/frontmatter-patches.ts',
    'packages/core/src/docs/property-dictionary.ts',
    'packages/core/src/docs/block-identity.ts',
    'packages/core/src/docs/list-tree.ts',
    'packages/core/src/mindmap/derive-note.ts',
    'packages/server-core/src/handlers/rpc/code-intelligence.ts',
    'packages/shared/src/code-intelligence/refs.ts',
    'packages/shared/src/code-intelligence/repository-connection.ts',
    'tests/lark-suite-extension/ui/content-electron.test.ts',
    'tests/lark-suite-extension/ui/seed-product.ts',
  ]
  return Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(join(root, file)))])))
}

async function builtHashes() {
  const files = ['apps/electron/dist/main.cjs', 'apps/electron/dist/bootstrap-preload.cjs', 'apps/electron/dist/renderer/index.html']
  for (const name of await readdir(join(root, 'apps/electron/dist/renderer/assets'))) {
    if (name.endsWith('.js') || name.endsWith('.css')) files.push(`apps/electron/dist/renderer/assets/${name}`)
  }
  return Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(join(root, file)))])))
}

describe.skipIf(process.env.ROX_COMPOUND_PRODUCT_E2E !== '1')('Real Electron → RPC → native product authority', () => {
  afterAll(async () => { await app?.close() }, 30_000)

  test('native task ACK/retry, approved repository snapshot, Docs CAS/reload, typed properties and shared Map/Outline IDs', async () => {
    profile = await mkdtemp(join(tmpdir(), 'rox-compound-e2e-'))
    const evidence = process.env.ROX_COMPOUND_EVIDENCE_DIR || join(homedir(), 'Pictures', 'Shots', 'Agents', `rox-product-electron-${Date.now()}`)
    await mkdir(evidence, { recursive: true })
    const shots: { name: string; path: string; sha256: string }[] = []
    const sourceSha256 = await sourceHashes()
    const builtSha256 = await builtHashes()
    const git = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe' })
    const inputRevision = (await new Response(git.stdout).text()).trim()
    await git.exited
    const errors: string[] = []
    const consoleErrors: { text: string; location: unknown; arguments: unknown[] }[] = []
    const nativeLog: string[] = []
    const observed: Record<string, unknown> = { level: 'product-electron-rpc-storage', inputRevision, sourceSha256, builtSha256, profile, screenshots: shots, errors, consoleErrors, nativeLog }
    const stage = (label: string) => { observed.stage = label; console.log(`Product acceptance stage: ${label}`) }
    const environment = { PATH: process.env.PATH!, HOME: profile, TMPDIR: tmpdir(), LANG: 'ru_RU.UTF-8',
      ROX_CONFIG_DIR: profile, ROX_USER_DATA_DIR: join(profile, 'chromium'), CRAFT_INSTANCE_NUMBER: '91',
      ROX_APP_NAME: 'ROX acceptance', CRAFT_DEEPLINK_SCHEME: 'rox-compound-qa', NODE_ENV: 'test' }
    const seed = Bun.spawn([process.execPath, join(import.meta.dir, 'seed-product.ts')], { cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe' })
    const seedOutput = await new Response(seed.stdout).text()
    const seedError = await new Response(seed.stderr).text()
    if (await seed.exited !== 0) throw new Error(`Profile setup failed: ${seedError}`)
    const seeded = JSON.parse(seedOutput.trim().split('\n').at(-1)!)
    observed.seeded = seeded
    stage('boot')
    app = await _electron.launch({ executablePath: require('electron'), args: [join(root, 'apps/electron')], env: environment, timeout: 60_000 })
    observed.runtime = { bun: Bun.version, ...(await app.evaluate(() => ({ versions: process.versions,
      platform: process.platform, arch: process.arch, executablePath: process.execPath }))) }
    app.process().stderr?.on('data', bytes => nativeLog.push(String(bytes)))
    app.process().stdout?.on('data', bytes => nativeLog.push(String(bytes)))
    const page = await app.firstWindow()
    const capture = async (name: string) => {
      const path = join(evidence, `${name}.png`)
      await page.screenshot({ path })
      shots.push({ name, path, sha256: digest(await readFile(path)) })
      await writeFile(join(evidence, `${name}.txt`), await page.locator('body').innerText())
      await writeFile(join(evidence, `${name}.html`), await page.locator('body').innerHTML())
    }
    const editorPixels = async (name: string) => {
      const path = join(evidence, `${name}.png`)
      const png = await page.locator('.notes-editor .ProseMirror').screenshot({ path, caret: 'hide', animations: 'disabled' })
      shots.push({ name, path, sha256: digest(png) })
      return page.evaluate(async (encoded) => {
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
        const hash = await crypto.subtle.digest('SHA-256', pixels)
        bitmap.close()
        return { width: canvas.width, height: canvas.height, pixelSha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') }
      }, png.toString('base64'))
    }
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', async message => {
      if (message.type() !== 'error') return
      const entry = { text: message.text(), location: message.location(), arguments: [] as unknown[] }
      consoleErrors.push(entry)
      entry.arguments = await Promise.all(message.args().map(argument => argument.jsonValue().catch(() => '[not serializable]')))
    })
    let tap: Awaited<ReturnType<typeof nativeTransportTap>> | null = null
    try {
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => !!window.electronAPI, { timeout: 30_000 })
    // First run is exercised through the normal name screen; no fake auth or
    // renderer bridge replaces native RPC. This profile contains no credentials.
    await capture('boot')
    console.log(`Product acceptance profile: ${profile}`)
    const name = page.locator('#onboarding-username')
    if (await name.isVisible()) {
      await name.fill('Приёмка')
      await page.getByRole('button', { name: 'Начать', exact: true }).click()
      await name.waitFor({ state: 'hidden', timeout: 30_000 }).catch(async error => {
        await capture('onboarding-failure')
        throw error
      })
    }
    await page.waitForFunction(() => window.electronAPI.isChannelAvailable('content:resolve'), { timeout: 30_000 })
    const nativePort = await app.evaluate(({ ipcMain }) => {
      const listeners = ipcMain.listeners('__get-ws-port')
      if (listeners.length !== 1) throw new Error('Expected one actual native port provider')
      const observation = { returnValue: 0 }
      listeners[0]!(observation)
      return observation.returnValue as number
    })
    expect(nativePort).toBeGreaterThan(0)
    tap = await nativeTransportTap(nativePort)
    await app.evaluate(({ ipcMain }, port) => {
      const originals = ipcMain.listeners('__get-ws-port')
      const replacement = (event: { returnValue: number }) => { event.returnValue = port }
      for (const listener of originals) ipcMain.removeListener('__get-ws-port', listener)
      ipcMain.on('__get-ws-port', replacement)
      ;(globalThis as unknown as { __roxAcceptancePort: { originals: typeof originals; replacement: typeof replacement } }).__roxAcceptancePort = { originals, replacement }
    }, tap.port)
    await page.reload()
    await page.waitForFunction(() => window.electronAPI?.isChannelAvailable('content:resolve'))
    expect(tap.state.connections).toBeGreaterThan(0)
    observed.transport = { kind: 'transparent-owned-loopback-websocket', nativePort, proxyPort: tap.port,
      unmodifiedNativeFrames: true, authHandshakeNotRetained: true }
    // Navigate the existing Notes route, then all edit actions use the actual UI.
    const skipMemory = page.getByRole('button', { name: 'Пропустить', exact: true })
    await skipMemory.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
    if (await skipMemory.isVisible()) {
      await skipMemory.click()
      await skipMemory.waitFor({ state: 'hidden' })
    }
    await capture('native-app-ready-after-onboarding')
    // Use the application's registered navigation event to open its existing
    // Home route, then exercise its actual input and native inbox storage.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: 'home' }, bubbles: true })))
    const quickTask = page.locator('[data-home-quick-add] input')
    await quickTask.waitFor({ timeout: 30_000 })
    if (process.env.ROX_COMPOUND_PROBE_PROJECTS === '1') {
      stage('home-to-projects-probe')
      await capture('probe-home')
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: 'projects' }, bubbles: true })))
      await page.waitForFunction(() => document.body.innerText.includes('Что-то пошло не так')
        || document.querySelector('[data-list-role="projects"]') !== null, { timeout: 30_000 }).catch(() => {})
      await capture('probe-projects')
      observed.currentSourceSha256 = await sourceHashes()
      expect(await page.locator('body').innerText()).not.toContain('Что-то пошло не так')
      expect(await page.getByText('Проверка репозитория', { exact: true }).count()).toBeGreaterThan(0)
      observed.status = 'PROBE_OK'
      return
    }
    await page.evaluate(() => window.electronAPI.personalTasksList())
    await quickTask.click()
    const focus = await quickTask.evaluate(input => {
      const style = getComputedStyle(input)
      const form = getComputedStyle(input.closest('form')!)
      return { outline: style.outlineStyle, boxShadow: style.boxShadow, inset: form.boxShadow, font: style.fontFamily }
    })
    expect(focus.outline).toBe('none')
    expect(focus.boxShadow).toBe('none')
    expect(focus.inset).toContain('inset')
    await capture('home-quick-task-pointer-focus')
    const homeTitle = 'Задача из настоящей Главной'
    stage('home-native-inbox')
    await quickTask.fill(homeTitle)
    await quickTask.press('Enter')
    await page.waitForFunction(async title => (await window.electronAPI.personalTasksList()).tasks.some(task => task.title === title && task.list === 'inbox'), homeTitle, { timeout: 20_000 })
    const inbox = await page.evaluate(() => window.electronAPI.personalTasksList())
    const nativeTask = inbox.tasks.find(task => task.title === homeTitle)!
    expect(nativeTask.list).toBe('inbox')
    expect(inbox.tasks.filter(task => task.title === homeTitle)).toHaveLength(1)
    const taskFile = await readFile(join(profile, 'personal-tasks', `${nativeTask.id}.json`), 'utf8')
    expect(JSON.parse(taskFile).task.title).toBe(homeTitle)
    expect(JSON.parse(taskFile).revision).toBeGreaterThanOrEqual(1)
    observed.homeQuickTask = { focus, taskId: nativeTask.id, list: nativeTask.list, fileSha256: digest(taskFile),
      nativeRpcAndDiskReadback: true, rendererReloadReadback: false }
    await capture('home-quick-task-native-inbox')

    // Record the actual native calls, then make only this disposable profile's
    // task directory unwritable as a directory. The original RPC receives the
    // unmodified task and produces the real failed receipt; no fake store or
    // synthetic rejection replaces the product implementation.
    expect(tap.state.connections).toBeGreaterThan(0)
    stage('home-native-rejection-retry')
    const taskDirectory = join(profile, 'personal-tasks')
    const taskBackup = join(profile, 'personal-tasks-offline')
    await rename(taskDirectory, taskBackup)
    await writeFile(taskDirectory, 'Owned acceptance interruption: a directory is required here.\n')
    const retryTitle = 'Задача после нативного отказа'
    try {
      await quickTask.fill(retryTitle)
      await quickTask.press('Enter')
      await page.locator('[data-home-quick-add][data-error="true"]').waitFor()
      expect(await quickTask.inputValue()).toBe(retryTitle)
      expect(await quickTask.getAttribute('aria-invalid')).toBe('true')
      const calls = structuredClone(tap.state.taskAttempts)
      expect(calls.length).toBeGreaterThan(0)
      const rejectedCall = calls.at(-1)!
      expect(rejectedCall.receipt?.written === 0 || Boolean(rejectedCall.error)).toBe(true)
      if (rejectedCall.receipt) expect(rejectedCall.receipt.rejected).toEqual(rejectedCall.ids)
      await capture('home-real-native-rejection-retains-draft')
      observed.taskRejection = { cause: 'owned native directory replaced with a regular file', calls, draftPreserved: true }
    } finally {
      await rm(taskDirectory)
      await rename(taskBackup, taskDirectory)
    }
    tap.state.holdNextTaskAck = true
    await quickTask.press('Enter')
    await until(async () => tap!.state.heldTask !== null, 'completed native task response at owned transport')
    expect(await quickTask.inputValue()).toBe(retryTitle)
    expect(await quickTask.getAttribute('readonly')).not.toBe(null)
    expect(await page.locator('[data-home-quick-add]').getAttribute('aria-busy')).toBe('true')
    expect(await page.locator('[data-home-quick-add] button[type="submit"]').isDisabled()).toBe(true)
    const heldCallCount = tap.state.taskAttempts.length
    await quickTask.press('Enter')
    expect(tap.state.taskAttempts.length).toBe(heldCallCount)
    const writtenBeforeAcknowledgment = await page.evaluate(() => window.electronAPI.personalTasksList())
    expect(writtenBeforeAcknowledgment.tasks.filter(task => task.title === retryTitle)).toHaveLength(1)
    await capture('home-real-write-awaits-native-ack')
    const heldTaskReceipt = tap.state.heldTask!.result
    tap.state.heldTask!.release()
    tap.state.heldTask = null
    await until(async () => {
      const result = await page.evaluate(() => window.electronAPI.personalTasksList())
      return result.tasks.some(task => task.title === retryTitle)
    }, 'native retry acknowledgment')
    await page.waitForFunction(() => (document.querySelector('[data-home-quick-add] input') as HTMLInputElement | null)?.value === '')
    expect(await quickTask.inputValue()).toBe('')
    const retrySnapshot = await page.evaluate(() => window.electronAPI.personalTasksList())
    const retriedTasks = retrySnapshot.tasks.filter(task => task.title === retryTitle)
    expect(retriedTasks).toHaveLength(1)
    const attempts = structuredClone(tap.state.taskAttempts)
    const retryAttempts = attempts.filter(attempt => attempt.titles.includes(retryTitle))
    expect(retryAttempts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(retryAttempts.flatMap(attempt => attempt.ids)).size).toBe(1)
    expect(retryAttempts.at(-1)?.receipt?.written).toBe(1)
    expect(retryAttempts.at(-1)?.receipt?.rejected).toEqual([])
    expect(retriedTasks[0]!.id).toBe(retryAttempts[0]!.ids[0])
    const retryFile = await readFile(join(taskDirectory, `${retriedTasks[0]!.id}.json`), 'utf8')
    expect(JSON.parse(retryFile).task.title).toBe(retryTitle)
    observed.taskRetry = { attempts: retryAttempts, stableTaskId: retriedTasks[0]!.id, sha256: digest(retryFile), nativeDiskReadback: true,
      heldActualReceipt: heldTaskReceipt, pendingDraftPreservedUntilAcknowledgment: true, repeatedEnterIssuedNoSecondWrite: true }
    await capture('home-native-retry-stable-id')
    await page.reload()
    await page.locator('[data-home-dashboard]').waitFor({ timeout: 30_000 })
    const taskAfterReload = await page.evaluate(async id => (await window.electronAPI.personalTasksList()).tasks.find(task => task.id === id), nativeTask.id)
    expect(taskAfterReload?.title).toBe(homeTitle)
    expect(taskAfterReload?.list).toBe('inbox')
    observed.homeQuickTask = { focus, taskId: nativeTask.id, list: nativeTask.list, fileSha256: digest(taskFile), nativeRpcAndDiskReadback: true, rendererReloadReadback: true }
    await capture('home-inbox-after-renderer-reload')
    // Home's compact layout intentionally collapses the full sidebar. Enter
    // the existing Projects route through the registered navigation surface.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: 'projects' }, bubbles: true })))
    observed.routeEntry = 'registered-production-navigation-event'
    stage('repository-snapshot')
    await page.locator('[data-list-role="projects"]').getByText('Проверка репозитория', { exact: true }).click()
    await page.getByRole('button', { name: 'Ресурсы', exact: true }).click()
    const repository = page.getByTestId('repository-snapshot-panel')
    await repository.waitFor()
    const captureRepository = repository.getByTestId('repository-capture-button')
    await until(async () => await repository.getAttribute('aria-busy') === 'false', 'native repository inspection')
    expect(await captureRepository.isDisabled()).toBe(true)
    const repositoryProject = { workspaceId: seeded.workspaceId, projectId: seeded.projectId }
    const canonicalRepositoryRoot = await realpath(seeded.repositoryRoot)
    const unapprovedRepository = await page.evaluate(input => window.electronAPI.listProjectRepositorySnapshots({ ...input, requestId: crypto.randomUUID() }), repositoryProject)
    expect(unapprovedRepository.connection).toBe(null)
    expect(unapprovedRepository.snapshots).toHaveLength(0)
    await repository.getByTestId('repository-includes').fill('README.md')
    await repository.getByTestId('repository-preview-button').click()
    await repository.getByTestId('repository-preview').waitFor()
    expect(await repository.getByTestId('repository-preview-root').innerText()).toBe(canonicalRepositoryRoot)
    const reviewedRepositoryFingerprint = await repository.getByTestId('repository-preview-fingerprint').innerText()
    expect(reviewedRepositoryFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(await repository.getByTestId('repository-approved-branch').inputValue()).not.toBe('')
    expect(await captureRepository.isDisabled()).toBe(true)
    const afterPreviewRepository = await page.evaluate(input => window.electronAPI.listProjectRepositorySnapshots({ ...input, requestId: crypto.randomUUID() }), repositoryProject)
    expect(afterPreviewRepository.connection).toBe(null)
    expect(afterPreviewRepository.snapshots).toHaveLength(0)
    await capture('repository-reviewed-inventory-before-approval')
    await repository.getByTestId('repository-bind-button').click()
    await until(async () => !(await captureRepository.isDisabled()), 'approved native repository binding readback')
    const approvedRepository = await page.evaluate(input => window.electronAPI.listProjectRepositorySnapshots({ ...input, requestId: crypto.randomUUID() }), repositoryProject)
    expect(approvedRepository.connection?.includes).toEqual(['README.md'])
    expect(approvedRepository.connection?.readOnly).toBe(true)
    expect(approvedRepository.connection?.connectionRef).toBe(null)
    expect(approvedRepository.connection?.approvedRoot).toBe(canonicalRepositoryRoot)
    expect(approvedRepository.connection?.sourceProvenance.previewFingerprint).toBe(reviewedRepositoryFingerprint)
    expect(await repository.getByTestId('repository-policy-fingerprint').innerText()).toBe(approvedRepository.connection!.policyFingerprint)
    const nativeProjectConfig = await readFile(join(seeded.workspaceRoot, 'projects', seeded.projectSlug, 'config.json'), 'utf8')
    expect(JSON.parse(nativeProjectConfig).repositoryConnection).toEqual(approvedRepository.connection)
    await capture('repository-approved-policy-native-config')
    const maxFiles = repository.getByTestId('repository-max-files')
    const approvedMaxFiles = await maxFiles.inputValue()
    await maxFiles.fill('9999')
    expect(await captureRepository.isDisabled()).toBe(true)
    await capture('repository-unapproved-draft-disables-capture')
    await maxFiles.fill(approvedMaxFiles)
    await until(async () => !(await captureRepository.isDisabled()), 'restored approved repository policy')
    await captureRepository.click()
    await repository.getByTestId('repository-file-select').waitFor({ timeout: 30_000 })
    await repository.getByTestId('repository-file-select').selectOption('README.md')
    await repository.getByRole('button', { name: 'Прочитать строки снимка', exact: true }).click()
    await repository.getByTestId('repository-span').waitFor()
    expect(await repository.getByTestId('repository-span').innerText()).toContain('Acceptance repository')
    await repository.getByRole('button', { name: 'Проверить актуальность', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="repository-freshness"]')?.textContent === 'Актуален')
    await capture('repository-snapshot')
    await writeFile(join(seeded.repositoryRoot, 'README.md'), '# Changed repository\n\nNew local source line.\n')
    await repository.getByRole('button', { name: 'Проверить актуальность', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="repository-freshness"]')?.textContent?.includes('изменились'))
    expect(await repository.getByTestId('repository-span').innerText()).toContain('Acceptance repository')
    await capture('repository-stale-captured-lines')
    observed.repositoryConnection = { reviewedRepositoryFingerprint, previewDidNotPersistBindingOrSnapshot: true,
      approved: approvedRepository.connection, nativeProjectConfigSha256: digest(nativeProjectConfig),
      unapprovedDraftDisabledCapture: true, capturedTextSurvivedExternalSourceEdit: true }
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: 'notes' }, bubbles: true })))
    stage('document-native-save')
    await page.locator('.notes-list-item').filter({ hasText: 'Проверка документа' }).first().click()
    await page.getByTestId('notes-content-authority').waitFor()
    expect(await page.getByTestId('notes-content-authority').innerText()).toBe('Markdown')
    const editor = page.locator('.notes-editor .ProseMirror')
    await editor.locator('p').last().click()
    await editor.press(documentEndKey)
    await editor.press('Enter')
    await editor.pressSequentially('Сохранено через реальный RPC.')
    await page.waitForFunction(() => document.querySelector('.notes-editor .ProseMirror')?.textContent?.includes('Сохранено через реальный RPC.'))
    await until(async () => (await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).includes('Сохранено через реальный RPC.'), 'native first save')
    await capture('save-readback')
    expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toContain('Сохранено через реальный RPC.')
    const readback = await page.evaluate(async ({ workspaceId, noteId }) => window.electronAPI.readNote(workspaceId, noteId), seeded)
    expect(readback.content).toContain('Сохранено через реальный RPC.')
    expect(readback.revision).toMatch(/^sha256:/)
    await capture('saved-document')
    observed.initialSave = { revision: readback.revision, sha256: digest(await readFile(join(seeded.notesRoot, 'acceptance.md'))) }
    await writeFile(join(evidence, 'document-after-initial-native-save.md'), await readFile(join(seeded.notesRoot, 'acceptance.md')))

    // The inspector invokes NotesPage's active-task path, rather than replacing
    // the Markdown document with a synthetic editor fixture.
    const expandInspector = page.getByRole('button', { name: 'Развернуть инспектор', exact: true })
    if (await expandInspector.isVisible()) await expandInspector.click()
    stage('document-unchanged-blur')
    const unchangedBlurTraceStart = tap.state.documentTrace.length
    const unchangedSource = await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')
    const unchangedTitle = page.locator('[data-note-property="title"] input')
    await unchangedTitle.click()
    await unchangedTitle.press('Tab')
    await page.waitForTimeout(1100)
    expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toBe(unchangedSource)
    const unchangedBlurCommits = tap.state.documentTrace.slice(unchangedBlurTraceStart)
      .filter(event => event.direction === 'request' && event.channel === 'content:commitMarkdown' && (event.args?.[0] as { noteId?: string })?.noteId === seeded.noteId)
    expect(unchangedBlurCommits).toEqual([])
    observed.unchangedBlur = { sourceSha256: digest(unchangedSource), nativeCommits: 0, bytesPreserved: true }
    stage('checkbox-then-text-save')
    const checkboxState = async () => ({ nativeSource: await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8'),
      renderer: await page.getByRole('button', { name: 'Задача приёмки', exact: true }).evaluate(button => {
        // Read-only diagnostics of the actual committed React props/refs. No
        // callback, state setter or native result is replaced by this probe.
        const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'))
        const inspector: Record<string, unknown> = {}
        const guards: Record<string, unknown>[] = []
        let liveGuards: any[] | undefined
        let actualEditor: any
        let fiber = fiberKey ? (button as unknown as Record<string, any>)[fiberKey] : null
        let hostRoot = fiber
        while (hostRoot?.return) hostRoot = hostRoot.return
        // React can keep the host's expando on the alternate branch. Select the
        // branch linked to the actual root before reading rendered task props.
        if (hostRoot?.stateNode?.current !== hostRoot && fiber?.alternate) fiber = fiber.alternate
        while (fiber) {
          const props = fiber.memoizedProps
          if (props?.activeNoteTasks && typeof props?.content === 'string') {
            Object.assign(inspector, { activeNoteId: props.activeNote?.id, content: props.content,
              activeNoteRevision: props.activeNote?.revision, tasks: props.activeNoteTasks })
          }
          const hooks: any[] = []
          let hook = fiber.memoizedState
          // Host fibers may have non-hook memoized state. Bound traversal to a
          // genuine hook linked list and retain only the known guard pattern.
          for (let index = 0; hook && typeof hook === 'object' && 'memoizedState' in hook && index < 250; index++) {
            hooks.push(hook.memoizedState); hook = hook.next
          }
          const isRef = (value: any) => value && typeof value === 'object' && Object.hasOwn(value, 'current')
          actualEditor ??= hooks.find(value => isRef(value) && typeof value.current?.getJSON === 'function'
            && typeof value.current?.on === 'function')?.current
          for (let index = 0; index + 6 < hooks.length; index++) {
            const values = hooks.slice(index, index + 7)
            if (!values.every(isRef)) continue
            const [cache, dirty, content, revisions, pending, opening, workspace] = values.map(value => value.current)
            if (cache instanceof Map && typeof dirty === 'boolean' && typeof content === 'string'
              && revisions instanceof Map && pending instanceof Map && typeof opening === 'number' && typeof workspace === 'string') {
              guards.push({ hookIndex: index, dirty, content, opening, workspace,
                taskCache: Array.from(cache.entries()), revisions: Array.from(revisions.entries()), pendingCommitKeys: Array.from(pending.keys()) })
              liveGuards = values
            }
          }
          fiber = fiber.return
        }
        const probeWindow = window as unknown as { __roxCheckboxEditorTrace?: { editor: any; handler: (event: any) => void; updateHandler: (event: any) => void; events: unknown[] } }
        if (actualEditor && liveGuards && !probeWindow.__roxCheckboxEditorTrace) {
          const refs = liveGuards
          const events: unknown[] = []
          const record = (kind: string, { transaction }: any) => events.push({ at: Date.now(), event: kind,
            docChanged: transaction?.docChanged, preventUpdate: transaction?.getMeta('preventUpdate'),
            dirty: refs[1].current, content: refs[2].current, opening: refs[5].current,
            focused: actualEditor.isFocused, editorMarkdown: actualEditor.getMarkdown?.() })
          const handler = (event: any) => record('transaction', event)
          const updateHandler = (event: any) => record('update', event)
          actualEditor.on('transaction', handler)
          actualEditor.on('update', updateHandler)
          probeWindow.__roxCheckboxEditorTrace = { editor: actualEditor, handler, updateHandler, events }
        }
        return { inspector, guards, editorText: document.querySelector('.notes-editor .ProseMirror')?.textContent,
          editorHtml: document.querySelector('.notes-editor .ProseMirror')?.innerHTML,
          editorTransactions: probeWindow.__roxCheckboxEditorTrace?.events ?? [] }
      }) })
    const checkboxBefore = await checkboxState()
    const checkboxTraceStart = tap.state.documentTrace.length
    observed.checkboxAttempt = { before: checkboxBefore, traceStart: checkboxTraceStart }
    try {
      await page.getByRole('button', { name: 'Задача приёмки', exact: true }).click()
      await until(async () => (await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).includes('[x] Задача приёмки'), 'active checkbox persisted')
    } finally {
      observed.checkboxAttempt = { before: checkboxBefore, after: await checkboxState(),
        trace: tap.state.documentTrace.slice(checkboxTraceStart) }
      await page.evaluate(() => {
        const probeWindow = window as unknown as { __roxCheckboxEditorTrace?: { editor: any; handler: (event: any) => void; updateHandler: (event: any) => void } }
        const trace = probeWindow.__roxCheckboxEditorTrace
        if (trace) { trace.editor.off('transaction', trace.handler); trace.editor.off('update', trace.updateHandler) }
        delete probeWindow.__roxCheckboxEditorTrace
      })
    }
    const toggled = await page.evaluate(async ({ workspaceId, noteId }) => window.electronAPI.readNote(workspaceId, noteId), seeded)
    expect(toggled.revision).not.toBe(readback.revision)
    const editorTask = editor.locator('li[data-checked]').filter({ hasText: 'Задача приёмки' })
    await until(async () => await editorTask.getAttribute('data-checked') === 'true', 'active editor checkbox reflects native saved toggle')
    expect(await editorTask.locator('input[type="checkbox"]').isChecked()).toBe(true)
    await editor.locator('p').last().click()
    await editor.press(documentEndKey)
    await editor.press('Enter')
    await editor.pressSequentially('Текст после переключения задачи.')
    await until(async () => (await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).includes('Текст после переключения задачи.'), 'text save after checkbox')
    expect(await page.getByTestId('notes-save-recovery').count()).toBe(0)
    expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toContain('[x] Задача приёмки')
    const afterCheckboxText = await page.evaluate(async ({ workspaceId, noteId }) => window.electronAPI.readNote(workspaceId, noteId), seeded)
    expect(afterCheckboxText.revision).not.toBe(toggled.revision)
    expect(afterCheckboxText.content).toContain('Сохранено через реальный RPC.')
    expect(afterCheckboxText.content).toContain('Исходный текст.')
    observed.checkboxThenText = { checkboxRevision: toggled.revision, textRevision: afterCheckboxText.revision }
    await capture('checkbox-then-text-save')

    // Make a genuine unsaved editor draft before another process changes the
    // native file. The actual watcher and authority CAS handle this race.
    const localDraft = 'Мой несохранённый конфликтный черновик.'
    stage('external-conflict-recovery')
    await editor.locator('p').last().click()
    await editor.press(documentEndKey)
    await editor.press('Enter')
    await editor.pressSequentially(localDraft)
    const external = (await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')) + '\nИзменено внешним процессом.\n'
    await writeFile(join(seeded.notesRoot, 'acceptance.md'), external)
    const recovery = page.getByTestId('notes-save-recovery')
    await recovery.waitFor({ timeout: 20_000 })
    expect(await recovery.innerText()).toContain('Документ изменён вне этого редактора')
    expect(await editor.innerText()).toContain(localDraft)
    expect(await editor.innerText()).toContain('Текст после переключения задачи.')
    expect(await editor.innerText()).toContain('Сохранено через реальный RPC.')
    expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toBe(external)
    const nativeConflict = tap.state.documentTrace.findLast(event => event.channel === 'content:commitMarkdown'
      && event.direction === 'response' && (event.error as { code?: string })?.code === 'HASH_CONFLICT')!
    expect(nativeConflict.error).toEqual({ code: 'HASH_CONFLICT', message: 'note revision conflict' })
    const rejectedCommand = tap.state.documentTrace.find(event => event.direction === 'request'
      && event.requestId === nativeConflict.requestId)!.args![0]
    const bridgedConflict = await page.evaluate(async value => {
      try { await window.electronAPI.commitMarkdown(value as Parameters<typeof window.electronAPI.commitMarkdown>[0]); return { rejected: false } }
      catch (caught) {
        const actual = caught as { message?: string; code?: string }
        return { rejected: true, message: actual?.message, code: actual?.code }
      }
    }, rejectedCommand)
    expect(bridgedConflict).toEqual({ rejected: true, message: 'note revision conflict', code: 'HASH_CONFLICT' })
    expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toBe(external)
    observed.conflictBridge = { nativeError: nativeConflict.error, rendererRejection: bridgedConflict, replayedExactRejectedCommand: true }
    await capture('cas-conflict-draft-preserved')
    await recovery.getByRole('button', { name: 'Перечитать исходный файл', exact: true }).click()
    const reloadDialog = page.getByRole('dialog', { name: 'Перечитать исходный документ?' })
    await reloadDialog.waitFor()
    expect(await reloadDialog.innerText()).toContain('Сначала скопируйте несохранённые изменения')
    await capture('reload-confirmation')
    await reloadDialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await editor.innerText()).toContain(localDraft)
    expect(await recovery.count()).toBe(1)
    expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toBe(external)
    await capture('reload-cancel-retains-draft')
    await recovery.getByRole('button', { name: 'Перечитать исходный файл', exact: true }).click()
    await reloadDialog.getByRole('button', { name: 'Перечитать исходный файл', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.notes-editor .ProseMirror')?.textContent?.includes('Изменено внешним процессом.'))
    expect(await editor.innerText()).not.toContain(localDraft)
    expect(await recovery.count()).toBe(0)
    expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toBe(external)
    const reloaded = await page.evaluate(async ({ workspaceId, noteId }) => window.electronAPI.readNote(workspaceId, noteId), seeded)
    expect(reloaded.revision).not.toBe(afterCheckboxText.revision)
    observed.conflictRecovery = { externalSha256: digest(external), reloadedRevision: reloaded.revision, canceledReloadPreservedDraft: true }
    await writeFile(join(evidence, 'document-confirmed-external-source.md'), await readFile(join(seeded.notesRoot, 'acceptance.md')))
    await capture('confirmed-reload-native-source')

    // If the bridge's global property is configurable, hold ONLY the resolution
    // of a completed real commit. The original native method performs the write
    // and returns the actual receipt; no data/error implementation is mocked.
    await page.locator('.notes-list-item').filter({ hasText: 'Навигационная заметка' }).first().click()
    stage('real-native-ack-navigation')
    await page.waitForFunction(() => document.querySelector('.notes-editor .ProseMirror')?.textContent?.includes('Текст второго документа.'))
    await page.locator('.notes-list-item').filter({ hasText: 'Проверка документа' }).first().click()
    await page.waitForFunction(() => document.querySelector('.notes-editor .ProseMirror')?.textContent?.includes('Изменено внешним процессом.'))
    const ackCapability = { supported: tap.state.connections > 0, kind: 'transparent-owned-native-response-frame',
      bridge: await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'electronAPI')!
        return { configurable: descriptor.configurable === true, writable: descriptor.writable === true,
          frozen: Object.isFrozen(window.electronAPI) }
      }) }
    expect(ackCapability.supported).toBe(true)
    tap.state.holdMarkdownNote = seeded.noteId
    observed.heldAckCapability = ackCapability
    let finalMarker = 'Изменено внешним процессом.'
    if (ackCapability.supported) {
      const lateMarker = 'Реальная запись с удержанным подтверждением.'
      await editor.locator('p').last().click()
      await editor.press(documentEndKey)
      await editor.press('Enter')
      await editor.pressSequentially(lateMarker)
      await until(async () => tap!.state.heldMarkdown !== null, 'completed native Markdown response at owned transport')
      expect(await readFile(join(seeded.notesRoot, 'acceptance.md'), 'utf8')).toContain(lateMarker)
      await page.locator('.notes-list-item').filter({ hasText: 'Навигационная заметка' }).first().click()
      await page.waitForTimeout(200)
      expect(await editor.innerText()).toContain(lateMarker)
      expect(await editor.innerText()).not.toContain('Текст второго документа.')
      await capture('real-ack-navigation-blocked')

      // Native browser history is another actual navigation entry point. It
      // changes generation while the earlier commit's result is still held.
      await page.goBack()
      await page.waitForFunction(() => document.querySelector('.notes-editor .ProseMirror')?.textContent?.includes('Текст второго документа.'))
      finalMarker = 'Черновик второго документа до подтверждения первого.'
      await editor.locator('p').last().click()
      await editor.press(documentEndKey)
      await editor.press('Enter')
      await editor.pressSequentially(finalMarker)
      await capture('new-document-draft-before-old-ack')
      const foreignBufferBefore = { text: await editor.innerText(), pixels: await editorPixels('foreign-buffer-before-old-ack') }
      const receipt = tap.state.heldMarkdown!.result.receipt
      tap.state.heldMarkdown!.release()
      tap.state.heldMarkdown = null
      await until(async () => (await readFile(join(seeded.notesRoot, 'navigation.md'), 'utf8')).includes(finalMarker), 'new document draft after old ACK')
      expect(await editor.innerText()).toContain(finalMarker)
      expect(await editor.innerText()).not.toContain(lateMarker)
      expect(await recovery.count()).toBe(0)
      const foreignBufferAfter = { text: await editor.innerText(), pixels: await editorPixels('foreign-buffer-after-old-ack') }
      expect(foreignBufferAfter.text).toBe(foreignBufferBefore.text)
      expect(foreignBufferAfter.pixels).toEqual(foreignBufferBefore.pixels)
      observed.heldAck = { receipt, realNativeWriteObservedBeforeAck: true, normalNoteNavigationBlocked: true, browserHistoryNavigation: true,
        newDraftPreserved: true, foreignBufferBefore, foreignBufferAfter, semanticAndDecodedPixelsUnchanged: true }
      await capture('old-ack-preserves-new-document-draft')
    } else {
      observed.heldAck = { status: 'NOT_RUN', reason: 'Actual contextBridge global is immutable; no fake commit implementation substituted.' }
    }
    await page.reload()
    await page.getByTestId('notes-content-authority').waitFor({ timeout: 30_000 })
    expect(await page.locator('.notes-editor .ProseMirror').innerText()).toContain(finalMarker)
    await capture('renderer-reload-native-readback')

    stage('typed-cst-properties')
    await page.locator('.notes-list-item').filter({ hasText: 'Типизированные свойства' }).first().click()
    await page.getByTestId('notes-content-authority').waitFor()
    if (await expandInspector.isVisible()) await expandInspector.click()
    const propertyFile = join(seeded.notesRoot, 'properties.md')
    const originalProperties = await readFile(propertyFile, 'utf8')
    expect(originalProperties).toBe(seeded.propertiesSource)
    const scalar = (key: string) => page.locator(`[data-note-property="${key}"]`)
    const propertyBlurTraceStart = tap.state.documentTrace.length
    for (const [key, value, kind] of [['empty', 'null', 'null'], ['digits', '001', 'string'], ['truth', 'true', 'string'], ['comma', 'a,b', 'string']]) {
      const field = scalar(key!)
      expect(await field.locator('input').inputValue()).toBe(value!)
      expect(await field.locator('select').inputValue()).toBe(kind!)
      await field.locator('input').click()
      await field.locator('input').press('Tab')
    }
    await page.waitForTimeout(1100)
    expect(await readFile(propertyFile, 'utf8')).toBe(originalProperties)
    expect(tap.state.documentTrace.slice(propertyBlurTraceStart)
      .filter(event => event.direction === 'request' && event.channel === 'content:commitMarkdown' && (event.args?.[0] as { noteId?: string })?.noteId === seeded.propertiesNoteId)).toEqual([])
    await capture('typed-properties-unchanged-blur')
    await scalar('digits').locator('input').fill('002')
    await scalar('digits').locator('input').press('Enter')
    const afterDigits = originalProperties.replace("digits: '001'", "digits: '002'")
    await until(async () => await readFile(propertyFile, 'utf8') === afterDigits, 'quoted string scalar exact native bytes')
    expect(await readFile(propertyFile, 'utf8')).toBe(afterDigits)
    await scalar('amount').locator('input').fill('8')
    await scalar('amount').locator('input').press('Enter')
    const afterNumber = afterDigits.replace('amount: 7', 'amount: 8')
    await until(async () => await readFile(propertyFile, 'utf8') === afterNumber, 'number scalar exact native bytes')
    expect(await readFile(propertyFile, 'utf8')).toBe(afterNumber)
    await scalar('amount').locator('select').selectOption('string')
    await scalar('amount').locator('input').fill('09')
    await scalar('amount').locator('input').press('Enter')
    const afterTypedChange = afterNumber.replace('amount: 8', 'amount: "09"')
    await until(async () => await readFile(propertyFile, 'utf8') === afterTypedChange, 'explicit scalar type change exact native bytes')
    const propertyReadback = await page.evaluate(async ({ workspaceId, propertiesNoteId }) => window.electronAPI.readNote(workspaceId, propertiesNoteId), seeded)
    expect(propertyReadback.properties.empty).toBe(null)
    expect(propertyReadback.properties.digits).toBe('002')
    expect(propertyReadback.properties.truth).toBe('true')
    expect(propertyReadback.properties.comma).toBe('a,b')
    expect(propertyReadback.properties.amount).toBe('09')
    expect(propertyReadback.properties.enabled).toBe(true)
    expect(await page.getByTestId('notes-save-recovery').count()).toBe(0)
    await writeFile(join(evidence, 'properties-before.md'), originalProperties)
    await writeFile(join(evidence, 'properties-after-scalar-edits.md'), afterTypedChange)
    observed.scalarProperties = { unchangedBlurPreservedBytes: true, originalSha256: digest(originalProperties),
      afterDigitsSha256: digest(afterDigits), afterNumberSha256: digest(afterNumber), afterTypedChangeSha256: digest(afterTypedChange),
      readback: propertyReadback.properties, revision: propertyReadback.revision }
    await capture('typed-scalar-edits-native-byte-readback')

    // Creating a key uses the actual reviewed conversion surface. Cancel must
    // retain both native bytes and the entered form values.
    const propertyKey = page.getByRole('textbox', { name: 'ключ', exact: true })
    const propertyValue = page.getByRole('textbox', { name: 'значение', exact: true })
    await propertyKey.fill('reviewed_text')
    await propertyValue.fill('true')
    await page.getByRole('button', { name: 'Добавить свойство', exact: true }).click()
    const propertyDialog = page.getByRole('dialog', { name: 'Проверьте форматирование свойств' })
    await propertyDialog.waitFor()
    expect(await propertyDialog.innerText()).toContain('Комментарии, оформление')
    expect(await propertyDialog.locator('pre').first().innerText()).toContain('# keep-number-comment')
    expect(await readFile(propertyFile, 'utf8')).toBe(afterTypedChange)
    await capture('property-conversion-reviewed-preview')
    await propertyDialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await readFile(propertyFile, 'utf8')).toBe(afterTypedChange)
    expect(await propertyKey.inputValue()).toBe('reviewed_text')
    expect(await propertyValue.inputValue()).toBe('true')
    await capture('property-conversion-cancel-retains-source')
    await page.getByRole('button', { name: 'Добавить свойство', exact: true }).click()
    await propertyDialog.getByRole('button', { name: 'Применить свойства', exact: true }).click()
    await until(async () => (await readFile(propertyFile, 'utf8')).includes('reviewed_text:'), 'reviewed native property conversion')
    const convertedProperties = await readFile(propertyFile, 'utf8')
    expect(convertedProperties.slice(convertedProperties.indexOf('\n---\n') + 5)).toBe(afterTypedChange.slice(afterTypedChange.indexOf('\n---\n') + 5))
    const convertedReadback = await page.evaluate(async ({ workspaceId, propertiesNoteId }) => window.electronAPI.readNote(workspaceId, propertiesNoteId), seeded)
    expect(convertedReadback.properties.reviewed_text).toBe('true')
    expect(convertedReadback.properties.amount).toBe('09')
    expect(convertedReadback.properties.empty).toBe(null)
    await writeFile(join(evidence, 'properties-after-reviewed-conversion.md'), convertedProperties)
    observed.propertyConversion = { canceledPreservedSourceAndForm: true, appliedSha256: digest(convertedProperties), bodyBytesPreserved: true,
      revision: convertedReadback.revision, newPropertyType: typeof convertedReadback.properties.reviewed_text }
    await capture('property-conversion-applied-native-readback')

    await page.locator('.notes-list-item').filter({ hasText: 'unsupported' }).first().click()
    await scalar('shared').waitFor()
    for (const key of ['shared', 'alias', 'tagged', 'multiline', 'sequence']) {
      expect(await scalar(key).locator('select').isDisabled()).toBe(true)
      expect(await scalar(key).locator('input').getAttribute('readonly')).not.toBe(null)
    }
    expect(await readFile(join(seeded.notesRoot, 'unsupported.md'), 'utf8')).toBe(seeded.unsupportedSource)
    await capture('unsupported-yaml-properties-read-only')
    await page.locator('.notes-list-item').filter({ hasText: 'malformed' }).first().click()
    await page.getByText('Свойства доступны только для чтения: формат YAML не распознан безопасно. Исправьте источник в редакторе и откройте заметку заново.', { exact: true }).waitFor()
    expect(await propertyKey.isDisabled()).toBe(true)
    expect(await propertyValue.isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: 'Добавить свойство', exact: true }).isDisabled()).toBe(true)
    expect(await readFile(join(seeded.notesRoot, 'malformed.md'), 'utf8')).toBe(seeded.malformedSource)
    observed.unsupportedProperties = { readOnlyKinds: ['shared-anchor', 'alias', 'unknown-tag', 'multiline', 'sequence'],
      unsupportedSha256: digest(seeded.unsupportedSource), malformedDisabled: true, malformedSha256: digest(seeded.malformedSource) }
    await capture('malformed-yaml-properties-disabled')

    stage('native-map-outline-markers')
    await page.locator('.notes-list-item').filter({ hasText: 'Структура документа' }).first().click()
    const structureFile = join(seeded.notesRoot, 'structure.md')
    const blockSource = page.getByTestId('notes-stable-block-source')
    const getNativeTree = () => page.evaluate(async ({ workspaceId, structureNoteId }) => {
      const resolution = await window.electronAPI.resolveContent({ workspaceId, entityId: 'note:' + structureNoteId })
      if (resolution.status === 'error') throw new Error('Native block authority unavailable: ' + resolution.code)
      return window.electronAPI.getBlockTree({ ref: resolution.canonicalRef, revision: resolution.revision,
        authorityEpoch: resolution.origin.authorityEpoch, sourceStoreId: resolution.origin.sourceStoreId })
    }, seeded)
    const initialTree = await getNativeTree()
    expect(initialTree.identity.status).toBe('ok')
    expect(initialTree.listTree.nodes).toHaveLength(3)
    expect(initialTree.listTree.nodes.some(node => node.text.includes('Это код'))).toBe(false)
    expect(initialTree.listTree.nodes.find(node => node.text === 'Дочерний блок')?.parentNodeId).toBe('existing-parent')
    await page.getByRole('tab', { name: 'Оглавление', exact: true }).click()
    const outline = page.getByTestId('notes-outline-view')
    await outline.waitFor()
    const initialOutlineIds = await outline.locator('[data-block-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-block-id')).sort())
    expect(initialOutlineIds).toEqual(['existing-child', 'existing-parent'])
    expect(await readFile(structureFile, 'utf8')).toBe(seeded.structureSource)
    await capture('native-outline-existing-ids-read-only')
    await page.getByRole('tab', { name: 'Карта', exact: true }).click()
    await page.locator('[data-mindmap-node="block:existing-child"]').waitFor()
    const initialMapIds = await page.locator('[data-mindmap-node^="block:"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-mindmap-node')!.slice(6)).sort())
    expect(initialMapIds).toEqual(initialOutlineIds)
    expect(await readFile(structureFile, 'utf8')).toBe(seeded.structureSource)
    await capture('native-map-same-block-ids')
    await page.getByRole('button', { name: 'Назначить стабильные ID блоков', exact: true }).click()
    const markerDialog = page.getByRole('dialog', { name: 'Проверка стабильных ID блоков' })
    await markerDialog.waitFor()
    expect(await markerDialog.locator('pre').first().textContent()).toBe(seeded.structureSource)
    const proposedMarkers = (await markerDialog.locator('pre').nth(1).textContent())!
    expect(proposedMarkers).toContain('<!-- block:')
    expect(await readFile(structureFile, 'utf8')).toBe(seeded.structureSource)
    await capture('stable-marker-reviewed-before-after')
    await page.keyboard.press('Escape')
    await markerDialog.waitFor({ state: 'hidden' })
    expect(await readFile(structureFile, 'utf8')).toBe(seeded.structureSource)
    await capture('stable-marker-cancel-source-unchanged')
    await page.getByRole('button', { name: 'Назначить стабильные ID блоков', exact: true }).click()
    await markerDialog.waitFor()
    const reviewedMarkerSource = (await markerDialog.locator('pre').nth(1).textContent())!
    await markerDialog.getByRole('button', { name: 'Применить проверенные маркеры', exact: true }).click()
    await until(async () => await readFile(structureFile, 'utf8') === reviewedMarkerSource, 'native reviewed marker exact bytes')
    const finalTree = await getNativeTree()
    const finalNativeIds = [finalTree.listTree.root?.nodeId, ...finalTree.listTree.nodes.map(node => node.nodeId)].filter(Boolean).sort()
    const finalListIds = finalTree.listTree.nodes.map(node => node.nodeId).filter(Boolean).sort()
    expect(finalNativeIds).toHaveLength(4)
    expect(finalNativeIds).toContain('existing-parent')
    expect(finalNativeIds).toContain('existing-child')
    expect(reviewedMarkerSource.replace(/^[ \t]*<!-- block:[A-Za-z0-9_-]+ -->\n/gm, '')).toBe(seeded.structureSource)
    await until(async () => (await page.locator('[data-mindmap-node^="block:"]').count()) === finalListIds.length, 'map refresh from native marker ACK')
    const finalMapIds = await page.locator('[data-mindmap-node^="block:"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-mindmap-node')!.slice(6)).sort())
    expect(finalMapIds).toEqual(finalListIds)
    await capture('stable-marker-applied-map-native-ids')
    // The map canvas names its root display object "root". Its actual source
    // navigation must resolve to the same native root ID shown in Outline.
    await page.locator('[data-mindmap-node="root"]').dblclick()
    await blockSource.waitFor()
    expect(await blockSource.getAttribute('data-block-id')).toBe(finalTree.listTree.root!.nodeId!)
    expect(await blockSource.innerText()).toContain('# Структура документа')
    await capture('map-root-resolves-native-outline-root-id')
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Оглавление', exact: true }).click()
    const finalOutlineIds = await outline.locator('[data-block-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-block-id')).sort())
    expect(finalOutlineIds).toEqual(finalNativeIds)
    await capture('stable-marker-outline-same-native-ids')
    await outline.locator('[data-block-id="existing-child"]').click()
    await blockSource.waitFor()
    expect(await blockSource.getAttribute('data-block-id')).toBe('existing-child')
    expect(await blockSource.innerText()).toContain('Дочерний блок ^existing-child')
    expect(await page.getByRole('dialog').innerText()).toContain('[[structure#^existing-child]]')
    await capture('outline-native-block-deeplink')
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Карта', exact: true }).click()
    await page.locator('[data-mindmap-node="block:existing-child"]').dblclick()
    await blockSource.waitFor()
    expect(await blockSource.getAttribute('data-block-id')).toBe('existing-child')
    expect(await blockSource.innerText()).toContain('Дочерний блок ^existing-child')
    await capture('map-native-block-deeplink-same-source')
    await page.keyboard.press('Escape')
    await page.evaluate((noteAddress) => window.dispatchEvent(new CustomEvent('craft-agent-navigate', {
      detail: { route: 'notes/note/' + encodeURIComponent(noteAddress) }, bubbles: true,
    })), seeded.structureNoteId + '#^existing-child')
    await blockSource.waitFor()
    expect(await blockSource.getAttribute('data-block-id')).toBe('existing-child')
    await capture('registered-native-block-address')
    await writeFile(join(evidence, 'structure-before.md'), seeded.structureSource)
    await writeFile(join(evidence, 'structure-after-reviewed-markers.md'), reviewedMarkerSource)
    observed.blockStructure = { initialTree, finalTree, initialOutlineIds, initialMapIds, finalNativeIds, finalListIds, finalOutlineIds, finalMapIds,
      readsNeverStampedSource: true, canceledPreviewPreservedSource: true, reviewedSourceSha256: digest(reviewedMarkerSource),
      nativeAppliedExactReviewedBytes: true, mapRootResolvedNativeId: finalTree.listTree.root!.nodeId,
      mapOutlineAndAddressResolveSameBlock: 'existing-child' }
    observed.seeded = seeded
    observed.errors = errors
    expect(await sourceHashes()).toEqual(sourceSha256)
    expect(await builtHashes()).toEqual(builtSha256)
    expect(errors).toEqual([])
    observed.status = 'PASS'
    } catch (error) {
      observed.status = 'FAIL'
      observed.error = error instanceof Error ? error.message : String(error)
      if (observed.stage === 'external-conflict-recovery' && tap) {
        // Replay only the exact command already rejected by genuine native CAS,
        // to observe what the immutable contextBridge delivers to the renderer.
        const rejection = tap.state.documentTrace.findLast(event => event.channel === 'content:commitMarkdown'
          && event.direction === 'response' && (event.error as { code?: string })?.code === 'HASH_CONFLICT')
        const command = rejection && tap.state.documentTrace.find(event => event.direction === 'request'
          && event.requestId === rejection.requestId)?.args?.[0]
        if (command) observed.rejectedCommandBridge = await page.evaluate(async value => {
          try { await window.electronAPI.commitMarkdown(value as Parameters<typeof window.electronAPI.commitMarkdown>[0]); return { rejected: false } }
          catch (caught) {
            const actual = caught as { name?: string; message?: string; code?: string; data?: unknown }
            return { rejected: true, name: actual?.name, message: actual?.message, code: actual?.code,
              data: actual?.data, ownProperties: caught && typeof caught === 'object' ? Object.getOwnPropertyNames(caught) : [],
              isError: caught instanceof Error }
          }
        }, command).catch(caught => ({ diagnosticError: String(caught) }))
      }
      await capture('failure').catch(() => {})
      throw error
    } finally {
      await app.evaluate(({ ipcMain }) => {
        const stored = (globalThis as unknown as { __roxAcceptancePort?: { originals: Function[]; replacement: (...args: any[]) => void } }).__roxAcceptancePort
        if (!stored) return
        ipcMain.removeListener('__get-ws-port', stored.replacement)
        for (const original of stored.originals) ipcMain.on('__get-ws-port', original as (...args: any[]) => void)
        delete (globalThis as unknown as { __roxAcceptancePort?: unknown }).__roxAcceptancePort
      }).catch(() => {})
      if (tap) {
        observed.transportErrors = tap.state.errors
        observed.transportTaskAttempts = tap.state.taskAttempts
        observed.nativeDocumentTrace = tap.state.documentTrace
        await tap.close()
      }
      await writeFile(join(evidence, 'result.json'), JSON.stringify(observed, null, 2))
      console.log(`Product acceptance evidence: ${join(evidence, 'result.json')}`)
    }
  }, 360_000)
})
