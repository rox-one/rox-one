/**
 * WP-01 spike — memory repository baseline measurement.
 *
 * Throwaway script (see README.md). Builds a realistic corpus, materializes it
 * through the real MemoryRepoService, exercises git init/add/commit, and prints
 * wall time, repo size and sample diffs.
 *
 * Run: bun run spikes/memory-repo-baseline/spike.ts
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitExec, type GitExec } from '../../packages/shared/src/memory/git-exec.ts'
import type { RepoSourceBundle, RepoSourceLesson } from '../../packages/server-core/src/memory/repo/MemoryRepoMaterializer.ts'
import { MemoryRepoService } from '../../packages/server-core/src/memory/repo/MemoryRepoService.ts'
import { memoryRepoPath, type RepoSourceProvider } from '../../packages/server-core/src/memory/repo/RepoSourceProvider.ts'

const LESSONS_PER_BANK = 200
const HISTORY_DAYS = 30
const CATEGORIES = ['workflow', 'preference', 'knowledge', 'correction'] as const

function isoDay(offset: number, day: number): string {
  return new Date(Date.UTC(2026, 8, 1 + day, 10, 0, offset)).toISOString()
}

function buildLessons(scope: 'main' | 'workspace', count: number): RepoSourceLesson[] {
  const lessons: RepoSourceLesson[] = []
  for (let i = 0; i < count; i++) {
    const category = CATEGORIES[i % CATEGORIES.length]!
    const rule = `${scope === 'main' ? 'Always' : 'Prefer'} ${category} rule ${i} for module ${i % 37}`
    const createdAt = isoDay(i % 60, i % HISTORY_DAYS)
    lessons.push({
      lessonKey: rule.toLowerCase().trim(),
      rule,
      category,
      negative: i % 7 === 0,
      pinned: i % 23 === 0,
      disabled: i % 41 === 0,
      tags: [category, `module-${i % 37}`],
      createdAt,
      ...(i % 5 === 0 ? { updatedAt: createdAt } : {}),
      source: i % 3 === 0 ? { trigger: 'explicit', sessionId: `sess-${i % 50}` } : { trigger: 'distillation', proposalId: `p-${i}` },
    })
  }
  return lessons
}

function buildHistory(): Array<{ date: string; content: string }> {
  const history: Array<{ date: string; content: string }> = []
  for (let d = 0; d < HISTORY_DAYS; d++) {
    const date = new Date(Date.UTC(2026, 8, 1 + d)).toISOString().slice(0, 10)
    history.push({
      date,
      content: `# ${date}\n\n## Итоги\n- Прошли ревью модуля ${d % 37}, починили флейки.\n- Дистилляция записала ${3 + (d % 5)} наблюдений.\n\n## Решения\n- Оставили детерминированную проекцию памяти.\n`,
    })
  }
  return history
}

function dirBytes(path: string): number {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const abs = join(path, entry.name)
    if (entry.isDirectory()) total += dirBytes(abs)
    else if (entry.isFile()) total += statSync(abs).size
  }
  return total
}

function gitShow(repoPath: string, args: string[]): string {
  return execFileSync('git', ['--git-dir', join(repoPath, '.git-rox'), '--work-tree', repoPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

function bounded(text: string, lines = 40): string {
  return text.split('\n').slice(0, lines).join('\n')
}

function ms(start: number): string {
  return `${Math.round(performance.now() - start)} ms`
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'memory-repo-spike-'))
  const configDir = join(root, 'config')
  const workspaceRoot = join(root, 'workspace')
  const mainLessons = buildLessons('main', LESSONS_PER_BANK)
  const wsLessons = buildLessons('workspace', LESSONS_PER_BANK)

  const mainBundle: RepoSourceBundle = {
    bankId: 'main',
    scope: 'main',
    lessons: mainLessons,
    context: null,
    preferences: '# Профиль\n\n- Предпочитает краткие ответы.\n- Пишет по-русски.\n',
    history: [],
  }
  const wsBundle: RepoSourceBundle = {
    bankId: 'ws:spike',
    scope: 'workspace',
    workspaceName: 'Spike Workspace',
    lessons: wsLessons,
    context: '# Контекст\n\nРабочий корпус для замера WP-01.\n',
    preferences: null,
    history: buildHistory(),
  }

  const provider: RepoSourceProvider = {
    listBanks: async () => [
      { id: 'main', scope: 'main', label: 'main', repoPath: memoryRepoPath({ configDir }, 'main'), isMain: true },
      { id: 'ws:spike', scope: 'workspace', label: 'Spike Workspace', repoPath: memoryRepoPath({ configDir }, 'ws:spike'), isMain: false },
    ],
    loadBundle: async (bankId: string) => (bankId === 'main' ? mainBundle : wsBundle),
  }

  const git = createGitExec()
  const service = new MemoryRepoService({ configDir, git, provider, debounceMs: 5 })

  const mainRepo = service.repoPathFor('main', '')
  const wsRepo = service.repoPathFor('ws:spike', '')

  const tMain = performance.now()
  const mainResult = await service.materialize('main', 'spike')
  const mainMs = ms(tMain)

  const tWs = performance.now()
  const wsResult = await service.materialize('ws:spike', 'spike')
  const wsMs = ms(tWs)

  const tNoop = performance.now()
  const noopResult = await service.materialize('main', 'spike')
  const noopMs = ms(tNoop)

  const cycleMs = Math.round(performance.now() - tMain)

  // Third measurement: a real change (5 more lessons) → readable diff.
  const tChange = performance.now()
  // A real addition of 5 lessons so the third sample diff is a readable change.
  mainBundle.lessons = [
    ...mainLessons,
    ...Array.from({ length: 5 }, (_, i): RepoSourceLesson => {
      const rule = `Always spike addition ${i} for module ${i}`
      return { lessonKey: rule.toLowerCase(), rule, category: 'workflow', negative: false, pinned: false, disabled: false, tags: ['spike'], createdAt: isoDay(90, 0), source: { trigger: 'explicit' } }
    }),
  ]
  const changeResult = await service.materialize('main', 'session')
  const changeMs = ms(tChange)

  const bytes = dirBytes(mainRepo) + dirBytes(wsRepo)
  const gitDirBytes = dirBytes(join(mainRepo, '.git-rox')) + dirBytes(join(wsRepo, '.git-rox'))
  const worktreeBytes = bytes - gitDirBytes
  const per1000 = Math.round((bytes / (LESSONS_PER_BANK * 2)) * 1000)

  const commits = await service.listCommits('main')
  const memoryDiff = gitShow(mainRepo, ['show', '--format=', 'HEAD', '--', 'MEMORY.md'])
  const lessonDiff = gitShow(mainRepo, ['show', '--format=', 'HEAD'])
  const commitStat = gitShow(mainRepo, ['show', '--stat', '--format=%h %s', 'HEAD'])

  // Read APIs + auxiliary write + ownership enumeration.
  const status = await service.status('main')
  const tree = await service.tree('main')
  const memoryFile = await service.readFile('main', 'MEMORY.md')
  const graph = await service.graph('main')
  const zip = await service.exportZip('main')
  await service.writeRepoFile('main', 'DREAMS.md', '# Сны\n\n- прогон WP-01\n')
  const afterAux = await service.materialize('main', 'spike')
  const dirtyAfterNoop = gitShow(mainRepo, ['status', '--porcelain']).trim()
  const bankIds = await service.dreamBankIds()

  // No-git fallback measurement.
  const unavailable: GitExec = { available: async () => false, run: async () => ({ ok: false, stdout: '', stderr: 'git unavailable', code: null }) }
  const snapshotService = new MemoryRepoService({ configDir: join(root, 'snapshot-config'), git: unavailable, provider, debounceMs: 5 })
  const tSnap = performance.now()
  const snapResult = await snapshotService.materialize('ws:spike', 'spike')
  const snapMs = ms(tSnap)
  const snapCommits = await snapshotService.listCommits('ws:spike')
  const snapDiff = snapCommits[0] ? await snapshotService.commitDiff('ws:spike', snapCommits[0].sha) : []

  // Foreign-tree guard: memory repo nested inside a user git repository.
  const foreignRoot = join(root, 'foreign-user-repo')
  mkdirSync(foreignRoot, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: foreignRoot })
  writeFileSync(join(foreignRoot, 'app.ts'), 'export {}\n')
  execFileSync('git', ['add', '-A'], { cwd: foreignRoot })
  execFileSync('git', ['-c', 'user.name=User', '-c', 'user.email=user@example.com', 'commit', '-q', '-m', 'user commit'], { cwd: foreignRoot })
  const foreignRepoDir = join(foreignRoot, '.memory-repo')
  const foreignService = new MemoryRepoService({
    configDir: join(root, 'foreign-config'),
    git,
    provider,
    debounceMs: 5,
    getConfig: () => ({ dreamIntervalHours: 4, dreamNotes: true, repoDir: foreignRepoDir }),
  })
  const foreignRepoPath = foreignService.repoPathFor('main', '')
  const foreignResult = await foreignService.materialize('main', 'spike')
  const foreignStatus = await foreignService.status('main')
  const userLog = execFileSync('git', ['log', '--format=%s'], { cwd: foreignRoot, encoding: 'utf8' }).trim().split('\n')
  const memoryLog = execFileSync('git', ['--git-dir', join(foreignRepoPath, '.git-rox'), '--work-tree', foreignRepoPath, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')

  const report = {
    corpus: { lessonsPerBank: LESSONS_PER_BANK, banks: 2, historyDays: HISTORY_DAYS },
    wallTime: { mainMaterialize: mainMs, workspaceMaterialize: wsMs, noopRematerialize: noopMs, fullCycleMs: cycleMs, addFiveLessons: changeMs, snapshotsMaterialize: snapMs },
    results: { main: mainResult, ws: wsResult, noop: noopResult, change: changeResult, snapshots: snapResult },
    repoBytes: bytes,
    bytesPer1000Lessons: per1000,
    bytesPer1000WorktreeOnly: Math.round((worktreeBytes / (LESSONS_PER_BANK * 2)) * 1000),
    gitDirBytes,
    gitCommitsMain: commits.length,
    readApi: {
      statusMode: status.mode,
      statusHead: status.head?.sha ?? null,
      foreignTree: status.foreignTree,
      treeNodes: tree.length,
      memoryFileBytes: memoryFile.content.length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      zipBytes: zip.bytes,
      banks: bankIds,
      dirtyAfterNoop,
      auxRematerializeCommitted: afterAux.committed,
      auxEdited: afterAux.edited,
    },
    snapshotCommitsWs: snapCommits.length,
    snapshotDiffFiles: snapDiff.length,
    acceptance: {
      cycleUnder2s: cycleMs <= 2000,
      under1MiBPer1000Lessons: per1000 <= 1024 * 1024,
      readableDiffs: lessonDiff.split('\n').length > 0,
    },
    foreignTree: {
      materialized: foreignResult.committed,
      foreignTree: foreignStatus.foreignTree,
      userRepoCommits: userLog,
      memoryRepoCommits: memoryLog.length,
      memoryRepoInsideUserRepo: foreignRepoPath.startsWith(foreignRoot),
    },
  }

  console.log('=== WP-01 memory repo baseline ===')
  console.log(JSON.stringify(report, null, 2))
  console.log('\n--- sample git diff 1/3: commit stat (add 5 lessons) ---\n' + bounded(commitStat, 20))
  console.log('\n--- sample git diff 2/3: MEMORY.md in the change commit ---\n' + bounded(memoryDiff, 40))
  console.log('\n--- sample git diff 3/3: lesson file in the change commit ---\n' + bounded(lessonDiff.split('\n---').slice(-2).join('\n---'), 40))
  console.log(`\nartifacts under: ${root}`)

  await service.dispose()
  await snapshotService.dispose()
  await foreignService.dispose()
  rmSync(root, { recursive: true, force: true })
}

await main()