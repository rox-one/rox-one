import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import ts from 'typescript'
import * as shared from '@rox/shared/projects'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { createWorkspaceAtPath as createWorkspace } from '@rox/shared/workspaces'
import * as nativeSidebarMetadata from './native-sidebar-metadata'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

// Execute the actual registration module. Storage and workspace config are real;
// only registry/transport delivery seams are controlled. No identity is inferred
// from a filesystem basename or rewritten in a renderer fixture.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'project-scope-rpc-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const rootPath = join(dir, 'custom-folder-name')
  const config = createWorkspace(rootPath, 'Scope fixture')
  const workspace = { id: config.id, name: config.name, rootPath }
  const otherRoot = join(dir, 'other-folder')
  createWorkspace(otherRoot, 'Foreign fixture')
  const local = shared.createProject(rootPath, { name: 'Current project' })
  const foreign = shared.createProject(otherRoot, { name: 'Foreign project' })
  let registry: typeof workspace | null = workspace
  let rows = shared.loadWorkspaceProjects(rootPath)
  let loadShared = async () => ({ ...shared, loadWorkspaceProjects: () => rows })
  const handlers = new Map<string, (...args: any[]) => any>()
  const options = new Map<string, unknown>()
  const pushes: unknown[][] = []
  const source = readFileSync(join(import.meta.dir, 'projects.ts'), 'utf8')
  const dynamic = /await\s+import\(['"]@rox\/shared\/projects['"]\)/g
  if ([...source.matchAll(dynamic)].length < 3) throw new Error('Actual project loader import seams are missing')
  const code = ts.transpileModule(source.replace(dynamic, 'await loadShared()'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as any }
  const registryLookup = (id: string) => registry?.id === id ? registry : null
  const dependencies: Record<string, unknown> = {
    fs: {}, path: { join },
    '@rox/shared/workspaces': {},
    '@rox/shared/protocol': { CodedError, RPC_CHANNELS },
    '@rox/shared/config': { getWorkspaceByNameOrId: registryLookup },
    '@rox/server-core/transport': { pushTyped: (_server: unknown, ...args: unknown[]) => pushes.push(args) },
    '@rox/shared/projects': shared,
    './native-sidebar-metadata': nativeSidebarMetadata,
    '@rox/core/rox2': {
      isClaimableLive: () => true,
      rpcProjectsListResult: () => ({ result: {} }),
      rpcProjectsReadResult: () => ({ result: {} }),
      rpcProjectsActResult: () => ({}),
    },
  }
  // Preserve actual callback code and expose the one published dynamic import
  // seam so a registry change while it is awaited can be exercised.
  new Function('require', 'module', 'exports', 'loadShared', code)(
    (id: string) => {
      if (!(id in dependencies)) throw new Error(`Unexpected module: ${id}`)
      return dependencies[id]
    }, module, module.exports, () => loadShared(),
  )
  module.exports.registerProjectsHandlers({
    handle(channel: string, callback: (...args: any[]) => any, settings: unknown) {
      handlers.set(channel, callback); options.set(channel, settings)
    },
  }, { platform: { logger: { info() {}, warn() {}, error() {} } } })
  const context = { clientId: 'controlled-client', workspaceId: workspace.id, webContentsId: null }
  return {
    workspace, rootPath, local, foreign, options, pushes,
    invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!(context, workspace.id, ...args),
    setRows: (value: typeof rows) => { rows = value },
    setRegistry: (value: typeof registry) => { registry = value },
    pauseImport: () => {
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>()
      loadShared = async () => { entered.resolve(); await release.promise; return { ...shared, loadWorkspaceProjects: () => rows } }
      return { entered: entered.promise, release: release.resolve }
    },
    actualForeign: () => shared.loadWorkspaceProjects(otherRoot),
  }
}

test('actual GET and GET_ONE return canonical registry IDs for a custom workspace folder', async () => {
  const f = fixture()
  expect(f.workspace.id).not.toBe(basename(f.rootPath))
  const rows = await f.invoke(RPC_CHANNELS.projects.GET)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ workspaceId: f.workspace.id, workspaceRootPath: f.rootPath, config: { name: 'Current project' } })
  expect(await f.invoke(RPC_CHANNELS.projects.GET_ONE, f.local.slug)).toMatchObject({ workspaceId: f.workspace.id })
  expect(await f.invoke(RPC_CHANNELS.projects.GET_ONE, 'absent')).toBeNull()
  // Native listing now uses its independently authorized, read-only metadata
  // path. The legacy single-project handler keeps its original registration.
  expect(f.options.get(RPC_CHANNELS.projects.GET)).toEqual({ nativeAction: 'read' })
  expect(f.options.get(RPC_CHANNELS.projects.GET_ONE)).toBeUndefined()
})

test('actual project changed broadcast uses canonical ID and retains current records', async () => {
  const f = fixture()
  await f.invoke(RPC_CHANNELS.projects.UPDATE, f.local.slug, { name: 'Updated current project' })
  expect(f.pushes).toHaveLength(1)
  const [channel, target, workspaceId, rows] = f.pushes[0] as any[]
  expect(channel).toBe(RPC_CHANNELS.projects.CHANGED)
  expect(target).toEqual({ to: 'workspace', workspaceId: f.workspace.id })
  expect(workspaceId).toBe(f.workspace.id)
  expect(rows[0]).toMatchObject({ workspaceId: f.workspace.id, workspaceRootPath: f.rootPath })
})

test('a mixed current and foreign-root list fails closed before response or broadcast', async () => {
  const f = fixture()
  f.setRows([...shared.loadWorkspaceProjects(f.rootPath), ...f.actualForeign()])
  await expect(f.invoke(RPC_CHANNELS.projects.GET)).rejects.toThrow('Project workspace projection')
  await expect(f.invoke(RPC_CHANNELS.projects.UPDATE, f.local.slug, { name: 'Current update' })).rejects.toThrow('Project workspace projection')
  expect(f.pushes).toEqual([])
})

test('a registry root change across the actual import await refuses the stale projection', async () => {
  const f = fixture()
  const pause = f.pauseImport()
  const pending = f.invoke(RPC_CHANNELS.projects.GET)
  await pause.entered
  f.setRegistry({ ...f.workspace, rootPath: join(f.rootPath, 'changed-root') })
  pause.release()
  await expect(pending).rejects.toThrow('Project workspace projection')
})
