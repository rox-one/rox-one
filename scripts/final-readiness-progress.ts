import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Read-only source reconciliation. No checkout, merge, reset or credential export.
const root = resolve(import.meta.dir, '..')
const dir = join(root, 'docs/final-readiness/evidence')
mkdirSync(dir, { recursive: true })
const run = (args: string[], cwd = root) => {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`${args.slice(0, 3).join(' ')} failed: ${r.stderr.slice(0, 300)}`)
  return r.stdout
}
const main = run(['git', 'rev-parse', 'origin/main']).trim()
const refLines = run(['git', 'for-each-ref', '--format=%(refname)\t%(objectname)\t%(committerdate:iso-strict)', 'refs/heads', 'refs/remotes/origin']).trim().split('\n')
const grouped = new Map<string, { commit: string, committedAt: string, refs: string[] }>()
for (const line of refLines) {
  const [ref, commit, committedAt] = line.split('\t')
  if (!grouped.has(commit)) grouped.set(commit, { commit, committedAt, refs: [] })
  grouped.get(commit)!.refs.push(ref)
}
const heads = [...grouped.values()].map(h => {
  const [mainOnly, headOnly] = run(['git', 'rev-list', '--left-right', '--count', `${main}...${h.commit}`]).trim().split(/\s+/).map(Number)
  const common = spawnSync('git', ['merge-base', main, h.commit], { cwd: root, encoding: 'utf8' })
  const changedPaths = headOnly && common.status === 0 ? run(['git', 'diff', '--name-only', `${main}...${h.commit}`]).trim().split('\n').filter(Boolean) : []
  return { ...h, mainOnly, headOnly, relation: common.status !== 0 ? 'unrelated-history' : !headOnly ? 'contained-in-main' : !mainOnly ? 'ahead-of-main' : 'diverged-from-main', changedPaths, commitUrl: `https://github.com/rox-one/rox-one/commit/${h.commit}` }
})
const rawPRs = JSON.parse(run(['gh', 'pr', 'list', '--repo', 'rox-one/rox-one', '--state', 'open', '--limit', '100', '--json', 'number,title,headRefName,headRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,url,updatedAt,statusCheckRollup']))
const pullRequests = rawPRs.map((p: any) => ({ ...p, statusCheckRollup: (p.statusCheckRollup ?? []).map((c: any) => ({ name: c.name ?? c.context, status: c.status ?? c.state, conclusion: c.conclusion ?? c.state, workflowName: c.workflowName, startedAt: c.startedAt, completedAt: c.completedAt, detailsUrl: c.detailsUrl?.startsWith('https://github.com/') ? c.detailsUrl : undefined })) }))
const blocks = run(['git', 'worktree', 'list', '--porcelain']).trim().split('\n\n')
const locations = blocks.map(block => {
  const lines = block.split('\n')
  return { path: lines.find(l => l.startsWith('worktree '))!.slice(9), commit: lines.find(l => l.startsWith('HEAD '))?.slice(5), ref: lines.find(l => l.startsWith('branch '))?.slice(7) ?? 'detached' }
})
locations.push({ path: '/Users/t/Projects/rox-one-final-audit-20261003', commit: undefined, ref: 'external-original-audit-checkout' })
const worktrees = locations.map(w => {
  try {
    const commit = run(['git', 'rev-parse', 'HEAD'], w.path).trim()
    const dirtyEntries = run(['git', '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--untracked-files=all'], w.path).trimEnd().split('\n').filter(Boolean).map(line => ({ status: line.slice(0, 2), path: line.slice(3) }))
    return { ...w, commit, dirtyEntries, dirtyCount: dirtyEntries.length, capturePolicy: 'path/status only; no uncommitted content, credentials or user data copied' }
  } catch { return { ...w, unavailable: true } }
})
const snapshot = { schemaVersion: 1, capturedAt: new Date().toISOString(), repository: 'rox-one/rox-one', baselineCommit: main, scope: 'All local refs and fetched origin refs, deduplicated by commit; every open PR; all worktrees registered to the canonical repository plus the previous audit checkout. Other clones, closed PRs and external deployments are not a complete inventory.', counts: { refs: refLines.length, uniqueHeads: heads.length, headsOutsideMain: heads.filter(h => h.headOnly).length, openPullRequests: pullRequests.length, worktrees: worktrees.length, dirtyWorktrees: worktrees.filter(w => w.dirtyCount).length }, heads, pullRequests, worktrees }
writeFileSync(join(dir, 'progress-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n')
console.log(JSON.stringify(snapshot.counts))
