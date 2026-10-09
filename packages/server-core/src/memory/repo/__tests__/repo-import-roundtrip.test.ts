/**
 * WP-06 acceptance roundtrip (the test that did not exist yet).
 *
 * materialize → edit one rendered lesson file → parseRepoEdits yields exactly one
 * `update` → create the proposal through the real RPC import handler → approve it
 * with `approveMemoryProposalDurably` → materialize again (edited bytes survive, a
 * commit exists) → materialize a third time (no-op) → a second import of the same
 * edit produces no new proposal.
 *
 * Everything is real: temp config dir + workspace, real LessonStore /
 * MemoryFileStore / MemoryProposalStore, the real git-backed MemoryRepoService
 * and the real import handler (proposal creation + dedup).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitExec } from '@rox/shared/memory/git-exec'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../../handlers/handler-deps'
import {
  registerMemoryRepoImportHandlers,
  type MemoryRepoImportRuntime,
  type MemoryRepoImportRuntimeAccessor,
} from '../../../handlers/rpc/memory-repo-import'
import { approveMemoryProposalDurably } from '../../approve-memory-proposal'
import { LessonStore } from '../../LessonStore'
import { MemoryFileStore } from '../../MemoryFileStore'
import { MemoryProposalStore } from '../../MemoryProposalStore'
import { renderRepoFiles } from '../MemoryRepoMaterializer'
import { MemoryRepoService } from '../MemoryRepoService'
import { MemoryRepoSourceProvider } from '../RepoSourceProvider'
import { listRepoFiles } from '../snapshots'

const BANK = 'ws:w1'
const WORKSPACE_ID = 'w1'
const RULE0 = 'Always run the full test suite'
const RULE1 = 'Always run the full test suite before pushing'

let root: string
let configDir: string
let workspaceRoot: string
let runtime: MemoryRepoImportRuntime | null

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mem-repo-roundtrip-'))
  configDir = join(root, 'config')
  workspaceRoot = join(root, 'ws')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })
  runtime = null
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Mount the real import handler on a minimal RPC server (mirrors memory-repo-import.test.ts). */
function createHarness(): (channel: string, context: Partial<RequestContext>, ...args: unknown[]) => unknown {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
    platform: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } },
  } as unknown as HandlerDeps
  const accessor: MemoryRepoImportRuntimeAccessor = async () => runtime
  registerMemoryRepoImportHandlers(server, deps, accessor)
  return (channel, context, ...args) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null, webContentsId: null, ...context } as RequestContext, ...args)
  }
}

/** Working-tree files + known lesson projection, exactly as the runtime accessor builds them. */
async function buildRuntime(service: MemoryRepoService, provider: MemoryRepoSourceProvider): Promise<MemoryRepoImportRuntime> {
  const files: Array<{ path: string; content: string }> = []
  for (const node of await service.tree(BANK)) {
    if (node.type !== 'file') continue
    try {
      const file = await service.readFile(BANK, node.path)
      files.push({ path: node.path, content: file.content })
    } catch {
      // a vanished file is simply absent from the import view
    }
  }
  const bundle = await provider.loadBundle(BANK)
  const byKey = new Map(bundle.lessons.map((lesson) => [lesson.lessonKey, lesson]))
  const known = renderRepoFiles(bundle, { generatedAt: new Date().toISOString() })
    .filter((file) => file.kind === 'lesson' && file.lessonKey)
    .map((file) => {
      const lesson = byKey.get(file.lessonKey!)
      return {
        path: file.path,
        lessonId: file.lessonId ?? file.lessonKey!,
        ruleHash: file.ruleHash ?? '',
        ...(file.ruleHash ? { baseHash: file.ruleHash } : {}),
        rule: lesson?.rule ?? '',
        disabled: lesson?.disabled ?? false,
      }
    })
  return {
    bankId: BANK,
    scope: 'workspace',
    workspaceId: WORKSPACE_ID,
    workspaceRoot,
    memoryDir: join(workspaceRoot, 'memory'),
    files,
    known,
  }
}

function treeBytes(repoPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const path of listRepoFiles(repoPath)) out[path] = readFileSync(join(repoPath, ...path.split('/')), 'utf8')
  return out
}

