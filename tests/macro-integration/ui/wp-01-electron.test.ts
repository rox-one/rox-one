import { describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, readlink, realpath, lstat, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { decodeJwt } from 'jose'
import type { WebSocketServer } from 'ws'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../../apps/workspace-service/src/auth/postgres-identity'
import { PROJECT_AUTHORITY_NAME_MAX_LENGTH, PROJECT_AUTHORITY_LOGIN_MAX_LENGTH, PROJECT_AUTHORITY_PASSWORD_MAX_LENGTH,
  requireSharedProject, requireSharedProjectPage } from '../../../apps/electron/src/shared/project-authority'
import { SHARED_PROJECT_TEXT_MAX_LENGTH, type SharedProject } from '../../../packages/shared/src/workspace-domain/identity/contracts'
import { parseCreateSharedProject } from '../../../apps/workspace-service/src/modules/identity/commands'
import { TOOLCHAIN_MANIFEST, currentPlatform, toolchainPaths } from '../../../packages/shared/src/toolchain/manifest'
import { TOOLCHAIN_INSTALL_COMPLETE_MARKER, type ToolchainStateFile } from '../../../packages/shared/src/toolchain/types'
import { createResolver } from '../../../packages/shared/src/toolchain/resolver'
import { createManager } from '../../../packages/shared/src/toolchain/manager'

// Explicit opt-in. This lane never builds the product or configures the user's
// profile. It exercises production Electron, credential encryption and the
// composed PostgreSQL authority. Sign-in and CREATE use the shipped native
// Connections/Projects forms. API/SQL reads verify their actual effects.
const root = resolve(import.meta.dir, '../../..')
const protectedDatabaseConfiguration = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

interface Seed {
  profile: string
  localWorkspaceId: string
  workspaceRoot: string
  localProjectId: string
  localProjectSlug: string
  localProjectFolder: string
  localProjectAssets: string
  localProjectName: string
  localProjectConfigSha256: string
  localAssetSha256: string
}
interface SeedInput { label: string }
interface NativeProfile { seed: Seed; env: Record<string, string>; app?: ElectronApplication; page?: Page; hasLaunched?: boolean }
interface Account { login: string; principalId: string; token: string; expiresAt: number; sessionId: string }

// Clone genuine pinned runtime installations into the owned fixture. Core
// tools always participate in ensureAll; the disabled preference only excludes
// default-on tools. No marker is synthesized and no host profile is mutated.
async function clonePinnedRuntime(profile: string) {
  if (!profile.includes('rox-wp01-electron-') || process.platform !== 'darwin') throw new Error('Owned macOS fixture required')
  const sourceRoot = join(homedir(), '.rox', 'toolchain')
  const sourceStateBytes = await readFile(join(sourceRoot,'state.json'))
  const sourceState = JSON.parse(sourceStateBytes.toString()) as ToolchainStateFile
  const paths = toolchainPaths(profile)
  const copied: ToolchainStateFile = {tools:{}}
  const proof: Record<string,unknown>[] = []
  async function tree(directory: string) {
    directory = await realpath(directory)
    const checksum = createHash('sha256')
    let files = 0, bytes = 0, links = 0
    const relocatedAbsoluteLinks: {path:string;sourceTarget:string;fixtureTarget:string}[] = []
    async function walk(path: string) {
      const metadata = await lstat(path)
      const name = relative(directory,path)
      if (metadata.isSymbolicLink()) {
        const target = await readlink(path)
        const resolvedTarget = await realpath(path)
        const bound = relative(directory,resolvedTarget)
        if (bound === '..' || bound.startsWith('../') || isAbsolute(bound)) throw new Error('Runtime symlink escapes pinned tree: '+name)
        // uv's genuine patch-version alias uses an absolute internal link.
        // Relocate that link to the identical copied target; file bytes and
        // all existing relative links remain exact, and record this adjustment.
        const normalizedTarget = isAbsolute(target) ? relative(dirname(path),resolvedTarget) : target
        if (isAbsolute(target)) relocatedAbsoluteLinks.push({path:name,sourceTarget:target,fixtureTarget:normalizedTarget})
        checksum.update(JSON.stringify([name,'link',metadata.mode & 0o7777,normalizedTarget])+'\n'); links++
      } else if (metadata.isDirectory()) {
        checksum.update(JSON.stringify([name,'directory',metadata.mode & 0o7777])+'\n')
        for (const entry of (await readdir(path)).sort()) await walk(join(path,entry))
      } else if (metadata.isFile()) {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(path)) hash.update(chunk)
        checksum.update(JSON.stringify([name,'file',metadata.mode & 0o7777,metadata.size,hash.digest('hex')])+'\n')
        files++; bytes += metadata.size
      } else throw new Error('Unsupported runtime file: '+name)
    }
    await walk(directory)
    return {sha256:checksum.digest('hex'),files,bytes,links,relocatedAbsoluteLinks}
  }
  await mkdir(paths.toolchainDir,{recursive:true,mode:0o700})
  for (const entry of TOOLCHAIN_MANIFEST.filter(item=>(item.tier ?? 'core') === 'core')) {
    const artifact = entry.artifacts[currentPlatform()]
    if (!artifact) continue
    const installed = sourceState.tools[entry.name]
    const source = join(sourceRoot,entry.name,entry.version)
    if (!installed || installed.installedVersion !== entry.version || await realpath(installed.installedPath) !== await realpath(source)) throw new Error('Genuine pinned runtime unavailable: '+entry.name)
    const marker = artifact.archive === 'uv-python' ? null : await readFile(join(source,TOOLCHAIN_INSTALL_COMPLETE_MARKER),'utf8')
    if (marker !== null && marker !== entry.name+'@'+entry.version+'\n') throw new Error('Actual completion marker mismatch: '+entry.name)
    const sourceTree = await tree(source)
    const destination = join(paths.toolchainDir,entry.name,entry.version)
    await mkdir(join(paths.toolchainDir,entry.name),{recursive:true})
    // APFS clonefile keeps physical disk use bounded while producing separate
    // writable copies. No hardlink/shared mutable cache or fallback copy.
    const clone = Bun.spawn(['/bin/cp','-cRp',source,destination],{stdout:'pipe',stderr:'pipe'})
    const diagnostic = await new Response(clone.stderr).text()
    if (await clone.exited !== 0) throw new Error('Actual APFS runtime clone failed: '+diagnostic)
    for (const link of sourceTree.relocatedAbsoluteLinks) {
      const path = join(destination,link.path)
      if (await readlink(path) !== link.sourceTarget) throw new Error('Copied runtime alias differs: '+link.path)
      await unlink(path)
      await symlink(link.fixtureTarget,path)
    }
    const destinationTree = await tree(destination)
    if (sourceTree.sha256 !== destinationTree.sha256 || sourceTree.files !== destinationTree.files || sourceTree.bytes !== destinationTree.bytes || sourceTree.links !== destinationTree.links || destinationTree.relocatedAbsoluteLinks.length) throw new Error('Runtime byte/mode/link proof mismatch: '+entry.name)
    await symlink(entry.version,join(paths.toolchainDir,entry.name,'current'))
    copied.tools[entry.name] = {...installed,installedPath:destination}
    const executables = []
    const realDestination = await realpath(destination)
    for (const bin of artifact.binPaths) {
      const actual = join(destination,bin)
      const resolved = await realpath(actual)
      if (!resolved.startsWith(realDestination+'/') || ((await stat(actual)).mode & 0o111) === 0) throw new Error('Runtime executable not isolated: '+entry.name)
      executables.push({path:bin,realpath:resolved,sha256:digest(await readFile(actual))})
    }
    proof.push({name:entry.name,version:entry.version,source,destination,sourceTree,destinationTree,completionMarker:marker,executables})
  }
  if (!sourceStateBytes.equals(await readFile(join(sourceRoot,'state.json')))) throw new Error('Host runtime state changed during clone')
  await writeFile(paths.stateFile,JSON.stringify(copied,null,2),{mode:0o600,flag:'wx'})
  const resolver = createResolver(paths)
  const resolvedExecutables = []
  for (const entry of TOOLCHAIN_MANIFEST.filter(item=>copied.tools[item.name])) {
    const executable = await resolver.findExecutable(entry.name)
    if (!executable?.startsWith(paths.toolchainDir+'/')) throw new Error('Production resolver missed cloned runtime: '+entry.name)
    resolvedExecutables.push({name:entry.name,executable})
  }
  const manager = createManager(paths,{disabledTools:TOOLCHAIN_MANIFEST.map(entry=>entry.name)})
  const snapshot = await manager.status()
  for (const entry of TOOLCHAIN_MANIFEST.filter(item=>copied.tools[item.name])) {
    const status = snapshot.find(item=>item.name===entry.name)
    if (status?.phase !== 'ready') throw new Error('Production manager rejected runtime clone: '+entry.name+' '+JSON.stringify(status))
  }
  const stateBeforeEnsure = await readFile(paths.stateFile)
  const ensured = await manager.ensureAll({background:false})
  await manager.ensureIdle()
  if (!stateBeforeEnsure.equals(await readFile(paths.stateFile))) throw new Error('Actual ensureAll modified cloned runtime state')
  let downloads: string[] = []
  try {downloads = await readdir(paths.downloadsDir)} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error}
  if (downloads.length) throw new Error('Actual ensureAll downloaded despite genuine pinned runtime')
  return {sourceStateSha256:digest(sourceStateBytes),fixtureStateSha256:digest(stateBeforeEnsure),cloneMethod:'/bin/cp -cRp (APFS clonefile)',tools:proof,resolvedExecutables,actualProductionManagerSnapshot:snapshot,actualEnsureAllSnapshot:ensured,ensureAllStateUnchanged:true,downloads}
}

