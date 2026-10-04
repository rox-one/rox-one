import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import * as shared from '@rox/shared/projects'
import { CodedError } from '@rox/shared/protocol'
import { LOCAL_ROX_CALLER, peekRoxAccountAuthority } from '@rox/shared/auth'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority'
import type { RequestContext } from '../../transport/types'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

// Run the actual registered callback. Only the input/import await seams and
// provider are controlled; authorization uses the production SQLite authority.
function actualAi(environment: Record<string, unknown>): (ctx: RequestContext, workspaceId: string, slug: string, request: unknown) => Promise<any> {
  const file = join(import.meta.dir, 'projects.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let callback: ts.Expression | undefined
  let workspaceGate: ts.FunctionDeclaration | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'server.handle' &&
      node.arguments[0]?.getText(source) === 'RPC_CHANNELS.projects.AI_ROADMAP') callback = node.arguments[1]
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'requireCallerWorkspace') workspaceGate = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!callback || !workspaceGate) throw new Error('Actual roadmap AI handler or workspace gate is missing')
  const compiled = ts.transpileModule(`${workspaceGate.getText(source)}\nconst actual = ${callback.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  }).outputText
  const importExpression = /import\(['"]@rox\/shared\/projects['"]\)/g
  if ([...compiled.matchAll(importExpression)].length !== 1) throw new Error('Expected exactly one shared-projects import seam')
  const code = compiled.replace(importExpression, 'loadShared()')
  return new Function(...Object.keys(environment), `${code}; return actual;`)(...Object.values(environment))
}

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rox-roadmap-ai-fence-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const authority = new NativeAuthority({ stateDir: join(dir, 'state') })
  cleanups.push(() => authority.close())
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin: NativeIssuedCredential
  try {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    admin = authority.bootstrapLocalAdministrator('roadmap test operator')
  } finally {
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  }
  const root = join(dir, 'workspace')
  mkdirSync(root)
  const workspace = authority.registerWorkspace(admin.credential, 'roadmap-workspace', root)
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'roadmap test device', Date.now() + 60_000), 'roadmap test device')!
  authority.grantWorkspace(admin.credential, issued.principal.subject, workspace.id, ['read', 'write'])
  const slug = shared.createProject(root, { name: 'Grant-safe roadmap' }).slug
  const context: RequestContext = { clientId: 'test-client', workspaceId: workspace.id, webContentsId: null, principal: authority.authenticate(issued.credential)! }
  let providerCalls = 0
  const environment = {
    deps: { nativeData: { authority }, sessionManager: {
      describeWorkspaceLlm: () => ({ available: true }),
      queryWorkspaceLlm: async () => { providerCalls++; return { text: 'improved draft', model: 'test-double' } },
    } },
    getWorkspaceByNameOrId: (id: string) => id === workspace.id ? { id, rootPath: root } : null,
    loadShared: async () => shared, projectInputLines: async () => [],
    log: { info() {}, warn() {} }, CodedError, TEXT_EXCERPT_CHARS: 1500,
    peekRoxAccountAuthority, LOCAL_ROX_CALLER,
  }
  const request = { mode: 'improve', text: 'draft', roadmapRevision: shared.loadProjectRoadmap(root, slug).roadmap.revision }
  return { authority, admin, issued, context, workspace, slug, environment, request, calls: () => providerCalls }
}

for (const seam of ['shared import', 'project inputs'] as const) {
  test(`actual roadmap AI dispatch refuses a revoked and regranted native permission during ${seam}`, async () => {
    const f = fixture()
    const waiting = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const environment = { ...f.environment,
      ...(seam === 'shared import'
        ? { loadShared: async () => { waiting.resolve(); await release.promise; return shared } }
        : { projectInputLines: async () => { waiting.resolve(); await release.promise; return [] } }),
    }
    const pending = actualAi(environment)(f.context, f.workspace.id, f.slug, f.request)
    await waiting.promise
    const before = f.authority.permissionFence(f.context.principal!, f.workspace.id, 'write')
    f.authority.revokeWorkspaceGrant(f.admin.credential, f.issued.principal.subject, f.workspace.id)
    f.authority.grantWorkspace(f.admin.credential, f.issued.principal.subject, f.workspace.id, ['read', 'write'])
    expect(f.authority.authorize(f.context.principal!, f.workspace.id, 'read')).toBe(true)
    expect(f.authority.authorize(f.context.principal!, f.workspace.id, 'write')).toBe(true)
    expect(f.authority.permissionFence(f.context.principal!, f.workspace.id, 'write')).not.toBe(before)
    release.resolve()
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('permission changed') })
    expect(f.calls()).toBe(0)
  })
}

test('actual roadmap AI preserves dispatch for an unchanged native read/write fence', async () => {
  const f = fixture()
  expect(await actualAi(f.environment)(f.context, f.workspace.id, f.slug, f.request))
    .toMatchObject({ ok: true, mode: 'improve', text: 'improved draft' })
  expect(f.calls()).toBe(1)
})

for (const action of ['read', 'write'] as const) {
  test(`actual roadmap AI checks the ${action} grant generation independently`, async () => {
    const f = fixture()
    const waiting = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const otherAction = action === 'read' ? 'write' : 'read'
    const unchangedFence = f.authority.permissionFence(f.context.principal!, f.workspace.id, otherAction)
    const pending = actualAi({ ...f.environment, projectInputLines: async () => { waiting.resolve(); await release.promise; return [] } })(f.context, f.workspace.id, f.slug, f.request)
    await waiting.promise
    f.authority.grantWorkspace(f.admin.credential, f.issued.principal.subject, f.workspace.id, [action])
    expect(f.authority.permissionFence(f.context.principal!, f.workspace.id, otherAction)).toBe(unchangedFence)
    release.resolve()
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining(`${action} permission changed`) })
    expect(f.calls()).toBe(0)
  })
}

test('actual roadmap AI preserves the standalone caller path without granting native permissions', async () => {
  const f = fixture()
  const context = { ...f.context, principal: undefined }
  const environment = { ...f.environment, deps: { sessionManager: f.environment.deps.sessionManager } }
  expect(await actualAi(environment)(context, f.workspace.id, f.slug, f.request)).toMatchObject({ ok: true })
  expect(f.calls()).toBe(1)
})

test('actual roadmap AI refuses a replaced principal before provider dispatch', async () => {
  const f = fixture()
  const waiting = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const pending = actualAi({ ...f.environment, projectInputLines: async () => { waiting.resolve(); await release.promise; return [] } })(f.context, f.workspace.id, f.slug, f.request)
  await waiting.promise
  f.context.principal = f.authority.authenticate(f.issued.credential)!
  release.resolve()
  expect(await pending).toMatchObject({ ok: false })
  expect(f.calls()).toBe(0)
})