describe('memory repo import roundtrip (WP-06)', () => {
  it('materialize → edit → parse → propose → approve → re-materialize → no-op → dedup', async () => {
    const lessonStore = new LessonStore(new MemoryFileStore('workspace', workspaceRoot, configDir).lessonsPath, 'workspace')
    lessonStore.add(
      { ts: '2026-10-08T00:00:00.000Z', rule: RULE0, category: 'workflow', scope: 'workspace', source: { trigger: 'explicit' } },
      'user',
    )
    const provider = new MemoryRepoSourceProvider({
      configDir,
      getWorkspaces: () => [{ id: WORKSPACE_ID, name: 'Work', rootPath: workspaceRoot }],
    })
    const service = new MemoryRepoService({ configDir, git: createGitExec(), provider, debounceMs: 5 })

    // (a) materialize the bank
    const first = await service.materialize(BANK, 'test')
    expect(first.committed).toBe(true)
    expect(await service.listCommits(BANK)).toHaveLength(1)

    // (b) edit one rendered lesson file on disk: change the rule, keep the frontmatter id
    const repoPath = service.repoPathFor(BANK, '')
    const lessonPath = renderRepoFiles(await provider.loadBundle(BANK), { generatedAt: new Date().toISOString() })
      .find((file) => file.kind === 'lesson')!.path
    const abs = join(repoPath, ...lessonPath.split('/'))
    const original = readFileSync(abs, 'utf8')
    expect(original).toContain(RULE0)
    const edited = original.replace(RULE0, RULE1)
    expect(edited).not.toBe(original)
    writeFileSync(abs, edited)

    const invoke = createHarness()
    runtime = await buildRuntime(service, provider)

    // (c) parseRepoEdits yields exactly one update for that path
    const preview = await invoke(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT, { workspaceId: WORKSPACE_ID }, BANK) as {
      edits: Array<{ path: string; kind: string }>
    }
    expect(preview.edits).toHaveLength(1)
    expect(preview.edits[0]).toMatchObject({ path: lessonPath, kind: 'update' })

    // (d) real proposal path + durable approval
    const proposalStore = new MemoryProposalStore(join(workspaceRoot, 'memory'))
    const applied = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: WORKSPACE_ID }, BANK) as {
      added: number
      proposalIds: string[]
    }
    expect(applied.added).toBe(1)
    const proposalId = applied.proposalIds[0]!
    const approved = approveMemoryProposalDurably({
      store: proposalStore,
      workspaceRoot,
      proposalId,
      scope: 'workspace',
      now: new Date('2026-10-09T12:00:00.000Z'),
    })
    expect(approved).not.toBeNull()
    expect(approved!.status).toBe('approved_workspace')

    // (e) materialize again: the edited file survives byte-for-byte, a commit exists
    const second = await service.materialize(BANK, 'test')
    expect(second.committed).toBe(true)
    expect(second.files).toBeGreaterThan(0)
    expect(readFileSync(abs, 'utf8')).toBe(edited)

    const commits = await service.listCommits(BANK)
    expect(commits).toHaveLength(2)
    const newLessonPath = renderRepoFiles(await provider.loadBundle(BANK), { generatedAt: new Date().toISOString() })
      .find((file) => file.kind === 'lesson' && file.path !== lessonPath)!.path
    expect(commits[0]!.files.map((file) => file.path).sort()).toEqual([newLessonPath, 'MEMORY.md'].sort())

    // (f) a third materialize is a strict no-op — committed:false and zero byte changes
    const before = treeBytes(repoPath)
    const third = await service.materialize(BANK, 'test')
    expect(third.committed).toBe(false)
    expect(third.files).toBe(0)
    expect(treeBytes(repoPath)).toEqual(before)
    expect(await service.listCommits(BANK)).toHaveLength(2)

    // a second import of the same edit produces no new proposal
    runtime = await buildRuntime(service, provider)
    const reapplied = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: WORKSPACE_ID }, BANK) as {
      added: number
      proposalIds: string[]
    }
    expect(reapplied.added).toBe(0)
    expect(reapplied.proposalIds).toEqual([])
    expect(proposalStore.list()).toHaveLength(1)

    await service.dispose()
  })
})