if (process.argv.includes('--verify-runtime-clone')) {
  const profile = process.env.ROX_WP01_RUNTIME_PROFILE
  if (!profile) throw new Error('Owned runtime verification profile required')
  console.log(JSON.stringify(await clonePinnedRuntime(profile)))
  process.exit(0)
}

async function isolatedSeed(): Promise<void> {
  const profile = process.env.ROX_CONFIG_DIR
  if (!profile || !profile.includes('rox-wp01-electron-')) throw new Error('Explicit isolated WP01 profile required')
  const input = JSON.parse(await Bun.stdin.text()) as SeedInput
  const config = await import('@craft-agent/shared/config')
  const workspaces = await import('@craft-agent/shared/workspaces')
  const projects = await import('@craft-agent/shared/projects')
  // security is genuinely absent from the isolated PATH. Production v3 falls
  // back to its real mode-0600 credentials.key file, without a provider mock,
  // binary shim or any change to the host's OS keychain search/default list.
  config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null,
    setupDeferred: true, defaultZoomLevel: 100, notificationsEnabled: false,
    memory: { enabled: false, semantic: false },
    // Genuine supported preference excludes default-on tools. Core tools are
    // always required and are separately cloned from actual pinned installs.
    toolchain: { disabled: TOOLCHAIN_MANIFEST.map(entry => entry.name) } })
  const workspaceRoot = join(profile, 'workspaces', 'native-' + input.label)
  const folder = workspaces.createWorkspaceAtPath(workspaceRoot, 'Приёмка WP01 ' + input.label,
    { workingDirectory: workspaceRoot }, { id: 'wp01-' + input.label, slug: 'native-' + input.label, kind: 'personal' })
  await workspaces.saveWorkspaceConfig(workspaceRoot, folder)
  const local = config.addWorkspace({ name: folder.name, rootPath: workspaceRoot, kind: 'personal' })
  const stored = config.loadStoredConfig()!
  stored.activeWorkspaceId = local.id
  config.saveConfig(stored)
  const localProjectName = 'Настоящая локальная папка ' + input.label
  const project = projects.createProject(workspaceRoot, { name: localProjectName, workingDirectory: workspaceRoot })
  const loaded = projects.loadWorkspaceProjects(workspaceRoot).find(item => item.config.id === project.id)!
  const asset = 'Существующий локальный файл: байты должны сохраниться.\n'
  await writeFile(join(loaded.assetsPath,'kept.txt'),asset)
  console.log(JSON.stringify({ profile, localWorkspaceId: local.id, workspaceRoot, localProjectName,
    localProjectId: project.id, localProjectSlug: project.slug, localProjectFolder: loaded.folderPath,
    localProjectAssets: loaded.assetsPath, localProjectConfigSha256:digest(await readFile(join(loaded.folderPath,'config.json'))),
    localAssetSha256:digest(asset) } satisfies Seed))
}

if (process.argv.includes('--seed-profile')) {
  await isolatedSeed()
  process.exit(0)
}

if (process.argv.includes('--verify-shell')) {
  const profile = process.env.ROX_CONFIG_DIR
  if (!profile?.includes('rox-wp01-electron-')) throw new Error('Owned shell verification profile required')
  const { loadShellEnv } = await import('../../../apps/electron/src/main/shell-env')
  const { existsSync } = await import('node:fs')
  const { delimiter } = await import('node:path')
  const { getToolchainDisabled } = await import('@craft-agent/shared/config')
  loadShellEnv()
  const securityPaths = (process.env.PATH ?? '').split(delimiter).map(directory => join(directory,'security')).filter(path => existsSync(path))
  if (process.env.SHELL !== '/bin/bash' || securityPaths.length) throw new Error('Actual login shell reintroduced security')
  console.log(JSON.stringify({ shell:process.env.SHELL, path:process.env.PATH, securityPaths,
    disabledTools:getToolchainDisabled(), actualProductionShellLoader:true }))
  process.exit(0)
}

if (process.argv.includes('--credential-readback')) {
  const profile = process.env.ROX_CONFIG_DIR
  if (!profile?.includes('rox-wp01-electron-')) throw new Error('Owned credential readback profile required')
  const { localWorkspaceId } = JSON.parse(await Bun.stdin.text()) as { localWorkspaceId: string }
  const { getCredentialManager } = await import('@craft-agent/shared/credentials')
  const { PROJECT_AUTHORITY_CREDENTIAL_NAME } = await import('../../../apps/electron/src/shared/project-authority')
  const credential = await getCredentialManager().get({ type: 'service_oauth', workspaceId: localWorkspaceId, name: PROJECT_AUTHORITY_CREDENTIAL_NAME })
  // Only nonsecret readback leaves this child; JWT and key never enter evidence.
  console.log(JSON.stringify(credential ? { present: true, tokenType: credential.tokenType,
    tokenSha256: digest(credential.value), sessionId: decodeJwt(credential.value).sid, expiresAt: credential.expiresAt,
    ciphertextContainsToken: (await readFile(join(profile,'credentials.enc'))).includes(Buffer.from(credential.value)),
    configurationContainsToken: (await readFile(join(profile,'config.json'),'utf8')).includes(credential.value) } : { present: false }))
  process.exit(0)
}

