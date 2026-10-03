import { describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { WebSocketServer } from 'ws'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../../apps/workspace-service/src/auth/postgres-identity'
import { createProjectRequestHash } from '../../../apps/workspace-service/src/modules/identity/commands'
import { requireSharedProjectPage, requireSharedProjectResult } from '../../../apps/electron/src/shared/project-authority'
import type { CreateSharedProject, RoxCommand } from '../../../packages/shared/src/workspace-domain/identity/contracts'

// Separate opt-in lane: the existing native acceptance stays intact. Genuine
// profile/environment setup is reused through its supported subprocess flags;
// importing that test would register another consumer lane and is avoided.
const root = resolve(import.meta.dir, '../../..')
const environmentHelper = join(root, 'tests/macro-integration/ui/wp-01-electron.test.ts')
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const HELPER_TIMEOUT_MS = 90_000
// Runtime preparation independently hashes both 31,824-file pinned trees.
// Its filesystem budget is separate from every product/UI response deadline.
const RUNTIME_PREPARATION_TIMEOUT_MS = 240_000
const NATIVE_SCENARIO_TIMEOUT_MS = 420_000
const NATIVE_PROFILES = 2
type Command = RoxCommand<CreateSharedProject>
type IntentView = { state: 'none'; eligible: boolean }
  | { state: 'blocked'; eligible: false; code: string }
  | { state: 'queued' | 'uncertain'; eligible: true; command: Command }
interface Seed {
  profile: string; localWorkspaceId: string; workspaceRoot: string; localProjectId: string
  localProjectSlug: string; localProjectFolder: string; localProjectAssets: string
  localProjectName: string; localProjectConfigSha256: string; localAssetSha256: string
}
interface NativeProfile { label: string; seed: Seed; env: Record<string, string>; app?: ElectronApplication; page?: Page; hasLaunched?: boolean }
interface Owner { login: string; principalId: string }
interface IntentReadback {
  present: boolean; tokenType?: string; command?: Command; state?: string; code?: string | null
  pendingValueSha256?: string; commandSha256?: string; tokenDigest?: string
  scope?: { issuer: string; principalId: string; sessionId: string; deviceId: string; workspaceId: string; expiresAt: number }
  ciphertextContainsTitle?: boolean; configurationContainsTitle?: boolean; ciphertextContainsActiveToken: boolean
  bindingTokenDigest?: string; activeTokenDigest?: string
}

// Read-only test child: decrypt structured intents through the same strict
// encrypted journal port as main; the credential manager's public token reader
// deliberately rejects JSON credential values. JWT/key
// never leave this process. This is independent readback, not a queue mutation
// or an injected storage/transport implementation.
if (process.argv.includes('--intent-readback')) {
  const profile = process.env.ROX_CONFIG_DIR
  if (!profile?.includes('rox-wp01-electron-offline-')) throw new Error('Owned offline profile required')
  const { localWorkspaceId } = JSON.parse(await Bun.stdin.text()) as { localWorkspaceId: string }
  const { getCredentialManager } = await import('@rox/shared/credentials')
  const { createAuthorityJournalPorts } = await import('../../../apps/electron/src/main/project-authority-journal')
  const { PROJECT_CREATE_INTENT_CREDENTIAL_NAME, PROJECT_CREATE_BINDING_CREDENTIAL_NAME } = await import('../../../apps/electron/src/main/project-create-intent')
  const { PROJECT_AUTHORITY_CREDENTIAL_NAME } = await import('../../../apps/electron/src/shared/project-authority')
  const manager = getCredentialManager()
  const ports = await createAuthorityJournalPorts(manager)
  const slot = (name: string) => ({ type: 'service_oauth' as const, workspaceId: localWorkspaceId, name })
  const pending = await ports.credentials.get(slot(PROJECT_CREATE_INTENT_CREDENTIAL_NAME))
  const binding = await ports.credentials.get(slot(PROJECT_CREATE_BINDING_CREDENTIAL_NAME))
  const active = await manager.get(slot(PROJECT_AUTHORITY_CREDENTIAL_NAME))
  const parsed = pending ? JSON.parse(pending.value) : null
  const verified = binding ? JSON.parse(binding.value) : null
  const ciphertext = await readFile(join(profile, 'credentials.enc'))
  const configuration = await readFile(join(profile, 'config.json'))
  const title = parsed?.command?.payload?.name
  const result: IntentReadback = {
    present: !!pending,
    ...(pending ? { tokenType: pending.tokenType, pendingValueSha256: digest(pending.value),
      command: parsed.command, commandSha256: digest(JSON.stringify(parsed.command)), state: parsed.state, code: parsed.code,
      tokenDigest: parsed.binding.tokenDigest, scope: parsed.binding.scope,
      ciphertextContainsTitle: typeof title === 'string' && ciphertext.includes(Buffer.from(title)),
      configurationContainsTitle: typeof title === 'string' && configuration.includes(Buffer.from(title)) } : {}),
    ...(verified ? { bindingTokenDigest: verified.tokenDigest } : {}),
    ...(active ? { activeTokenDigest: digest(active.value) } : {}),
    ciphertextContainsActiveToken: !!active && ciphertext.includes(Buffer.from(active.value)),
  }
  console.log(JSON.stringify(result))
  process.exit(0)
}

if (process.argv.includes('--private-http-readback')) {
  const profile = process.env.ROX_CONFIG_DIR
  if (!profile?.includes('rox-wp01-electron-offline-')) throw new Error('Owned offline profile required')
  const { localWorkspaceId, entityId } = JSON.parse(await Bun.stdin.text()) as { localWorkspaceId: string; entityId: string }
  const { getCredentialManager } = await import('@rox/shared/credentials')
  const { loadStoredConfig } = await import('@rox/shared/config')
  const { PROJECT_AUTHORITY_CREDENTIAL_NAME, requireProjectAuthorityConfiguration } = await import('../../../apps/electron/src/shared/project-authority')
  const workspace = loadStoredConfig()?.workspaces.find(value => value.id === localWorkspaceId)
  const authority = requireProjectAuthorityConfiguration(workspace?.projectAuthority)
  const token = await getCredentialManager().get({ type: 'service_oauth', workspaceId: localWorkspaceId, name: PROJECT_AUTHORITY_CREDENTIAL_NAME })
  if (!token || !/^project:[0-9a-f-]{36}$/.test(entityId)) throw new Error('Actual profile authority required')
  const response = await fetch(authority.url.replace(/^ws/, 'http') + 'v1/workspaces/' + authority.workspaceId + '/projects/' + entityId.slice('project:'.length),
    { headers: { Authorization: 'Bearer ' + token.value }, signal: AbortSignal.timeout(10_000) })
  console.log(JSON.stringify({ status: response.status, value: await response.json() }))
  process.exit(0)
}

async function until(check: () => Promise<boolean>, label: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for ' + label)
}
async function route(page: Page, path: string): Promise<void> {
  await page.evaluate(value => window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: value }, bubbles: true })), path)
}
async function fingerprints(): Promise<{ source: Record<string, string>; built: Record<string, string> }> {
  const source = [
    'tests/macro-integration/ui/wp-01-offline-electron.test.ts', 'tests/macro-integration/ui/wp-01-electron.test.ts',
    'apps/electron/src/main/index.ts', 'apps/electron/src/main/shell-env.ts',
    'apps/electron/src/main/project-authority.ts', 'apps/electron/src/main/project-authority-journal.ts',
    'apps/electron/src/main/project-create-intent.ts', 'apps/electron/src/shared/project-create-intent.ts',
    'apps/electron/src/shared/project-authority.ts', 'apps/electron/src/shared/types.ts',
    'apps/electron/src/preload/bootstrap.ts', 'apps/electron/src/transport/client.ts',
    'apps/electron/src/transport/routed-client.ts', 'apps/electron/src/transport/channel-map.ts',
    'apps/electron/src/transport/project-authority-connection.ts', 'apps/electron/src/shared/remote-tls-client-options.ts',
    'apps/electron/src/renderer/atoms/projects.ts', 'apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx',
    'apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx',
    'apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx', 'apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx',
    'apps/electron/src/renderer/components/app-shell/AppShell.tsx', 'apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx',
    'apps/electron/src/renderer/pages/ProjectInfoPage.tsx', 'apps/electron/src/renderer/pages/ConnectionsPage.tsx',
    'apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx', 'apps/electron/src/renderer/contexts/NavigationContext.tsx',
    'packages/shared/src/config/storage.ts', 'packages/shared/src/credentials/manager.ts',
    'packages/shared/src/credentials/backends/secure-storage.ts', 'packages/shared/src/credentials/envelope.ts',
    'packages/shared/src/projects/storage.ts', 'packages/shared/src/workspace-domain/identity/contracts.ts',
    'packages/shared/src/toolchain/manifest.ts', 'packages/shared/src/toolchain/manifest-data.ts',
    'packages/shared/src/toolchain/manager.ts', 'packages/shared/src/toolchain/resolver.ts', 'packages/shared/src/toolchain/types.ts',
    'packages/server-core/src/transport/server.ts', 'packages/server-core/src/transport/client.ts', 'packages/shared/src/i18n/locales/ru.json',
  ]
  async function walk(directory: string) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = directory + '/' + entry.name
      if (entry.isDirectory()) await walk(path)
      else if (/\.(ts|sql)$/.test(path)) source.push(path)
    }
  }
  await walk('apps/workspace-service/src'); await walk('apps/workspace-service/migrations')
  const built = ['apps/electron/dist/main.cjs', 'apps/electron/dist/bootstrap-preload.cjs', 'apps/electron/dist/renderer/index.html']
  for (const name of await readdir(join(root, 'apps/electron/dist/renderer/assets'))) if (/\.(js|css)$/.test(name)) built.push('apps/electron/dist/renderer/assets/' + name)
  const hash = async (paths: string[]) => Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async path => [path, digest(await readFile(join(root, path)))])))
  return { source: await hash(source), built: await hash(built) }
}

