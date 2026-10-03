// Loaded only in Bun, never bundled into the browser. Every file is disposable.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { HandlerFn, RpcServer, RequestContext } from '../../../packages/server-core/src/transport/types'
import type { HandlerDeps } from '../../../packages/server-core/src/handlers/handler-deps'

export async function createBackendFixture(runtimeCount = 2214) {
  const root = mkdtempSync(join(tmpdir(), 'opencode', 'qa-skills-'))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const workspaceB = join(root, 'workspace-b')
  const config = process.env.ROX_CONFIG_DIR || join(root, 'config')
  const relativeConfig = relative(tmpdir(), config)
  if (isAbsolute(relativeConfig) || relativeConfig.startsWith('..') ||
    !(relativeConfig.startsWith(`opencode${sep}`) || relativeConfig.startsWith('rox-agent-test-'))) {
    rmSync(root, { recursive: true, force: true })
    throw new Error('Fixture requires a disposable config under the temporary directory')
  }
  for (const path of [home, workspace, workspaceB, config]) mkdirSync(path, { recursive: true })
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.ROX_CONFIG_DIR = config
  process.env.CRAFT_CONFIG_DIR = config
  const configApi = await import('../../../packages/shared/src/config/storage')
  // getConfigPath may be frozen by the test preload, but is always a disposable config.
  writeFileSync(configApi.getConfigPath(), JSON.stringify({
    workspaces: [
      { id: 'fixture', name: 'Fixture', rootPath: workspace, createdAt: 1 },
      { id: 'fixture-b', name: 'Fixture B', rootPath: workspaceB, createdAt: 1 },
    ], activeWorkspaceId: 'fixture', activeSessionId: null,
  }))
  function skill(skillsRoot: string, slug: string, body: string, name = slug) {
    const directory = join(skillsRoot, slug)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Controlled skill ${slug}\n---\n${body}\n`)
    return directory
  }
  const runtimeRoot = join(workspace, '.omp', 'skills')
  skill(join(workspace, 'skills'), 'workspace-skill', '# Instructions for workspace-skill', 'Repeated craft name')
  skill(join(workspace, 'skills'), 'duplicate', '# Craft duplicate', 'Repeated craft name')
  skill(runtimeRoot, 'md-slides', '# Instructions for md-slides\nПривет, 世界 — café', 'Slides display name')
  skill(runtimeRoot, 'tool-prompt-optimization', '# Instructions for tool-prompt-optimization')
  skill(runtimeRoot, 'duplicate', '# Shadowed runtime duplicate')
  for (let i = 0; i < runtimeCount - 3; i++) skill(runtimeRoot, `runtime-${i.toString().padStart(4, '0')}`, `# Instructions for runtime-${i.toString().padStart(4, '0')}`)
  skill(join(workspaceB, '.omp', 'skills'), 'md-slides', '# Workspace B instructions')
  const skillsApi = await import('../../../packages/shared/src/skills')
  skillsApi.invalidateSkillsCache()
  skillsApi.invalidateOmpSkillsCache()
  const { RPC_CHANNELS } = await import('../../../packages/shared/src/protocol')
  const { registerSkillsHandlers } = await import('../../../packages/server-core/src/handlers/rpc/skills')
  const handlers = new Map<string, HandlerFn>()
  const options = new Map<string, unknown>()
  const server = { handle(channel, handler, policy) { handlers.set(channel, handler); options.set(channel, policy) } } as RpcServer
  const sessions: Array<{ workspaceId: string; workingDirectory: string }> = []
  const deps = { platform: {}, sessionManager: { getSessions: (id: string) => sessions.filter(s => s.workspaceId === id) } } as unknown as HandlerDeps
  registerSkillsHandlers(server, deps)
  const context = (workspaceId = 'fixture'): RequestContext => ({ clientId: 'fixture-client', workspaceId, webContentsId: null })
  const invoke = (channel: string, workspaceId: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing fixture handler ${channel}`)
    return handler(context(workspaceId), workspaceId, ...args)
  }
  return { root, home, workspace, workspaceB, runtimeRoot, skill, sessions, skillsApi, RPC_CHANNELS, handlers, options, context, invoke,
    dispose: () => { skillsApi.invalidateSkillsCache(); skillsApi.invalidateOmpSkillsCache(); rmSync(root, { recursive: true, force: true }) },
  }
}
