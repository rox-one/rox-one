import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dir, '..')
const dir = join(root, 'docs/final-readiness')
const snapshot = JSON.parse(readFileSync(join(dir, 'evidence/progress-snapshot.json'), 'utf8'))
const history = JSON.parse(readFileSync(join(dir, 'evidence/pull-request-history.json'), 'utf8'))
const candidate = 'de805e0dc7103b49d4c7f0a092d88c8b4222367a'
const git = (...args: string[]) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`)
  return r.stdout.trimEnd()
}
const baselineInput = JSON.parse(readFileSync(join(dir, 'evidence/main-baseline-input.json'), 'utf8'))
const baselineRecords = baselineInput.tasks
const branchCatalog = snapshot.heads.map((h: any) => {
  const prs = history.filter((p: any) => h.refs.some((ref: string) => ref.replace(/^refs\/(heads|remotes\/origin)\//, '') === p.headRefName))
  const matches = baselineRecords.filter((task: any) => task.codeReferences.some((url: string) => {
    const path = decodeURIComponent(url.replace(/^.*\/blob\/[a-f0-9]+\//, '').split('#')[0])
    return h.changedPaths.includes(path)
  })).map((task: any) => task.id)
  return { ...h, pullRequests: prs.map((p: any) => ({ number: p.number, state: p.state, title: p.title, url: p.url, headRefOid: p.headRefOid, mergedAt: p.mergedAt, mergeCommit: p.mergeCommit?.oid })), taskPathMatches: matches, evidenceMeaning: 'Path overlap is a discovery candidate only. Branch-name PR matches and ancestry are recorded separately; neither establishes full implementation or release verification. MERGED may use squash/rebase commits and does not prove every current head change exists in main.' }
})
writeFileSync(join(dir, 'reconciliation/branch-catalog.json'), JSON.stringify({ capturedAt: snapshot.capturedAt, baseline: snapshot.baselineCommit, historyCount: history.length, heads: branchCatalog }, null, 2) + '\n')

const reviewNames = ['surface-review.json', 'service-review.json', 'platform-review.json']
const reviews = reviewNames.map(name => {
  if (!existsSync(join(dir, 'reconciliation', name))) throw new Error(`Waiting for ${name}`)
  return JSON.parse(readFileSync(join(dir, 'reconciliation', name), 'utf8'))
})
const manual = Object.assign({}, ...reviews.map(r => r.tasks))
const additions: Record<string, any> = {}
for (const review of reviews) {
  for (const collection of [review.newTasks, review.additionalTasks]) {
    if (!collection) continue
    if (Array.isArray(collection)) for (const task of collection) additions[task.id] = task
    else Object.assign(additions, collection)
  }
}
const tasks: Record<string, any> = {}
for (const record of baselineRecords) {
  const parent = record.id.split('.')[0]
  const reviewed = manual[record.id] ?? manual[parent]
  if (!reviewed) throw new Error(`No source review for ${record.id}`)
  const pathCandidates = branchCatalog.filter((h: any) => h.headOnly && h.taskPathMatches.includes(record.id)).map((h: any) => ({ commit: h.commit, refs: h.refs, relation: h.relation, pullRequests: h.pullRequests.map((p: any) => ({ number: p.number, state: p.state })) }))
  tasks[record.id] = { ...reviewed, inheritedFrom: !manual[record.id] ? parent : null, integrationStatus: 'Full task release DoD is not closed on main; reviewed branch changes require explicit feature-preserving integration.', fullTargetVerification: 'A Windows 10/11, B signed/installed macOS and C hosted authenticated browser acceptance remains open unless a task-specific evidence packet explicitly proves its bounded subset.', discoveryCandidates: pathCandidates, discoveryMeaning: 'Exact code-reference file changed in branch history; not an implementation verdict.' }
}
// Added tasks are already written by reviewers/root with complete acceptance fields.
for (const name of readdirSync(dir).filter(n => /^(10|11|12|13)-.*\.md$/.test(n))) {
  const content = readFileSync(join(dir, name), 'utf8')
  for (const match of content.matchAll(/^#{2,6}\s+\[([A-Z]+-\d{3}(?:\.\d+)?)\][^\n]*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/gm)) {
    if (tasks[match[1]]) continue
    const added = additions[match[1]] ?? {}
    tasks[match[1]] = { ...added, disposition: added.disposition ?? added.assessment ?? 'newly-discovered-completion-or-qualification-work', evidenceLevel: 'pinned-source-and-source-review; full acceptance open', integrationStatus: 'Open; source existence does not close acceptance.', fullTargetVerification: 'Execute the task-specific A/B/C requirements, DoD and full verification/test method.', sourceChanges: added.sourceChanges ?? (added.assessment ? [added.assessment] : []), codeReferences: [...new Set([...match[2].matchAll(/https:\/\/github\.com\/rox-one\/rox-one\/blob\/[^\s)]+/g)].map(m => m[0]))], remainingWork: added.remainingWork ?? ['Complete the explicit task description and record an integrated candidate plus target-specific acceptance evidence.'], discoveryCandidates: [] }
  }
}
const progress = { schemaVersion: 1, capturedAt: snapshot.capturedAt, baselineCommit: snapshot.baselineCommit, candidateCommit: candidate, originalTasks: baselineRecords.length, totalTasks: Object.keys(tasks).length, policy: 'Source review, branch integration, scoped automated checks and complete release DoD are independent. No full task is marked complete solely from a diff, PR title or green check.', tasks }
writeFileSync(join(dir, 'reconciliation/task-progress.json'), JSON.stringify(progress, null, 2) + '\n')

for (const name of [...new Set(baselineRecords.map((r: any) => r.document))] as string[]) {
  let text = baselineInput.documents[name]
  text = text.replace(/^(# [^\n]+\n)/, '$1\n**Current scope:** Historical `main` findings below are retained as the baseline. Each task now carries branch reconciliation and remaining work. Read [09 — source reconciliation](09-source-reconciliation.md) and the latest candidate checks before assigning implementation. A baseline gap may already have a branch implementation.\n')
  text = text.replace(/(^#{2,6}\s+\[([A-Z]+-\d{3}(?:\.\d+)?)\][^\n]*\n)/gm, (_whole, heading, id) => {
    const p = tasks[id]
    const stringify = (v: any) => typeof v === 'string' ? v : JSON.stringify(v)
    const changes = (p.sourceChanges ?? []).map(stringify).join(' ')
    const remaining = (p.remainingWork ?? p.remaining_work ?? []).map(stringify).join(' ')
    const refs = (p.codeReferences ?? []).map((ref: any) => {
      const url = typeof ref === 'string' ? ref : ref.url
      return url ? `[branch source](${url})` : ''
    }).filter(Boolean).join('; ')
    return `${heading}\n**Reconciled implementation:** ${p.disposition ?? p.implementationStatus ?? 'See source review'} — ${p.evidenceLevel ?? 'source review'}.${p.inheritedFrom ? ` Review inherited from ${p.inheritedFrom}; no independent child acceptance is inferred.` : ''}\n\n**Observed branch progress:** ${changes || 'No additional implementation closure established by the reviewed sources; qualify existing functionality against the baseline acceptance.'}\n\n**Integration status:** ${p.integrationStatus}\n\n**Verification status:** ${p.fullTargetVerification} See [candidate check evidence](15-candidate-verification.md) for executed compiler/test subsets.\n\n**Remaining work after reconciliation:** ${remaining || 'Retain and integrate existing working behavior; satisfy the task-specific requirements below and close remaining full functional acceptance.'}\n\n${refs ? `**Reviewed branch code:** ${refs}\n\n` : ''}`
  })
  writeFileSync(join(dir, name), text.trimEnd() + '\n')
}
console.log(JSON.stringify({ originalTasks: baselineRecords.length, reconciledTasks: Object.keys(tasks).length, headsCatalogued: branchCatalog.length }))