describe.skipIf(process.env.ROX_WP01_OFFLINE_PRODUCT_E2E !== '1')('WP01 actual native encrypted offline create intent', () => {
  test('two real profiles: outage draft, queued/uncertain restart, explicit same-key retry, cancel and revoked/new-session privacy fences', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rox-wp01-electron-offline-'))
    const evidence = process.env.ROX_WP01_OFFLINE_EVIDENCE_DIR ?? join(homedir(), 'Pictures/Shots/Agents', 'rox-wp01-offline-electron-' + Date.now())
    await mkdir(evidence, { recursive: true })
    const schema = 'wp01_native_offline_' + randomBytes(6).toString('hex')
    const issuer = 'urn:rox:wp01:native-offline:' + randomUUID()
    const audience = 'rox-wp01-native-offline-acceptance'
    const password = 'owned-offline-password-' + randomUUID()
    const workspaceA = randomUUID(), workspaceB = randomUUID()
    const workspaceNameA = 'Нативная автономная область A', workspaceNameB = 'Нативная автономная область B'
    const names = { apply: 'Приватный офлайн проект A ' + randomUUID(), cancel: 'Отменённый офлайн проект B ' + randomUUID(), revoked: 'Скрытый draft старой сессии A ' + randomUUID() }
    const secrets = [password]
    const redact = (text: string) => secrets.reduce((value, secret) => value.split(secret).join('[redacted synthetic credential]'), text)
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted JWT]')
    const profiles: NativeProfile[] = []
    const shots: { name: string; path: string; sha256: string }[] = []
    const errors: { profile: string; message: string }[] = [], consoleErrors: { profile: string; message: string }[] = []
    const nativeLog: { profile: string; text: string }[] = []
    const serviceRequests: { at: string; channel: string; args: unknown[] }[] = []
    const before = await fingerprints()
    const revision = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const inputRevision = (await new Response(revision.stdout).text()).trim()
    expect(await revision.exited).toBe(0)
    const observed: Record<string, unknown> = { status: 'RUNNING', directory, evidence, schema, issuer, inputRevision,
      sourceSha256: before.source, builtSha256: before.built, screenshots: shots, errors, consoleErrors, nativeLog, actualServiceRequests: serviceRequests,
      fullFeatureDoDComplete: false, proofLevel: 'actual Electron forms / encrypted native backend / composed HTTP+WS / PostgreSQL' }
    const stage = (value: string) => { observed.stage = value; console.log('WP01 offline native stage: ' + value) }
    let database: SQL | undefined, service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
    let port = 0
    const configuration = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents/state/rox-compound-workspace/postgres-environment.json')
    const databaseUrl = await loadProtectedWorkspaceDatabaseUrl(configuration)
    secrets.push(databaseUrl)
    const migrations = await loadWorkspaceBootstrapMigrations(join(root, 'apps/workspace-service/migrations'))
    const record = (key: string, value: unknown) => ((observed[key] ??= []) as unknown[]).push(value)
    const childJson = async (path: string, args: string[], env: Record<string, string | undefined>, input?: unknown) => {
      const child = Bun.spawn([process.execPath, path, ...args], { cwd: root, env: { ...env, ROX_WP01_PRODUCT_E2E: undefined, ROX_WP01_OFFLINE_PRODUCT_E2E: undefined },
        ...(input === undefined ? {} : { stdin: new Blob([JSON.stringify(input)]) }), stdout: 'pipe', stderr: 'pipe' })
      const runtimePreparation = args.length === 1 && args[0] === '--verify-runtime-clone'
      const timeoutMs = runtimePreparation ? RUNTIME_PREPARATION_TIMEOUT_MS : HELPER_TIMEOUT_MS
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
      try {
        const [output, error] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
        const exitCode = await child.exited
        if (exitCode !== 0) throw new Error('Actual owned helper failed: ' + JSON.stringify({
          helper: runtimePreparation ? 'pinned-runtime-verification' : 'profile-readback',
          exitCode, timedOut, timeoutMs, diagnostic: redact(error),
        }))
        const lastLine = output.trim().split('\n').at(-1)
        if (!lastLine) throw new Error('Actual owned helper returned no receipt')
        return JSON.parse(lastLine)
      } finally { clearTimeout(timeout) }
    }
    const prepare = async (label: string): Promise<NativeProfile> => {
      const profile = join(directory, label), bin = join(profile, 'bin')
      await mkdir(bin, { recursive: true, mode: 0o700 })
      for (const [name, path] of [['bun', process.execPath], ['node', '/opt/homebrew/bin/node'], ['sh', '/bin/sh'],
        ['env', '/usr/bin/env'], ['git', '/usr/bin/git'], ['uname', '/usr/bin/uname'], ['which', '/usr/bin/which']]) await symlink(path!, join(bin, name!))
      await writeFile(join(profile, '.bash_profile'), "export PATH='" + bin.replaceAll("'", "'\\''") + "'\n", { mode: 0o600 })
      const env = { PATH: bin, HOME: profile, SHELL: '/bin/bash', TMPDIR: tmpdir(), LANG: 'ru_RU.UTF-8', NODE_ENV: 'test',
        ROX_CONFIG_DIR: profile, ROX_USER_DATA_DIR: join(profile, 'chromium'), CRAFT_INSTANCE_NUMBER: label === 'A' ? '95' : '96',
        ROX_APP_NAME: 'ROX WP01 Offline ' + label, CRAFT_DEEPLINK_SCHEME: 'rox-wp01-offline-' + label.toLowerCase() }
      const cloned = await childJson(environmentHelper, ['--verify-runtime-clone'], { ...process.env, ROX_WP01_RUNTIME_PROFILE: profile })
      expect(cloned.ensureAllStateUnchanged).toBe(true); expect(cloned.downloads).toEqual([])
      await writeFile(join(evidence, label + '-runtime-clone.json'), JSON.stringify(cloned, null, 2))
      const seed = await childJson(environmentHelper, ['--seed-profile'], env, { label: 'Offline-' + label }) as Seed
      const shell = await childJson(environmentHelper, ['--verify-shell'], env)
      expect(shell.shell).toBe('/bin/bash'); expect(shell.securityPaths).toEqual([])
      record('isolatedEnvironment', { label, profile, shell, runtimeCloneSha256: digest(JSON.stringify(cloned)) })
      const target = { label, seed, env }; profiles.push(target); return target
    }
    const activate = async (target: NativeProfile) => {
      await target.app!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.show(); window.focus() })
      await target.page!.bringToFront(); await target.page!.waitForFunction(() => document.hasFocus())
    }
    const launch = async (target: NativeProfile) => {
      target.app = await _electron.launch({ executablePath: require('electron'), args: [join(root, 'apps/electron')], env: target.env, timeout: 60_000 })
      const log = (bytes: Buffer) => nativeLog.push({ profile: target.seed.profile, text: redact(String(bytes)) })
      target.app.process().stderr?.on('data', log); target.app.process().stdout?.on('data', log)
      target.page = await target.app.firstWindow(); target.page.setDefaultTimeout(30_000)
      target.page.on('pageerror', error => errors.push({ profile: target.seed.profile, message: redact(error.message) }))
      target.page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ profile: target.seed.profile, message: redact(message.text()) }) })
      await target.page.waitForLoadState('domcontentloaded'); await target.page.waitForFunction(() => !!window.electronAPI)
      if (!target.hasLaunched) {
        const name = target.page.locator('#onboarding-username'); await name.waitFor({ state: 'visible' }); await name.fill('Приёмка офлайн WP01')
        await target.page.getByRole('button', { name: 'Начать', exact: true }).click(); await name.waitFor({ state: 'hidden' })
      }
      const skip = target.page.getByRole('button', { name: 'Пропустить', exact: true })
      await skip.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      if (await skip.isVisible()) await skip.click()
      await target.page.getByRole('navigation', { name: 'Main navigation', exact: true }).first().waitFor()
      target.hasLaunched = true
      const runtime = await target.app.evaluate(() => {
        const { existsSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
        const { join, delimiter } = process.getBuiltinModule('node:path') as typeof import('node:path')
        return { versions: process.versions, pid: process.pid, shell: process.env.SHELL,
          securityPaths: (process.env.PATH ?? '').split(delimiter).map(path => join(path, 'security')).filter(path => existsSync(path)) }
      })
      expect(runtime.shell).toBe('/bin/bash'); expect(runtime.securityPaths).toEqual([]); record('nativeProcessStarts', { label: target.label, ...runtime })
      await activate(target)
    }
    const close = async (target: NativeProfile) => { await target.app?.close(); target.app = undefined; target.page = undefined }
    const captureCounts = new Map<string, number>()
    const capture = async (target: NativeProfile, proposed: string) => {
      await activate(target)
      const count = (captureCounts.get(proposed) ?? 0) + 1; captureCounts.set(proposed, count)
      const name = proposed + (count > 1 ? '-' + count : '')
      const path = join(evidence, name + '.png')
      await target.page!.screenshot({ path, animations: 'disabled', caret: 'hide' })
      shots.push({ name, path, sha256: digest(await readFile(path)) })
      await writeFile(join(evidence, name + '.txt'), redact(await target.page!.locator('body').innerText()))
      await writeFile(join(evidence, name + '.html'), redact(await target.page!.locator('body').innerHTML()))
    }
    const intent = async (target: NativeProfile) => target.page!.evaluate(id => window.electronAPI.getSharedProjectCreateIntent(id), target.seed.localWorkspaceId) as Promise<IntentView>
    const readback = async (target: NativeProfile) => childJson(import.meta.path, ['--intent-readback'], target.env, { localWorkspaceId: target.seed.localWorkspaceId }) as Promise<IntentReadback>
    const credential = async (target: NativeProfile) => childJson(environmentHelper, ['--credential-readback'], target.env, { localWorkspaceId: target.seed.localWorkspaceId })
    const startService = async () => {
      service = await createWorkspaceServer({ database: database!, schema, migrations, host: '127.0.0.1', port, serverId: 'wp01-offline-' + schema,
        authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience,
          stateDirectory: join(directory, 'issuer'), checkoutDirectory: root, tokenLifetimeSeconds: 900 } } })
      await service.server.listen(); port = service.server.port
      const sockets = (service.server as unknown as { wss: WebSocketServer }).wss
      if (!sockets) throw new Error('Actual WS listener missing')
      sockets.on('connection', socket => socket.on('message', bytes => {
        const value = JSON.parse(bytes.toString())
        if (value.type === 'request' && value.channel?.startsWith('domain.project.')) serviceRequests.push({ at: new Date().toISOString(), channel: value.channel, args: value.args })
      }))
    }
    const stopService = async () => {
      service!.server.close(); service = undefined
      await until(async () => { try { await fetch('http://127.0.0.1:' + port + '/.well-known/jwks.json', { signal: AbortSignal.timeout(1000) }); return false } catch { return true } }, 'actual owned listener closed')
      record('serviceStops', { port, closedPortVerified: true })
    }
    const counts = async () => {
      const [row] = await database!.unsafe(`SELECT (SELECT count(*)::int FROM "${schema}".project) AS projects,
        (SELECT count(*)::int FROM "${schema}".project_create_receipt) AS receipts,
        (SELECT count(*)::int FROM "${schema}".project_event WHERE type='project.created') AS events`)
      return { projects: row!.projects, receipts: row!.receipts, events: row!.events }
    }
    const creates = () => serviceRequests.filter(request => request.channel === 'domain.project.createShared')
    const connect = async (target: NativeProfile, owner: Owner, workspaceId: string, workspaceName: string, wrongPassword = false) => {
      await activate(target); await route(target.page!, 'connections'); await target.page!.getByTestId('project-authority-connection').waitFor()
      for (const [id, value] of [['project-authority-url', 'http://127.0.0.1:' + port], ['project-authority-workspace', workspaceId],
        ['project-authority-workspace-name', workspaceName], ['project-authority-login', owner.login], ['project-authority-password', wrongPassword ? 'genuine-wrong-password' : password]]) await target.page!.getByTestId(id!).fill(value!)
      const button = target.page!.getByTestId('project-authority-connect'); await button.focus(); await button.press('Enter')
      if (wrongPassword) {
        await target.page!.getByTestId('project-authority-error').waitFor()
        expect(await target.page!.getByTestId('project-authority-error').getAttribute('data-error-code')).toBe('UNAUTHENTICATED')
      } else await until(() => target.page!.evaluate(async () => await window.electronAPI.getProjectAuthorityState() === 'ready'), 'real native Connections sign-in')
      await until(async () => await target.page!.getByTestId('project-authority-password').inputValue() === '', 'password cleared after actual native login')
      await capture(target, target.label + '-Connections-' + (wrongPassword ? 'wrong-password' : 'signed-in'))
    }
    const projects = async (target: NativeProfile) => { await activate(target); await route(target.page!, 'projects'); await target.page!.locator('[data-project-authority-state]').waitFor() }
    const queued = async (target: NativeProfile, expected: Command, state: 'queued' | 'uncertain') => {
      await projects(target)
      const box = target.page!.getByTestId('shared-project-queued'); await box.waitFor()
      await until(async () => await box.getAttribute('data-state') === state, 'actual ' + state + ' projection')
      expect(await box.getAttribute('data-command-id')).toBe(expected.commandId)
      expect(await box.getAttribute('data-idempotency-key')).toBe(expected.idempotencyKey)
      expect(await box.innerText()).toContain(expected.payload.name)
      expect(await target.page!.getByTestId('shared-project-create-open').isDisabled()).toBe(true)
      expect(await intent(target)).toEqual({ state, eligible: true, command: expected })
    }
    const hit = async (target: NativeProfile, locator: Locator, label: string) => {
      await activate(target); await locator.scrollIntoViewIfNeeded()
      const geometry = await locator.evaluate(element => {
        const rect = element.getBoundingClientRect(), found = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, viewportWidth: innerWidth,
          actualHitTarget: found === element || element.contains(found), documentFocused: document.hasFocus() }
      })
      expect(geometry.actualHitTarget).toBe(true); expect(geometry.documentFocused).toBe(true)
      expect(geometry.width).toBeGreaterThan(20); expect(geometry.height).toBeGreaterThan(20)
      expect(geometry.x).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1)
      record('actionGeometry', { label, profile: target.label, ...geometry })
    }
    const submitOffline = async (target: NativeProfile, title: string, alreadyOpen = false): Promise<Command> => {
      if (!alreadyOpen) {
        await projects(target)
        await until(async () => await target.page!.getByTestId('shared-project-create-open').isEnabled(), 'main verified offline scope permits create')
        const open = target.page!.getByTestId('shared-project-create-open'); await hit(target, open, target.label + '-offline-open'); await open.focus(); await open.press('Enter')
        await target.page!.getByTestId('shared-project-create-dialog').waitFor(); await target.page!.getByTestId('shared-project-name').fill(title)
      }
      expect(await target.page!.getByTestId('shared-project-name').inputValue()).toBe(title)
      expect(await target.page!.getByTestId('shared-project-name').getAttribute('maxlength')).toBe('10000')
      expect(await target.page!.getByTestId('shared-project-visibility').inputValue()).toBe('private')
      await capture(target, target.label + '-offline-reviewed-form')
      const submit = target.page!.getByTestId('shared-project-create-submit'); await hit(target, submit, target.label + '-offline-submit'); await submit.focus(); await submit.press('Enter')
      await target.page!.getByTestId('shared-project-queued').waitFor()
      const view = await intent(target)
      expect(view.state).toBe('queued'); expect(view.eligible).toBe(true)
      if (view.state !== 'queued') throw new Error('Actual offline enqueue did not return queued')
      expect(view.command.payload).toEqual({ name: title, workspaceName: target.label === 'A' ? workspaceNameA : workspaceNameB, visibility: 'private' })
      expect(view.command.workspaceId).toBe(target.label === 'A' ? workspaceA : workspaceB)
      expect(view.command.schemaVersion).toBe(2); expect(view.command.commandId).toBeTruthy(); expect(view.command.idempotencyKey).toBeTruthy()
      expect(Object.keys(view).sort()).toEqual(['command', 'eligible', 'state'])
      await queued(target, view.command, 'queued'); await capture(target, target.label + '-native-queued')
      return view.command
    }
    const encryption = async (target: NativeProfile, command: Command, owner: Owner) => {
      const stored = await readback(target), active = await credential(target)
      expect(stored.present).toBe(true); expect(stored.tokenType).toBe('ROX_PROJECT_CREATE_INTENT_V1')
      expect(stored.command).toEqual(command); expect(stored.commandSha256).toBe(digest(JSON.stringify(command)))
      expect(stored.scope?.issuer).toBe(issuer); expect(stored.scope?.principalId).toBe(owner.principalId)
      expect(stored.scope?.workspaceId).toBe(command.workspaceId); expect(stored.scope?.sessionId).toBe(active.sessionId)
      expect(stored.tokenDigest).toBe(active.tokenSha256); expect(stored.bindingTokenDigest).toBe(active.tokenSha256)
      expect(stored.activeTokenDigest).toBe(active.tokenSha256)
      expect(stored.ciphertextContainsTitle).toBe(false); expect(stored.configurationContainsTitle).toBe(false)
      expect(stored.ciphertextContainsActiveToken).toBe(false)
      expect((await stat(join(target.seed.profile, 'credentials.enc'))).mode & 0o777).toBe(0o600)
      expect((await stat(join(target.seed.profile, 'credentials.key'))).mode & 0o777).toBe(0o600)
      record('encryptedIntentReadbacks', { label: target.label, ...stored }); return stored
    }
    const localBoundary = async (target: NativeProfile) => {
      const local = await target.page!.evaluate(id => window.electronAPI.getProjects(id), target.seed.localWorkspaceId) as { config: { id: string; name: string }; folderPath: string; assetsPath: string }[]
      expect(local).toHaveLength(1); expect(local[0]!.config.id).toBe(target.seed.localProjectId); expect(local[0]!.config.name).toBe(target.seed.localProjectName)
      expect(local[0]!.folderPath).toBe(target.seed.localProjectFolder); expect(local[0]!.assetsPath).toBe(target.seed.localProjectAssets)
      expect(digest(await readFile(join(local[0]!.folderPath, 'config.json')))).toBe(target.seed.localProjectConfigSha256)
      expect(digest(await readFile(join(local[0]!.assetsPath, 'kept.txt')))).toBe(target.seed.localAssetSha256)
      expect((await readdir(join(target.seed.workspaceRoot, 'projects'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)).toEqual([target.seed.localProjectSlug])
      for (const name of Object.values(names)) expect(JSON.stringify(local)).not.toContain(name)
    }
    const projectionPixels = async (target: NativeProfile, name: string) => {
      await activate(target)
      const section = target.page!.locator('[data-project-authority-state]'), path = join(evidence, name + '.png')
      const png = await section.screenshot({ path, animations: 'disabled', caret: 'hide' })
      shots.push({ name, path, sha256: digest(png) })
      const text = await section.innerText(); await writeFile(join(evidence, name + '.txt'), redact(text))
      const pixels = await target.page!.evaluate(async encoded => {
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0)), image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
        const sha = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data); image.close()
        return { width: canvas.width, height: canvas.height, rgbaSha256: Array.from(new Uint8Array(sha), value => value.toString(16).padStart(2, '0')).join('') }
      }, png.toString('base64'))
      return { text, pixels }
    }
    try {
      stage('real-isolated-service-and-two-accounts')
      database = new SQL(databaseUrl); await database.unsafe(`CREATE SCHEMA "${schema}"`); await startService()
      const account = async (label: string): Promise<Owner> => {
        const login = label + '-' + randomUUID() + '@example.invalid'
        const provisioned = await service!.identity.provisionAccount(login, password)
        return { login, principalId: provisioned.principalId }
      }
      const ownerA = await account('A'), ownerB = await account('B')
      await service!.repository.provisionWorkspace(ownerA.principalId, workspaceA, workspaceNameA)
      await service!.repository.provisionWorkspace(ownerB.principalId, workspaceB, workspaceNameB)
      const jwks = await (await fetch('http://127.0.0.1:' + port + '/.well-known/jwks.json')).json()
      expect(await counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
      stage('genuine-pinned-runtime-two-native-sign-ins')
      const a = await prepare('A'), b = await prepare('B')
      await launch(a); await launch(b); await connect(a, ownerA, workspaceA, workspaceNameA); await connect(b, ownerB, workspaceB, workspaceNameB)
      stage('actual-outage-preserves-open-private-draft-and-enqueues-without-send')
      await projects(a); await a.page!.locator('[data-project-authority-state="ready"]').waitFor()
      await a.page!.getByTestId('shared-project-create-open').focus(); await a.page!.getByTestId('shared-project-create-open').press('Enter')
      await a.page!.getByTestId('shared-project-create-dialog').waitFor(); await a.page!.getByTestId('shared-project-name').fill(names.apply)
      await stopService()
      await until(() => a.page!.evaluate(async () => ['connecting', 'unavailable'].includes(await window.electronAPI.getProjectAuthorityState())), 'real native outage state')
      await until(async () => await a.page!.getByTestId('shared-project-create-submit').isEnabled(), 'offline draft remains eligible')
      expect(await a.page!.getByTestId('shared-project-create-dialog').isVisible()).toBe(true)
      expect(await a.page!.getByTestId('shared-project-name').inputValue()).toBe(names.apply)
      const commandA = await submitOffline(a, names.apply, true), commandB = await submitOffline(b, names.cancel)
      const storedA = await encryption(a, commandA, ownerA), storedB = await encryption(b, commandB, ownerB)
      expect(await counts()).toEqual({ projects: 0, receipts: 0, events: 0 }); expect(creates()).toEqual([])
      stage('queued-dark-light-200-percent-narrow-real-hit-and-keyboard')
      for (const mode of ['dark', 'light'] as const) {
        await route(a.page!, 'settings/appearance')
        const radio = a.page!.getByRole('radio', { name: mode === 'dark' ? 'Тёмная' : 'Светлая', exact: true }); await radio.waitFor(); await radio.focus(); await radio.press('Space')
        await a.page!.waitForFunction(value => document.documentElement.classList.contains('dark') === (value === 'dark'), mode)
        await queued(a, commandA, 'queued')
        await a.app!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setContentSize(980, 800); window.webContents.setZoomFactor(2) })
        expect(await a.app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBe(2)
        const box = a.page!.getByTestId('shared-project-queued')
        const geometry = await box.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, viewportWidth: innerWidth, text: element.textContent }))
        expect(geometry.viewportWidth).toBeLessThanOrEqual(500); expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1); expect(geometry.text).toContain(names.apply)
        const retry = a.page!.getByTestId('shared-project-queued-retry'), cancel = a.page!.getByTestId('shared-project-queued-cancel')
        await hit(a, retry, mode + '-200-percent-retry'); await hit(a, cancel, mode + '-200-percent-cancel')
        await retry.focus(); expect(await retry.evaluate(element => document.activeElement === element)).toBe(true)
        await retry.press('Tab'); expect(await cancel.evaluate(element => document.activeElement === element)).toBe(true)
        await cancel.press('Shift+Tab'); expect(await retry.evaluate(element => document.activeElement === element)).toBe(true)
        record('queuedVisualGeometry', { mode, zoomFactor: 2, ...geometry }); await capture(a, 'A-' + mode + '-200-percent-queued-keyboard')
        await a.app!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.webContents.setZoomFactor(1); window.setContentSize(1320, 850) })
      }
      stage('both-processes-cold-restart-offline-exact-queued-scope-and-keys')
      await close(a); await close(b); await launch(a); await launch(b)
      await queued(a, commandA, 'queued'); await queued(b, commandB, 'queued')
      expect(await readback(a)).toEqual(storedA); expect(await readback(b)).toEqual(storedB)
      await capture(a, 'A-cold-offline-queued'); await capture(b, 'B-cold-offline-queued')
      const retryOffline = a.page!.getByTestId('shared-project-queued-retry'); await hit(a, retryOffline, 'A-offline-real-retry'); await retryOffline.focus(); await retryOffline.press('Enter')
      await queued(a, commandA, 'uncertain'); const uncertain = await readback(a)
      expect(uncertain.command).toEqual(commandA); expect(uncertain.scope).toEqual(storedA.scope); expect(uncertain.state).toBe('uncertain')
      expect(await counts()).toEqual({ projects: 0, receipts: 0, events: 0 }); expect(creates()).toEqual([])
      await close(a); await launch(a); await queued(a, commandA, 'uncertain'); expect(await readback(a)).toEqual(uncertain)
      await capture(a, 'A-cold-offline-uncertain-same-key')
      stage('B-real-cancel-and-process-restart-preserve-zero-effects')
      const cancelB = b.page!.getByTestId('shared-project-queued-cancel'); await hit(b, cancelB, 'B-cancel-owned-intent'); await cancelB.focus(); await cancelB.press('Enter')
      await until(async () => (await intent(b)).state === 'none', 'B native cancel clears local intent')
      expect((await readback(b)).present).toBe(false); await close(b); await launch(b); await projects(b)
      expect((await intent(b)).state).toBe('none'); expect((await readback(b)).present).toBe(false)
      expect(await b.page!.getByTestId('shared-project-queued').count()).toBe(0); expect(await b.page!.locator('body').innerText()).not.toContain(names.cancel)
      expect(await counts()).toEqual({ projects: 0, receipts: 0, events: 0 }); await capture(b, 'B-cancel-persisted-offline-restart')
      stage('real-reconnect-never-auto-sends-explicit-original-key-applies-once')
      await startService(); expect(await (await fetch('http://127.0.0.1:' + port + '/.well-known/jwks.json')).json()).toEqual(jwks)
      for (const target of [a, b]) await until(() => target.page!.evaluate(async () => await window.electronAPI.getProjectAuthorityState() === 'ready'), 'real reconnect ready ' + target.label)
      await queued(a, commandA, 'uncertain')
      // A live authorized list response is the reconnect barrier; the pending
      // record must survive it and no CREATE frame/SQL transaction may occur.
      expect(requireSharedProjectPage(await a.page!.evaluate(id => window.electronAPI.getSharedProjects(id, {}), a.seed.localWorkspaceId)).items).toEqual([])
      expect(await counts()).toEqual({ projects: 0, receipts: 0, events: 0 }); expect(creates()).toEqual([])
      const retry = a.page!.getByTestId('shared-project-queued-retry'); await hit(a, retry, 'A-explicit-online-original-key-retry'); await retry.focus(); await retry.press('Enter')
      await a.page!.locator('[data-shared-project-detail="ready"]').waitFor()
      const [receipt] = await database.unsafe(`SELECT command_id,idempotency_key,request_hash,result FROM "${schema}".project_create_receipt`)
      const applied = requireSharedProjectResult(receipt!.result, commandA.commandId)
      expect(receipt!.command_id).toBe(commandA.commandId); expect(receipt!.idempotency_key).toBe(commandA.idempotencyKey)
      expect(receipt!.request_hash).toBe(createProjectRequestHash(commandA)); expect(applied.data.name).toBe(names.apply)
      expect(applied.data.entity.workspaceId).toBe(workspaceA); expect(applied.data.ownerPrincipalId).toBe(ownerA.principalId)
      expect(applied.entity.entityId).toMatch(/^project:[0-9a-f-]{36}$/)
      expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 }); expect(creates()).toHaveLength(1)
      expect(creates()[0]!.args).toEqual([workspaceA, commandA]); expect((await readback(a)).present).toBe(false)
      record('appliedReceipts', { originalCommand: commandA, receipt: applied, counts: await counts(), originalTransportRequest: creates()[0] })
      const nativeRetry = await a.page!.evaluate(id => window.electronAPI.retrySharedProjectCreate(id), a.seed.localWorkspaceId)
      expect(nativeRetry.state).toBe('none'); expect(creates()).toHaveLength(1)
      const duplicate = await a.page!.evaluate(({ id, command }) => window.electronAPI.createSharedProject(id, { ...command, workspaceId: id }), { id: a.seed.localWorkspaceId, command: commandA })
      expect(duplicate).toEqual(applied); expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
      record('sameKeyReceiptReplay', { exactOriginalReceipt: duplicate, counts: await counts() })
      await capture(a, 'A-explicit-retry-canonical-original-receipt')
      stage('actual-private-HTTP403-and-other-profile-no-title')
      await projects(b); await b.page!.locator('[data-project-authority-state="ready"]').waitFor()
      expect(await b.page!.locator('body').innerText()).not.toContain(names.apply)
      // B is now a real workspace member, still unauthorized for A's private Project.
      await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceA, ownerB.principalId])
      await connect(b, ownerB, workspaceA, workspaceNameA); await projects(b); await b.page!.locator('[data-project-authority-state="ready"]').waitFor()
      const listB = requireSharedProjectPage(await b.page!.evaluate(id => window.electronAPI.getSharedProjects(id, {}), b.seed.localWorkspaceId))
      expect(listB.items).toEqual([]); expect(JSON.stringify(listB)).not.toContain(names.apply)
      const privateHttp = await childJson(import.meta.path, ['--private-http-readback'], b.env,
        { localWorkspaceId: b.seed.localWorkspaceId, entityId: applied.entity.entityId })
      expect(privateHttp).toEqual({ status: 403, value: { error: { code: 'FORBIDDEN' } } })
      expect(JSON.stringify(privateHttp)).not.toContain(names.apply); record('actualPrivateHttpReadback', privateHttp)
      const privateBefore = await projectionPixels(b, 'B-private-before-rejected-get')
      const denied = await b.page!.evaluate(async ({ id, entityId }) => {
        try { await window.electronAPI.getSharedProject(id, { entityId }); return { rejected: false } }
        catch (error) { return { rejected: true, code: error && typeof error === 'object' && 'code' in error ? error.code : '', text: JSON.stringify(error) } }
      }, { id: b.seed.localWorkspaceId, entityId: applied.entity.entityId })
      expect(denied.rejected).toBe(true); expect(denied.code).toBe('FORBIDDEN'); expect(denied.text).not.toContain(names.apply)
      expect(await projectionPixels(b, 'B-private-after-rejected-get')).toEqual(privateBefore)
      stage('revoked-old-session-queued-intent-blocked-with-no-title')
      await projects(a); await stopService(); const revokedCommand = await submitOffline(a, names.revoked)
      const revokedStored = await encryption(a, revokedCommand, ownerA)
      await startService(); expect(await service!.identity.revokeSession(revokedStored.scope!.sessionId)).toBe(true)
      // Explicit main Retry revalidates real HTTP identity before outbound CREATE.
      const revokedRetry = a.page!.getByTestId('shared-project-queued-retry'); await hit(a, revokedRetry, 'A-revoked-session-explicit-retry'); await revokedRetry.focus(); await revokedRetry.press('Enter')
      await a.page!.getByTestId('shared-project-queued-blocked').waitFor()
      const blocked = await intent(a); expect(blocked).toEqual({ state: 'blocked', eligible: false, code: 'UNAUTHENTICATED' })
      expect(await a.page!.locator('body').innerText()).not.toContain(names.revoked); expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
      expect(creates().filter(request => (request.args[1] as Command)?.commandId === revokedCommand.commandId)).toEqual([])
      await capture(a, 'A-revoked-queue-hidden-no-write')
      stage('fresh-same-principal-and-B-replacement-cannot-revive-foreign-intent')
      await connect(a, ownerA, workspaceA, workspaceNameA); await projects(a); await a.page!.getByTestId('shared-project-queued-blocked').waitFor()
      const replacementA = await credential(a); expect(replacementA.sessionId).not.toBe(revokedStored.scope!.sessionId)
      const freshView = await intent(a); expect(freshView.state).toBe('blocked'); expect(freshView).not.toHaveProperty('command')
      expect(await a.page!.locator('body').innerText()).not.toContain(names.revoked); await capture(a, 'A-fresh-same-principal-session-cannot-revive-old-queue')
      await connect(a, ownerB, workspaceA, workspaceNameA); await projects(a); await a.page!.getByTestId('shared-project-queued-blocked').waitFor()
      const foreignView = await intent(a); expect(foreignView.state).toBe('blocked'); expect(foreignView).not.toHaveProperty('command')
      expect(await a.page!.locator('body').innerText()).not.toContain(names.revoked); expect(await a.page!.locator('body').innerText()).not.toContain(names.apply)
      const foreignBefore = await projectionPixels(a, 'A-now-B-blocked-before-foreign-scope-probe')
      const foreignLocal = await a.page!.evaluate(id => window.electronAPI.getSharedProjectCreateIntent(id), b.seed.localWorkspaceId)
      expect(foreignLocal.state).toBe('blocked'); expect(foreignLocal).not.toHaveProperty('command')
      expect(await projectionPixels(a, 'A-now-B-blocked-after-foreign-scope-probe')).toEqual(foreignBefore)
      expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
      const blockedCancel = a.page!.getByTestId('shared-project-queued-cancel'); await hit(a, blockedCancel, 'B-cancels-stale-local-intent-only'); await blockedCancel.focus(); await blockedCancel.press('Enter')
      await until(async () => (await intent(a)).state === 'none', 'blocked local intent explicitly cancelled')
      expect((await readback(a)).present).toBe(false); expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
      await capture(a, 'A-now-B-blocked-cancel-no-server-undo')
      stage('wrong-password-quiesces-live-eligible-scope-preserving-durable-bytes')
      const metadataBefore = await a.page!.evaluate(id => window.electronAPI.getProjectAuthorityConfiguration(id), a.seed.localWorkspaceId)
      const credentialBefore = await credential(a)
      await connect(a, ownerB, workspaceA, workspaceNameA, true)
      expect(await a.page!.evaluate(id => window.electronAPI.getProjectAuthorityConfiguration(id), a.seed.localWorkspaceId)).toEqual(metadataBefore)
      expect(await credential(a)).toEqual(credentialBefore)
      expect(await a.page!.evaluate(() => window.electronAPI.isChannelAvailable('domain.project.createShared'))).toBe(false)
      await projects(a); const quiesced = await intent(a); expect(quiesced).toEqual({ state: 'none', eligible: false })
      expect(await a.page!.getByTestId('shared-project-create-open').isDisabled()).toBe(true)
      expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 }); await capture(a, 'A-wrong-password-quiesced-no-old-scope-fallback')
      stage('final-host-boundary-and-source-build-equality')
      for (const target of [a, b]) await localBoundary(target)
      expect(await fingerprints()).toEqual(before); expect(errors).toEqual([])
      expect(nativeLog.filter(entry => /Uncaught exception|ENOSPC/.test(entry.text))).toEqual([])
      observed.consumerGatesVerified = { nativeOutageDraftPreserved: true, nativeOfflineQueue: true, encryptedExactScope: true,
        queuedAndUncertainColdRestart: true, noReconnectAutoSend: true, explicitOriginalKeyAppliedOnce: true, originalReceiptReplay: true,
        otherProfileCancelPersists: true, revokedSessionNoWrite: true, freshAndForeignSessionNoTitle: true, wrongPasswordNoLiveFallback: true,
        privateDeniedDecodedPixelsAndTextUnchanged: true, localFoldersPreserved: true, darkLight200PercentKeyboard: true }
      observed.status = 'PASS_NATIVE_WP01_OFFLINE_CONSUMER'
    } catch (error) {
      observed.status = 'FAIL'; observed.error = redact(error instanceof Error ? error.message : String(error))
      observed.errorStack = redact(error instanceof Error ? error.stack ?? '' : '')
      for (const target of profiles) if (target.page) await capture(target, 'failure-' + target.label).catch(() => {})
      throw new Error(String(observed.error))
    } finally {
      for (const target of profiles) await close(target).catch(() => {})
      service?.server.close()
      if (database) { await database.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {}); await database.close() }
      observed.finishedAt = new Date().toISOString()
      await writeFile(join(evidence, 'result.json'), JSON.stringify(observed, null, 2))
      console.log('WP01 offline native evidence: ' + join(evidence, 'result.json'))
    }
  }, NATIVE_PROFILES * RUNTIME_PREPARATION_TIMEOUT_MS + NATIVE_SCENARIO_TIMEOUT_MS)
})