async function hashes(): Promise<Record<string, string>> {
  const files = [
    'apps/electron/src/main/index.ts', 'apps/electron/src/main/project-authority.ts',
    'apps/electron/src/main/shell-env.ts', 'packages/shared/src/toolchain-runtime.ts',
    'packages/shared/src/toolchain/manifest.ts', 'packages/shared/src/toolchain/manifest-data.ts',
    'packages/shared/src/toolchain/manager.ts', 'packages/shared/src/toolchain/resolver.ts',
    'packages/shared/src/toolchain/types.ts',
    'apps/electron/src/shared/project-authority.ts', 'apps/electron/src/shared/types.ts',
    'apps/electron/src/preload/bootstrap.ts', 'apps/electron/src/transport/routed-client.ts',
    'apps/electron/src/transport/client.ts', 'apps/electron/src/shared/remote-tls-client-options.ts',
    'apps/electron/src/transport/project-authority-connection.ts', 'apps/electron/src/transport/channel-map.ts',
    'apps/electron/src/transport/build-api.ts', 'apps/electron/src/renderer/atoms/projects.ts',
    'apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx',
    'apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx',
    'apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx',
    'apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx',
    'apps/electron/src/renderer/components/app-shell/AppShell.tsx',
    'apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx',
    'apps/electron/src/renderer/pages/ProjectInfoPage.tsx', 'apps/electron/src/renderer/pages/ConnectionsPage.tsx',
    'apps/electron/src/renderer/contexts/NavigationContext.tsx',
    'apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx',
    'packages/core/src/types/workspace.ts', 'packages/shared/src/config/storage.ts',
    'packages/shared/src/credentials/manager.ts', 'packages/shared/src/credentials/backends/secure-storage.ts',
    'packages/shared/src/projects/storage.ts', 'packages/shared/src/workspace-domain/identity/contracts.ts',
    'packages/server-core/src/transport/server.ts', 'packages/server-core/src/transport/client.ts',
    'packages/shared/src/i18n/locales/ru.json', 'tests/macro-integration/ui/wp-01-electron.test.ts',
  ]
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = directory + '/' + entry.name
      if (entry.isDirectory()) await walk(path)
      else if (path.endsWith('.ts') || path.endsWith('.sql')) files.push(path)
    }
  }
  files.push('apps/workspace-service/src/server.ts','apps/workspace-service/src/http.ts',
    'apps/workspace-service/migrations/01-domain-contract.sql','apps/workspace-service/migrations/01-local-auth-bootstrap.sql')
  for (const directory of ['apps/workspace-service/src/auth','apps/workspace-service/src/database','apps/workspace-service/src/modules/identity']) await walk(directory)
  return Object.fromEntries(await Promise.all(files.sort().map(async path => [path, digest(await readFile(join(root, path)))])))
}

async function builtHashes(): Promise<Record<string, string>> {
  const files = ['apps/electron/dist/main.cjs', 'apps/electron/dist/bootstrap-preload.cjs', 'apps/electron/dist/renderer/index.html']
  for (const name of await readdir(join(root, 'apps/electron/dist/renderer/assets'))) {
    if (name.endsWith('.js') || name.endsWith('.css')) files.push('apps/electron/dist/renderer/assets/' + name)
  }
  return Object.fromEntries(await Promise.all(files.sort().map(async path => [path, digest(await readFile(join(root, path)))])))
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
  await page.evaluate(value => window.dispatchEvent(new CustomEvent('craft-agent-navigate',
    { detail: { route: value }, bubbles: true })), path)
}

describe.skipIf(process.env.ROX_WP01_PRODUCT_E2E !== '1')('WP01 genuine Electron + composed PostgreSQL authority', () => {
  test('two native profiles: canonical private projects, no disclosure, persistence/restart/revocation, host folders and visual consumers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rox-wp01-electron-'))
    const evidence = process.env.ROX_WP01_EVIDENCE_DIR || join(homedir(), 'Pictures/Shots/Agents', 'rox-wp01-electron-' + Date.now())
    await mkdir(evidence, { recursive: true })
    const schema = 'wp01_electron_' + randomBytes(6).toString('hex')
    const issuer = 'urn:rox:wp01:electron:' + randomUUID()
    const audience = 'rox-wp01-native-acceptance'
    const workspaceA = randomUUID()
    const workspaceB = randomUUID()
    const password = 'owned-synthetic-password-' + randomUUID()
    const secrets = [password]
    const redact = (value: string) => secrets.reduce((text, secret) => text.split(secret).join('[redacted synthetic credential]'), value)
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted JWT]')
    const shots: { name: string; path: string; sha256: string }[] = []
    const captureCounts = new Map<string, number>()
    const errors: { profile: string; message: string }[] = []
    const consoleErrors: { profile: string; message: string }[] = []
    const nativeLog: { profile: string; text: string }[] = []
    const sourceSha256 = await hashes()
    const artifactSha256 = await builtHashes()
    const head = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const inputRevision = (await new Response(head.stdout).text()).trim()
    expect(await head.exited).toBe(0)
    const observed: Record<string, unknown> = { level: 'native-electron-postgres-projection', inputRevision,
      sourceSha256, builtSha256: artifactSha256, directory, schema, screenshots: shots, errors, consoleErrors, nativeLog,
      requiredFullFeatureConsumerGates: ['Actual Connections service endpoint/login configuration', 'Actual Projects shared-create form'],
      createProofLevel: 'Actual native Projects form → production API → composed PostgreSQL service' }
    const stage = (value: string) => { observed.stage = value; console.log('WP01 native acceptance stage: ' + value) }
    let database: SQL | undefined
    let service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
    const profiles: NativeProfile[] = []
    let port = 0
    const serviceRequests: { at: string; requestId: string; channel: string; args: unknown[] }[] = []
    observed.actualServiceRequests = serviceRequests
    const databaseUrl = await loadProtectedWorkspaceDatabaseUrl(protectedDatabaseConfiguration)
    secrets.push(databaseUrl)
    const migrations = await loadWorkspaceBootstrapMigrations(join(root, 'apps/workspace-service/migrations'))
    const startService = async () => {
      if (!database) throw new Error('Missing isolated database connection')
      service = await createWorkspaceServer({ database, schema, migrations, host: '127.0.0.1', port,
        serverId: 'wp01-native-' + schema,
        authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience,
          stateDirectory: join(directory, 'issuer'), checkoutDirectory: root, tokenLifetimeSeconds: 900 } } })
      await service.server.listen()
      port = service.server.port
      // Read-only observation of actual installed server sockets. Original
      // listeners, messages, credentials and handlers remain unchanged.
      const sockets = (service.server as unknown as { wss: WebSocketServer }).wss
      if (!sockets) throw new Error('Actual composed server WebSocket listener absent')
      sockets.on('connection', socket => socket.on('message', bytes => {
        const message = JSON.parse(bytes.toString())
        if (message.type === 'request' && typeof message.channel === 'string' && message.channel.startsWith('domain.project.')) {
          serviceRequests.push({ at: new Date().toISOString(), requestId: message.id, channel: message.channel, args: message.args })
        }
      }))
    }
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const response = await fetch('http://127.0.0.1:' + port + path, { method, headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const text = await response.text()
      return { status: response.status, text, value: JSON.parse(text) }
    }
    const account = async (label: string): Promise<Account> => {
      const login = label + '-' + randomUUID() + '@example.invalid'
      const provisioned = await service!.identity.provisionAccount(login, password)
      return { login, principalId: provisioned.principalId, token: '', expiresAt: 0, sessionId: '' }
    }
    const authenticate = async (value: Account) => {
      const signed = await call('POST', '/v1/auth/local/token', undefined, { login: value.login, password })
      expect(signed.status).toBe(200)
      expect(typeof signed.value.token).toBe('string')
      expect(typeof signed.value.expiresAt).toBe('number')
      value.token = signed.value.token; value.expiresAt = signed.value.expiresAt
      const claims = decodeJwt(value.token)
      expect(typeof claims.sid).toBe('string')
      value.sessionId = claims.sid as string
      secrets.push(value.token)
    }
    const prepareProfile = async (label: string): Promise<NativeProfile> => {
      const profile = join(directory, label)
      const bin = join(profile, 'bin')
      await mkdir(bin, { recursive: true, mode: 0o700 })
      await symlink(process.execPath, join(bin, 'bun'))
      // Exposing real executables individually keeps security absent from PATH;
      // default credential fallback remains product implementation.
      for (const [name, path] of [['node','/opt/homebrew/bin/node'], ['sh','/bin/sh'], ['env','/usr/bin/env'],
        ['git','/usr/bin/git'], ['uname','/usr/bin/uname'], ['which','/usr/bin/which']]) {
        await symlink(path!, join(bin, name!))
      }
      // Production loadShellEnv reloads a real login shell. Give that shell an
      // owned profile so it retains the restricted executable inventory rather
      // than silently importing /usr/bin/security through the system profile.
      await writeFile(join(profile,'.bash_profile'), "export PATH='" + bin.replaceAll("'", "'\\''") + "'\n", { mode: 0o600 })
      const env = { PATH: bin, HOME: profile, SHELL: '/bin/bash', TMPDIR: tmpdir(), LANG: 'ru_RU.UTF-8', NODE_ENV: 'test',
        ROX_CONFIG_DIR: profile, ROX_USER_DATA_DIR: join(profile, 'chromium'),
        CRAFT_INSTANCE_NUMBER: label === 'A' ? '93' : '94', ROX_APP_NAME: 'ROX WP01 ' + label,
        CRAFT_DEEPLINK_SCHEME: 'rox-wp01-' + label.toLowerCase() }
      const runtimeClone = await clonePinnedRuntime(profile)
      ;((observed.runtimeCloneProofs ??= []) as unknown[]).push({profile,...runtimeClone})
      await writeFile(join(evidence,label+'-runtime-clone-proof.json'),JSON.stringify(runtimeClone,null,2))
      const child = Bun.spawn([process.execPath, import.meta.path, '--seed-profile'], { cwd: root, env,
        stdin: new Blob([JSON.stringify({ label } satisfies SeedInput)]), stdout: 'pipe', stderr: 'pipe' })
      const output = await new Response(child.stdout).text()
      const diagnostic = await new Response(child.stderr).text()
      if (await child.exited !== 0) throw new Error('Owned profile setup failed: ' + redact(diagnostic))
      const seed = JSON.parse(output.trim().split('\n').at(-1)!) as Seed
      const shellProbe = Bun.spawn([process.execPath, import.meta.path, '--verify-shell'], { cwd:root,env,
        stdout:'pipe',stderr:'pipe' })
      const shellOutput = await new Response(shellProbe.stdout).text()
      const shellDiagnostic = await new Response(shellProbe.stderr).text()
      if (await shellProbe.exited !== 0) throw new Error('Actual isolated login shell verification failed: ' + redact(shellDiagnostic + shellOutput))
      const shellReadback = JSON.parse(shellOutput.trim().split('\n').at(-1)!)
      expect(shellReadback.securityPaths).toEqual([])
      expect(shellReadback.disabledTools.length).toBeGreaterThan(0)
      ;((observed.isolatedEnvironmentReadbacks ??= []) as unknown[]).push({ profile,...shellReadback })
      const target: NativeProfile = { seed, env }; profiles.push(target)
      return target
    }
    const activate = async (target: NativeProfile) => {
      await target.app!.evaluate(({BrowserWindow}) => { const window = BrowserWindow.getAllWindows()[0]!; window.show(); window.focus() })
      await target.page!.bringToFront()
      await target.page!.waitForFunction(() => document.hasFocus())
    }
    const capture = async (target: NativeProfile, name: string) => {
      await activate(target)
      const count = (captureCounts.get(name) ?? 0) + 1
      captureCounts.set(name, count)
      if (count > 1) name += '-capture-' + count
      const path = join(evidence, name + '.png')
      await target.page!.screenshot({ path, animations: 'disabled', caret: 'hide' })
      shots.push({ name, path, sha256: digest(await readFile(path)) })
      await writeFile(join(evidence, name + '.txt'), redact(await target.page!.locator('body').innerText()))
      await writeFile(join(evidence, name + '.html'), redact(await target.page!.locator('body').innerHTML()))
    }
    const verifyPointerTarget = async (target: NativeProfile, button: Locator, label: string) => {
      await activate(target)
      await button.waitFor()
      const geometry = await button.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return { x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
          actualHitTarget:hit === element || element.contains(hit),hitRole:hit?.getAttribute('role'),
          hitAriaLabel:hit?.getAttribute('aria-label'),focusedDocument:document.hasFocus() }
      })
      ;((observed.pointerGeometry ??= []) as unknown[]).push({ label,profile:target.seed.profile,...geometry })
      expect(geometry.focusedDocument).toBe(true)
      expect(geometry.actualHitTarget).toBe(true)
      expect(geometry.width).toBeGreaterThan(20)
      expect(geometry.height).toBeGreaterThan(20)
    }
    const projectionPixels = async (target: NativeProfile, name: string) => {
      await activate(target)
      const section = target.page!.locator('[data-project-authority-state="ready"]')
      const path = join(evidence,name + '.png')
      const png = await section.screenshot({path,animations:'disabled',caret:'hide'})
      shots.push({name,path,sha256:digest(png)})
      const text = await section.innerText()
      await writeFile(join(evidence,name + '.txt'),redact(text))
      const pixels = await target.page!.evaluate(async encoded => {
        const bytes = Uint8Array.from(atob(encoded),character => character.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes],{type:'image/png'}))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap,0,0)
        const rgba = context.getImageData(0,0,bitmap.width,bitmap.height).data
        const hash = await crypto.subtle.digest('SHA-256',rgba)
        bitmap.close()
        return {width:canvas.width,height:canvas.height,pixelSha256:Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')}
      },png.toString('base64'))
      return {text,pixels}
    }
    const launch = async (target: NativeProfile) => {
      target.app = await _electron.launch({ executablePath: require('electron'), args: [join(root,'apps/electron')],
        env: target.env, timeout: 60_000 })
      target.app.process().stderr?.on('data', bytes => nativeLog.push({ profile: target.seed.profile, text: redact(String(bytes)) }))
      target.app.process().stdout?.on('data', bytes => nativeLog.push({ profile: target.seed.profile, text: redact(String(bytes)) }))
      target.page = await target.app.firstWindow()
      target.page.setDefaultTimeout(30_000)
      target.page.on('pageerror', error => errors.push({ profile: target.seed.profile, message: redact(error.message) }))
      target.page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ profile: target.seed.profile, message: redact(message.text()) }) })
      await target.page.waitForLoadState('domcontentloaded')
      await target.page.waitForFunction(() => !!window.electronAPI)
      const name = target.page.locator('#onboarding-username')
      // A bridge being ready does not mean React has mounted Welcome yet.
      // Newly seeded profiles must complete the real first-run form; a saved
      // profile must instead reach the real shell before a route is dispatched.
      if (!target.hasLaunched) {
        await name.waitFor({ state: 'visible' })
        await name.fill('Приёмка WP01')
        await target.page.getByRole('button', { name: 'Начать', exact: true }).click()
        await name.waitFor({ state: 'hidden' })
      }
      const skip = target.page.getByRole('button', { name: 'Пропустить', exact: true })
      await skip.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      if (await skip.isVisible()) await skip.click()
      await target.page.getByRole('navigation', { name: 'Main navigation', exact: true }).first().waitFor()
      await route(target.page, 'connections')
      await target.page.getByTestId('project-authority-connection').waitFor()
      target.hasLaunched = true
      const runtime = await target.app.evaluate(() => {
        const { existsSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
        const { join, delimiter } = process.getBuiltinModule('node:path') as typeof import('node:path')
        const securityPaths = (process.env.PATH ?? '').split(delimiter).map(directory => join(directory,'security')).filter(path => existsSync(path))
        return { versions: process.versions, platform: process.platform, arch: process.arch,
          shell: process.env.SHELL, path: process.env.PATH, securityPaths }
      })
      expect(runtime.shell).toBe('/bin/bash')
      expect(runtime.securityPaths).toEqual([])
      ;((observed.runtime ??= []) as unknown[]).push({ profile: target.seed.profile, ...runtime })
    }
    const close = async (target: NativeProfile) => { await target.app?.close(); target.app = undefined; target.page = undefined }
    const credentialReadback = async (target: NativeProfile) => {
      const child = Bun.spawn([process.execPath, import.meta.path, '--credential-readback'], { cwd: root, env: target.env,
        stdin: new Blob([JSON.stringify({ localWorkspaceId: target.seed.localWorkspaceId })]), stdout: 'pipe', stderr: 'pipe' })
      const output = await new Response(child.stdout).text(); const error = await new Response(child.stderr).text()
      if (await child.exited !== 0) throw new Error('Owned encrypted credential readback failed: ' + redact(error))
      return JSON.parse(output.trim().split('\n').at(-1)!) as { present: boolean; tokenType?: string; tokenSha256?: string; sessionId?: string; expiresAt?: number;
        ciphertextContainsToken?: boolean; configurationContainsToken?: boolean }
    }
    const connect = async (target: NativeProfile, owner: Account, workspaceId: string, workspaceName: string, denied = false) => {
      await activate(target)
      await route(target.page!, 'connections')
      const form = target.page!.getByTestId('project-authority-connection')
      await form.waitFor()
      const maximums = []
      for (const [id, maximum] of [['project-authority-workspace-name',10000],['project-authority-login',320],['project-authority-password',4096]] as const) {
        const input = target.page!.getByTestId(id)
        expect(await input.getAttribute('maxlength')).toBe(String(maximum))
        expect(await input.evaluate(element=>(element as HTMLInputElement).maxLength)).toBe(maximum)
        maximums.push({id,attribute:maximum,actualInputMaxLength:maximum})
      }
      ;((observed.nativeConnectionInputMaximums ??= []) as unknown[]).push({profile:target.seed.profile,maximums})
      const previousMetadata = await target.page!.evaluate(id => window.electronAPI.getProjectAuthorityConfiguration(id),target.seed.localWorkspaceId)
      const previousCredential = await credentialReadback(target)
      for (const [id, value] of [['project-authority-url','http://127.0.0.1:' + port], ['project-authority-workspace',workspaceId],
        ['project-authority-workspace-name',workspaceName], ['project-authority-login',owner.login], ['project-authority-password',password]]) {
        await target.page!.getByTestId(id!).fill(value!)
      }
      const button = target.page!.getByTestId('project-authority-connect')
      await button.focus(); expect(await button.evaluate(element => element === document.activeElement)).toBe(true)
      await button.press('Enter')
      if (denied) {
        const error = target.page!.getByTestId('project-authority-error')
        await error.waitFor()
        expect(await error.getAttribute('data-error-code')).toBe('FORBIDDEN')
        expect(await error.innerText()).toContain('403')
        expect(await target.page!.evaluate(() => window.electronAPI.isChannelAvailable('domain.project.get'))).toBe(false)
        // A rejected replacement quiesces the live authority but preserves the
        // exact prior valid durable metadata/credential until explicit logout.
        const retained = await target.page!.evaluate(id => window.electronAPI.getProjectAuthorityConfiguration(id), target.seed.localWorkspaceId)
        expect(retained).toEqual(previousMetadata)
        expect(await credentialReadback(target)).toEqual(previousCredential)
        ;((observed.deniedLoginReadbacks ??= []) as unknown[]).push({ priorMetadata:previousMetadata, retained,
          retainedCredential:previousCredential, liveDomainChannelAvailable:false, actualHttpStatus:403 })
      } else {
        await until(() => target.page!.evaluate(async () => await window.electronAPI.getProjectAuthorityState() === 'ready'), 'actual UI login dials native authority')
        const metadata = await target.page!.evaluate(id => window.electronAPI.getProjectAuthorityConfiguration(id), target.seed.localWorkspaceId)
        expect(metadata).toEqual({ url:'ws://127.0.0.1:' + port + '/', workspaceId, workspaceName })
        expect(Object.keys(metadata!).sort()).toEqual(['url','workspaceId','workspaceName'])
        const readback = await credentialReadback(target)
        expect(readback.present).toBe(true); expect(readback.tokenType).toBe('Bearer'); expect(readback.sessionId).toBeTruthy()
        expect((await stat(join(target.seed.profile,'credentials.key'))).mode & 0o777).toBe(0o600)
        expect((await stat(join(target.seed.profile,'credentials.enc'))).mode & 0o777).toBe(0o600)
        expect(readback.ciphertextContainsToken).toBe(false)
        expect(readback.configurationContainsToken).toBe(false)
        ;((observed.uiLoginReadbacks ??= []) as unknown[]).push({ profile:target.seed.profile, metadata, credential:readback })
      }
      await until(async () => await target.page!.getByTestId('project-authority-password').inputValue() === '', 'actual login clears password')
      await capture(target, target.seed.profile.endsWith('/A') ? 'A-native-Connections-login' : denied ? 'B-native-Connections-403-quiesced-live-preserved-durable' : 'B-native-Connections-login')
    }
    const assertHostBoundary = async (target: NativeProfile, excluded: string[]) => {
      await route(target.page!, 'projects')
      await target.page!.locator('[data-list-role="projects"]').waitFor()
      const local = await target.page!.evaluate(id => window.electronAPI.getProjects(id), target.seed.localWorkspaceId) as { config: { id: string; name: string }; folderPath: string; assetsPath: string }[]
      expect(local).toHaveLength(1)
      expect(local[0]!.config.id).toBe(target.seed.localProjectId)
      expect(local[0]!.config.name).toBe(target.seed.localProjectName)
      expect(local[0]!.folderPath).toBe(target.seed.localProjectFolder)
      expect(local[0]!.assetsPath).toBe(target.seed.localProjectAssets)
      expect((await stat(local[0]!.folderPath)).isDirectory()).toBe(true)
      expect((await stat(local[0]!.assetsPath)).isDirectory()).toBe(true)
      const directories = (await readdir(join(target.seed.workspaceRoot,'projects'),{withFileTypes:true})).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
      expect(directories).toEqual([target.seed.localProjectSlug])
      expect(digest(await readFile(join(local[0]!.folderPath,'config.json')))).toBe(target.seed.localProjectConfigSha256)
      expect(digest(await readFile(join(local[0]!.assetsPath,'kept.txt')))).toBe(target.seed.localAssetSha256)
      for (const forbidden of excluded) expect(JSON.stringify(local)).not.toContain(forbidden)
      expect(await target.page!.locator('[data-list-role="projects"]').innerText()).toContain(target.seed.localProjectName)
      return { localProjectId: local[0]!.config.id, folderPath: local[0]!.folderPath, assetsPath: local[0]!.assetsPath }
    }
    const create = async (target: NativeProfile, name: string, visibility: 'private' | 'members', ime = false) => {
      await activate(target)
      await route(target.page!, 'projects')
      await target.page!.locator('[data-project-authority-state="ready"]').waitFor()
      const start = serviceRequests.length
      const open = target.page!.getByTestId('shared-project-create-open')
      expect(await open.isEnabled()).toBe(true)
      await open.focus(); await open.press('Enter')
      await target.page!.getByTestId('shared-project-create-dialog').waitFor()
      expect(await target.page!.getByTestId('shared-project-visibility').inputValue()).toBe('private')
      const nameInput = target.page!.getByTestId('shared-project-name')
      expect(await nameInput.getAttribute('maxlength')).toBe('10000')
      expect(await nameInput.evaluate(element=>(element as HTMLInputElement).maxLength)).toBe(SHARED_PROJECT_TEXT_MAX_LENGTH)
      if (ime) {
        // Playwright inserts through Chromium's input machinery. Test the real
        // maxlength boundary before native IME; don't assign DOM.value or emit
        // synthetic composition/keyboard events.
        await nameInput.fill('я'.repeat(SHARED_PROJECT_TEXT_MAX_LENGTH+1))
        expect(await nameInput.inputValue()).toBe('я'.repeat(SHARED_PROJECT_TEXT_MAX_LENGTH))
        await nameInput.fill('')
        await nameInput.evaluate(element => {
          const input = element as HTMLInputElement & {__wp01InputEvents:unknown[]}
          input.__wp01InputEvents = []
          for (const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input','keydown','keyup']) {
            input.addEventListener(type,event => {
              const value = event as KeyboardEvent & InputEvent & CompositionEvent
              input.__wp01InputEvents.push({type:event.type,isTrusted:event.isTrusted,isComposing:value.isComposing ?? null,
                key:value.key ?? null,inputType:value.inputType ?? null,data:value.data ?? null,value:input.value})
            },{passive:true})
          }
        })
        await nameInput.focus()
        const session = await target.page!.context().newCDPSession(target.page!)
        try {
          await session.send('Input.imeSetComposition',{text:name,selectionStart:name.length,selectionEnd:name.length})
          await until(async()=>await nameInput.inputValue()===name,'actual Chromium IME candidate in native name field')
          await capture(target,'A-native-name-active-IME-composition')
          await nameInput.press('Enter')
          await target.page!.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
          const composingEvents = await nameInput.evaluate(element=>(element as HTMLInputElement & {__wp01InputEvents:Record<string,unknown>[]}).__wp01InputEvents)
          expect(composingEvents.some(event=>event.type==='compositionstart' && event.isTrusted===true)).toBe(true)
          expect(composingEvents.some(event=>event.type==='keydown' && event.key==='Enter' && event.isComposing===true && event.isTrusted===true)).toBe(true)
          expect(await target.page!.getByTestId('shared-project-create-dialog').isVisible()).toBe(true)
          expect(serviceRequests.slice(start).filter(item=>item.channel==='domain.project.createShared')).toEqual([])
          const beforeCommitRows = await database!.unsafe(`SELECT count(*)::integer AS count FROM "${schema}".project_create_receipt`)
          expect(beforeCommitRows[0]!.count).toBe(0)
          // Chromium may commit the candidate on Enter. Otherwise its real IME
          // insertText operation commits the active candidate, never a mock.
          if (!composingEvents.some(event=>event.type==='compositionend')) await session.send('Input.insertText',{text:name})
          await until(async()=>await nameInput.inputValue()===name,'committed exact native IME name')
          const committedEvents = await nameInput.evaluate(element=>(element as HTMLInputElement & {__wp01InputEvents:Record<string,unknown>[]}).__wp01InputEvents)
          expect(committedEvents.some(event=>event.type==='compositionend' && event.isTrusted===true)).toBe(true)
          observed.nativeImeNameEntry = {method:'actual Chromium Input.imeSetComposition + trusted Enter + native commit',
            name,composingEvents,committedEvents,createRequestsWhileComposing:0,receiptRowsBeforeCommit:beforeCommitRows[0]!.count,
            nativeMaximum:SHARED_PROJECT_TEXT_MAX_LENGTH,browserTruncatedOverMaximum:true}
        } finally {await session.detach()}
      } else await nameInput.fill(name)
      if (visibility === 'members') await target.page!.getByTestId('shared-project-visibility').selectOption('members')
      await capture(target, 'create-reviewed-' + digest(name).slice(0,8))
      await target.page!.getByTestId('shared-project-create-submit').focus()
      await target.page!.getByTestId('shared-project-create-submit').press('Enter')
      await target.page!.locator('[data-shared-project-detail="ready"]').waitFor()
      const list = requireSharedProjectPage(await target.page!.evaluate(id => window.electronAPI.getSharedProjects(id,{}), target.seed.localWorkspaceId))
      expect(list.items.filter(item => item.name === name)).toHaveLength(1)
      const project = list.items.find(item => item.name === name)!
      const receipts = await database!.unsafe(`SELECT result FROM "${schema}".project_create_receipt WHERE workspace_id=$1 AND project_id=$2`,
        [project.entity.workspaceId,project.entity.entityId.slice('project:'.length)])
      expect(receipts).toHaveLength(1)
      const actual = receipts[0]!.result
      expect(actual.status).toBe('applied')
      expect(actual.receiptId).toBeTruthy()
      expect(requireSharedProject(actual.data)).toEqual(project)
      expect(project.entity.entityId).toMatch(/^project:[0-9a-f-]{36}$/)
      expect(project.name).toBe(name)
      expect(project.visibility).toBe(visibility)
      for (const key of ['folderPath','assetsPath','workspaceRootPath']) expect(project).not.toHaveProperty(key)
      const requests = serviceRequests.slice(start).filter(item => item.channel === 'domain.project.createShared')
      expect(requests).toHaveLength(1)
      expect((requests[0]!.args[1] as { commandId: string }).commandId).toBe(actual.commandId)
      expect(requests[0]!.args[0]).toBe(project.entity.workspaceId)
      ;((observed.createReceipts ??= []) as unknown[]).push({ proofLevel: 'actual native Projects form', requests, actual })
      return project
    }
    const details = async (target: NativeProfile, project: SharedProject) => {
      await activate(target)
      await route(target.page!, 'projects')
      const button = target.page!.locator('[data-project-authority-state] button').filter({ hasText: project.name }).first()
      await button.waitFor(); await button.focus(); await button.press('Enter')
      const panel = target.page!.locator('[data-shared-project-detail="ready"]')
      await panel.waitFor()
      expect(await panel.innerText()).toContain(project.name)
      expect(await panel.innerText()).toContain(project.entity.entityId)
      expect(await panel.innerText()).toContain(project.entity.workspaceId)
      expect(await panel.innerText()).toContain(project.revision)
      return panel
    }
    try {
      stage('isolated-postgres-and-accounts')
      database = new SQL(databaseUrl)
      await database.unsafe(`CREATE SCHEMA "${schema}"`)
      await startService()
      const ownerA = await account('A'); const ownerB = await account('B')
      await service!.repository.provisionWorkspace(ownerA.principalId, workspaceA, 'Нативная область A')
      await service!.repository.provisionWorkspace(ownerB.principalId, workspaceB, 'Нативная область B')
      await authenticate(ownerA); await authenticate(ownerB)
      stage('real-max-input-schema-and-http-no-write-boundary')
      expect(SHARED_PROJECT_TEXT_MAX_LENGTH).toBe(10000)
      expect(PROJECT_AUTHORITY_NAME_MAX_LENGTH).toBe(SHARED_PROJECT_TEXT_MAX_LENGTH)
      expect(PROJECT_AUTHORITY_LOGIN_MAX_LENGTH).toBe(320)
      expect(PROJECT_AUTHORITY_PASSWORD_MAX_LENGTH).toBe(4096)
      const boundary = {commandId:randomUUID(),schemaVersion:2,workspaceId:workspaceA,idempotencyKey:randomUUID(),expectedRevision:'0',
        payload:{name:'я'.repeat(SHARED_PROJECT_TEXT_MAX_LENGTH),workspaceName:'а'.repeat(SHARED_PROJECT_TEXT_MAX_LENGTH),visibility:'private'}}
      expect(parseCreateSharedProject(boundary).payload.name).toBe(boundary.payload.name)
      expect(parseCreateSharedProject(boundary).payload.workspaceName).toBe(boundary.payload.workspaceName)
      const invalidBoundaryReadbacks = []
      for (const field of ['name','workspaceName'] as const) {
        const invalid = {...boundary,commandId:randomUUID(),idempotencyKey:randomUUID(),payload:{...boundary.payload,[field]:'я'.repeat(SHARED_PROJECT_TEXT_MAX_LENGTH+1)}}
        expect(()=>parseCreateSharedProject(invalid)).toThrow('INVALID_PAYLOAD')
        const rejected = await call('POST','/v1/workspaces/'+workspaceA+'/commands/project.createShared',ownerA.token,invalid)
        expect(rejected.status).toBe(400)
        expect(rejected.value).toEqual({error:{code:'INVALID_PAYLOAD'}})
        invalidBoundaryReadbacks.push({field,length:SHARED_PROJECT_TEXT_MAX_LENGTH+1,status:rejected.status,response:rejected.value})
      }
      const boundaryRows = await database.unsafe(`SELECT (SELECT count(*)::integer FROM "${schema}".project) AS projects,(SELECT count(*)::integer FROM "${schema}".project_create_receipt) AS receipts`)
      expect(boundaryRows[0]!.projects).toBe(0); expect(boundaryRows[0]!.receipts).toBe(0)
      observed.actualMaximumSchemaBoundary = {maximum:SHARED_PROJECT_TEXT_MAX_LENGTH,parserAcceptedExactBoundary:true,
        invalidBoundaryReadbacks,actualPostgresRows:boundaryRows[0]}
      const a = await prepareProfile('A'); const b = await prepareProfile('B')
      observed.profiles = profiles.map(profile => profile.seed)
      await launch(a); await launch(b)
      stage('two-real-Connections-sign-ins')
      await connect(a,ownerA,workspaceA,'Нативная область A')
      await connect(b,ownerB,workspaceB,'Нативная область B')
      const nameA = 'ПРИВАТНЫЙ_ПРОЕКТ_A_入力_🧭_' + randomBytes(4).toString('hex')
      const nameB = 'ПРИВАТНЫЙ_ПРОЕКТ_B_' + randomBytes(4).toString('hex')
      stage('symmetric-native-create-and-canonical-projection')
      const projectA = await create(a, nameA, 'private',true); const projectB = await create(b, nameB, 'private')
      expect(projectA.entity.workspaceId).toBe(workspaceA); expect(projectB.entity.workspaceId).toBe(workspaceB)
      expect(projectA.ownerPrincipalId).toBe(ownerA.principalId); expect(projectB.ownerPrincipalId).toBe(ownerB.principalId)
      expect(projectA.entity.entityId).not.toBe(projectB.entity.entityId)
      for (const [target, project, forbidden] of [[a,projectA,nameB],[b,projectB,nameA]] as const) {
        const page = requireSharedProjectPage(await target.page!.evaluate(id => window.electronAPI.getSharedProjects(id, {}), target.seed.localWorkspaceId))
        expect(page.items).toEqual([project])
        expect(JSON.stringify(page)).not.toContain(forbidden)
        await details(target, project)
        await capture(target, target === a ? 'A-private-native-detail' : 'B-private-native-detail')
        await assertHostBoundary(target, [nameA,nameB,projectA.entity.entityId,projectB.entity.entityId])
      }
      stage('private-http403-and-native-denied-profile')
      const forbidden = await call('GET', '/v1/workspaces/' + workspaceA + '/projects/' + projectA.entity.entityId, ownerB.token)
      expect(forbidden.status).toBe(403); expect(forbidden.text).toBe('{"error":{"code":"FORBIDDEN"}}')
      expect(forbidden.text).not.toContain(nameA)
      observed.privateHttpDenial = forbidden
      // B previously had a working authority in workspace B. A failed native
      // Connections login to A must quiesce live access without falling back;
      // the last valid durable B configuration/credential remains unchanged.
      await connect(b,ownerB,workspaceA,'Нативная область A',true)
      expect(await b.page!.locator('body').innerText()).not.toContain(nameA)
      expect(await b.page!.evaluate(() => window.electronAPI.isChannelAvailable('domain.project.get'))).toBe(false)
      await assertHostBoundary(b, [nameA,projectA.entity.entityId])
      await capture(b, 'B-nonmember-denied-local-folder-preserved')
      stage('member-policy-private-filter-and-shared-canonical-ref')
      await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceA,ownerB.principalId])
      await connect(b,ownerB,workspaceA,'Нативная область A')
      await route(b.page!,'projects')
      await b.page!.locator('[data-project-authority-state="ready"]').waitFor()
      expect(requireSharedProjectPage(await b.page!.evaluate(id => window.electronAPI.getSharedProjects(id, {}), b.seed.localWorkspaceId)).items).toEqual([])
      const shared = await create(a, 'Общий проект с настоящим каноническим ID', 'members')
      const refreshB = b.page!.locator('[data-project-authority-state] button').filter({ hasText: /^Обновить$/ })
      await verifyPointerTarget(b,refreshB,'B-list-refresh-after-foreground-activation')
      await refreshB.click()
      await b.page!.waitForFunction(name => document.querySelector('[data-project-authority-state="ready"]')?.textContent?.includes(name),shared.name)
      const bList = requireSharedProjectPage(await b.page!.evaluate(id => window.electronAPI.getSharedProjects(id, {}), b.seed.localWorkspaceId))
      expect(bList.items).toEqual([shared]); expect(JSON.stringify(bList)).not.toContain(nameA)
      const privacyBefore = await projectionPixels(b,'B-projection-before-rejected-private-get')
      expect(privacyBefore.text).toContain(shared.name)
      expect(privacyBefore.text).not.toContain(nameA)
      const deniedNative = await b.page!.evaluate(async ({ id, entityId }) => {
        try { await window.electronAPI.getSharedProject(id, { entityId }); return { rejected: false } }
        catch (error) {
          const value = error as { code?: string; message?: string; data?: unknown }
          return { rejected: true, code: value?.code, message: value?.message, data:value?.data,
            originalRejection: error && typeof error === 'object' ? JSON.stringify(error,Object.getOwnPropertyNames(error)) : String(error) }
        }
      }, { id: b.seed.localWorkspaceId, entityId: projectA.entity.entityId })
      expect(deniedNative.rejected).toBe(true); expect(deniedNative.code).toBe('FORBIDDEN')
      expect(JSON.stringify(deniedNative)).not.toContain(nameA)
      observed.privateMemberNativeDenial = deniedNative
      const privacyAfter = await projectionPixels(b,'B-projection-after-rejected-private-get')
      expect(privacyAfter.text).toBe(privacyBefore.text)
      expect(privacyAfter.pixels).toEqual(privacyBefore.pixels)
      observed.privateDenialPixelSafety = {before:privacyBefore,after:privacyAfter,genuineRejectedRPC:true,semanticAndDecodedPixelsUnchanged:true}
      await route(b.page!, 'projects/project/' + projectA.entity.entityId)
      await b.page!.locator('[data-shared-project-detail="denied"]').waitFor()
      expect(await b.page!.locator('body').innerText()).not.toContain(nameA)
      await capture(b, 'B-private-canonical-route-denied-no-title')
      await details(a, shared); await details(b, shared)
      await capture(a, 'A-members-shared-native-detail'); await capture(b, 'B-same-shared-canonical-detail')
      observed.canonicalProjects = { privateA: projectA, privateB: projectB, shared }

      stage('visible-sidebar-keyboard-resize-regression')
      await activate(a)
      const toggleSidebar = a.page!.getByRole('button',{name:'Показать/скрыть боковую панель',exact:true})
      const sidebarSash = a.page!.getByRole('separator',{name:'Изменить ширину боковой панели',exact:true})
      // Full-width Projects intentionally hides the sessions sidebar. Exercise
      // its genuine resize control in the registered Chats route, then return
      // to the canonical project through the normal native UI.
      await route(a.page!,'allSessions')
      await a.page!.locator('[data-shared-project-detail]').waitFor({state:'hidden'})
      if (await sidebarSash.isVisible()) {
        await toggleSidebar.click()
        await sidebarSash.waitFor({state:'hidden'})
      }
      await toggleSidebar.click()
      await sidebarSash.waitFor({state:'visible'})
      const originalSidebarWidth = Number(await sidebarSash.getAttribute('aria-valuenow'))
      await sidebarSash.focus()
      expect(await sidebarSash.evaluate(element=>element===document.activeElement)).toBe(true)
      await sidebarSash.press('ArrowRight')
      await until(async()=>Number(await sidebarSash.getAttribute('aria-valuenow'))>originalSidebarWidth,'visible sidebar keyboard width increase')
      const increasedSidebarWidth = Number(await sidebarSash.getAttribute('aria-valuenow'))
      expect(increasedSidebarWidth).toBeLessThanOrEqual(Number(await sidebarSash.getAttribute('aria-valuemax')))
      await sidebarSash.press('Enter')
      await sidebarSash.press('ArrowLeft')
      await until(async()=>Number(await sidebarSash.getAttribute('aria-valuenow'))===originalSidebarWidth,'visible sidebar keyboard width restore')
      await sidebarSash.press('Enter')
      await capture(a,'A-visible-sidebar-keyboard-resize-preserved')
      await toggleSidebar.click()
      await sidebarSash.waitFor({state:'hidden'})
      await details(a,shared)
      observed.sidebarKeyboardResize = {originalSidebarWidth,increasedSidebarWidth,restoredOriginalWidth:true,
        focusedRealSeparator:true,actualVisibleRoute:'allSessions',canonicalDetailReopened:true,collapsedSeparatorAbsent:true}

      stage('dark-light-200-percent-narrow-keyboard')
      for (const mode of ['dark','light'] as const) {
        await route(a.page!, 'settings/appearance')
        const radio = a.page!.getByRole('radio', { name: mode === 'dark' ? 'Тёмная' : 'Светлая', exact: true })
        await radio.waitFor(); await radio.focus(); await radio.press('Space')
        await a.page!.waitForFunction(expected => document.documentElement.classList.contains('dark') === (expected === 'dark'), mode)
        await details(a, shared)
        await capture(a, 'A-' + mode + '-native-shared-detail')
        await a.app!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setContentSize(980,800); window.webContents.setZoomFactor(2) })
        expect(await a.app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBe(2)
        const panel = a.page!.locator('[data-shared-project-detail="ready"]')
        const geometry = await panel.evaluate(element => {
          const rect = element.getBoundingClientRect(); const button = element.querySelector('button')!
          const action = button.getBoundingClientRect(); const target = document.elementFromPoint(action.x + action.width / 2, action.y + action.height / 2)
          return { viewportWidth: innerWidth, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            withinViewport: rect.x >= 0 && rect.right <= innerWidth + 1, actionWidth: action.width, actionHeight: action.height,
            actualHitTarget: target === button || button.contains(target), text: element.textContent }
        })
        expect(geometry.withinViewport).toBe(true); expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
        expect(geometry.actualHitTarget).toBe(true); expect(geometry.actionWidth).toBeGreaterThan(20); expect(geometry.actionHeight).toBeGreaterThan(20)
        expect(geometry.text).toContain(shared.entity.entityId)
        ;((observed.visualGeometry ??= []) as unknown[]).push({ mode, zoomFactor: 2, ...geometry })
        await panel.getByRole('button', { name: 'Обновить', exact: true }).focus()
        expect(await panel.getByRole('button', { name: 'Обновить', exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
        await panel.getByRole('button', { name: 'Обновить', exact: true }).press('Enter')
        await panel.waitFor()
        await capture(a, 'A-' + mode + '-200-percent-narrow-keyboard')
        await a.app!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.webContents.setZoomFactor(1); window.setContentSize(1320,850) })
      }
      stage('service-and-both-native-profiles-restart')
      await close(a); await close(b)
      service!.server.close(); service = undefined
      await until(async () => { try { await fetch('http://127.0.0.1:' + port + '/v1/workspaces/' + workspaceA + '/projects'); return false } catch { return true } }, 'owned service listener stopped')
      await database.close(); database = new SQL(databaseUrl)
      await startService()
      await launch(a); await launch(b)
      for (const target of [a,b]) {
        await route(target.page!,'projects')
        await target.page!.locator('[data-project-authority-state="ready"]').waitFor()
      }
      expect(requireSharedProject(await a.page!.evaluate(({id,entityId}) => window.electronAPI.getSharedProject(id,{entityId}), { id:a.seed.localWorkspaceId,entityId:projectA.entity.entityId }))).toEqual(projectA)
      for (const target of [a,b]) {
        expect(requireSharedProject(await target.page!.evaluate(({id,entityId}) => window.electronAPI.getSharedProject(id,{entityId}), { id:target.seed.localWorkspaceId,entityId:shared.entity.entityId }))).toEqual(shared)
        await details(target, shared)
        await assertHostBoundary(target, [nameA,nameB,projectA.entity.entityId,projectB.entity.entityId,shared.entity.entityId])
        await capture(target, target === a ? 'A-post-service-and-profile-restart' : 'B-post-service-and-profile-restart')
      }
      const rows = await database.unsafe(`SELECT project_id,workspace_id,owner_principal_id,name,visibility FROM "${schema}".project ORDER BY project_id`)
      expect(rows).toHaveLength(3)
      observed.postgresReadback = { rows, sha256: digest(JSON.stringify(rows)), actualReconnectAndMigrations: true }
      stage('actual-persisted-session-revocation')
      // Host-boundary verification above intentionally navigates to Projects.
      // Restore the visible canonical detail before testing its Refresh action.
      await details(b, shared)
      const nativeCredential = await credentialReadback(b)
      expect(nativeCredential.present).toBe(true); expect(nativeCredential.sessionId).toBeTruthy()
      // Revoke the genuine active Electron session and the separate HTTP probe
      // session. No forged JWT or actor/session object enters the product.
      expect(await service!.identity.revokeSession(nativeCredential.sessionId!)).toBe(true)
      expect(await service!.identity.revokeSession(ownerB.sessionId)).toBe(true)
      const revoked = await call('GET','/v1/workspaces/' + workspaceA + '/projects',ownerB.token)
      expect(revoked.status).toBe(401); expect(revoked.text).toBe('{"error":{"code":"UNAUTHENTICATED"}}')
      const revokeRefresh = b.page!.locator('[data-shared-project-detail="ready"] button').filter({hasText:/^Обновить$/})
      await verifyPointerTarget(b,revokeRefresh,'B-detail-refresh-after-real-session-revocation')
      await revokeRefresh.click()
      await b.page!.locator('[data-shared-project-detail="denied"]').waitFor()
      expect(await b.page!.locator('body').innerText()).not.toContain(shared.name)
      expect(await b.page!.locator('body').innerText()).not.toContain(nameA)
      await route(b.page!, 'projects')
      await b.page!.locator('[data-project-authority-state="denied"]').waitFor()
      await assertHostBoundary(b,[nameA,nameB,projectA.entity.entityId,shared.entity.entityId])
      await capture(b,'B-revoked-session-denied-host-folder-preserved')
      observed.revokedSession = { nativeSessionId:nativeCredential.sessionId, httpProbeSessionId:ownerB.sessionId,
        revoked, nativeDenied:true, privateTitlesAbsent:true }
      stage('explicit-native-disconnect-clears-durable-credential')
      await route(b.page!,'connections')
      const disconnect = b.page!.getByTestId('project-authority-disconnect')
      await disconnect.waitFor(); await disconnect.focus(); await disconnect.press('Enter')
      await until(async () => await b.page!.evaluate(id => window.electronAPI.getProjectAuthorityConfiguration(id),b.seed.localWorkspaceId) === null,'explicit disconnect clears metadata')
      expect((await credentialReadback(b)).present).toBe(false)
      expect(await b.page!.evaluate(() => window.electronAPI.isChannelAvailable('domain.project.get'))).toBe(false)
      expect(await b.page!.getByTestId('project-authority-connection').getAttribute('data-authority-state')).toBe('unconfigured')
      await capture(b,'B-explicit-native-disconnect-no-durable-token')
      await assertHostBoundary(b,[nameA,nameB,projectA.entity.entityId,shared.entity.entityId])
      expect(await hashes()).toEqual(sourceSha256)
      expect(await builtHashes()).toEqual(artifactSha256)
      expect(errors).toEqual([])
      expect(nativeLog.filter(entry => /Uncaught exception|ENOSPC/.test(entry.text))).toEqual([])
      observed.consumerGatesVerified = { actualConnectionsLogin:true, actualProjectsCreate:true,
        symmetricProfiles:true, privateHttp403NoDisclosure:true, serviceAndProfilesRestart:true, nativeSessionRevoked:true,
        rejectedReplacementPreservesDurableButQuiescesLive:true, explicitDisconnectClearsCredential:true }
      observed.status = 'PASS_NATIVE_WP01_CONSUMER'
      observed.fullFeatureDoDComplete = false
    } catch (error) {
      observed.status = 'FAIL'
      observed.error = redact(error instanceof Error ? error.message : String(error))
      observed.errorStack = redact(error instanceof Error ? error.stack ?? '' : '')
      for (const [index, target] of profiles.entries()) if (target.page) await capture(target,'failure-profile-' + index).catch(() => {})
      throw new Error(String(observed.error))
    } finally {
      for (const target of profiles) await close(target).catch(() => {})
      service?.server.close()
      if (database) {
        await database.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
        await database.close()
      }
      observed.finishedAt = new Date().toISOString()
      await writeFile(join(evidence,'result.json'), JSON.stringify(observed,null,2))
      console.log('WP01 native acceptance evidence: ' + join(evidence,'result.json'))
    }
  }, 420_000)
})
