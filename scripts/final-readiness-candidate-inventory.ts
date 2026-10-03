import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFileSync } from 'node:fs'
const root = resolve(import.meta.dir, '..')
const commit = 'de805e0dc7103b49d4c7f0a092d88c8b4222367a'
const baseline = 'f63294ba4fffa7238b46b24e918925a313ad0b12'
const git = (...args: string[]) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`)
  return r.stdout.trimEnd()
}
const files = git('ls-tree', '-r', '--name-only', commit).split('\n')
const manifests = files.filter(p => /^(apps|packages)\/[^/]+\/package\.json$/.test(p)).sort()
const changed = git('diff', '--name-status', `${baseline}...${commit}`).split('\n')
const url = (p: string) => `https://github.com/rox-one/rox-one/blob/${commit}/${p}#L1`
let text = `# [CANDIDATE-INVENTORY] Assembled branch architecture and dependencies\n\nPinned candidate: \`${commit}\`, PR1322. This is an unmerged source candidate, not a replacement for the main-only inventory or a verified production deployment. Every declared dependency below is read from this exact Git tree.\n\n## [CANDIDATE-WORKSPACES] All ${manifests.length} workspaces\n\n| Workspace | Manifest | Tracked source paths |\n| --- | --- | ---: |\n`
for (const p of manifests) {
  const prefix = p.slice(0, -'package.json'.length)
  text += `| \`${prefix.slice(0, -1)}\` | [manifest](${url(p)}) | ${files.filter(f => f.startsWith(prefix)).length} |\n`
}
text += '\n## [CANDIDATE-ARCHITECTURE] Additional layers and changed contracts\n\n'
text += '- **Workspace service:** new `apps/workspace-service` Bun HTTP/WebSocket executable with build/typecheck/test/package scripts and SQL migrations; it is an additional deployable service, not proof that production storage/auth/deployment has been configured.\n'
text += '- **Authority and persistence:** server-side native authority/journal, Notes canonical writer and caller ACK boundary; account-replica encrypted durable outbox and Notes-focused collaboration synchronization; scheduler occurrence and agent budget durability.\n'
text += '- **Product surface:** Search and project roadmap/OKR, repository snapshots and AI context, native project projections, richer Notes editors/table/outline, Compound legal evidence and other work described in the surface reconciliation. September and Compound lineages must be preserved when integrating later fixes.\n'
text += '- **Provider/runtime:** additional OMP startup/model/transport, voice/privacy, code intelligence/repository connections and source-truth controls. Registered provider implementations and actual external account readiness remain separate.\n'
text += '- **Build and delivery:** browser shim/capability fences, subprocess/native staging controls, real standalone server lifecycle smoke and legal/SBOM tooling. Existing Docker/platform/release inconsistencies and omitted workspace gates remain listed in the platform review.\n'
text += '\nThese statements are source observations. See [service reconciliation](11-service-reconciliation.md), [surface reconciliation](10-surface-reconciliation.md), [platform reconciliation](12-platform-reconciliation.md) and [executed candidate checks](15-candidate-verification.md) for exact code and limits.\n'
for (const p of ['package.json', ...manifests]) {
  const pkg = JSON.parse(git('show', `${commit}:${p}`))
  text += `\n## [CANDIDATE-DEP] ${pkg.name} — [${p}](${url(p)})\n\n| Dependency | Constraint | Role |\n| --- | --- | --- |\n`
  let count = 0
  for (const role of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const [name, version] of Object.entries(pkg[role] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    text += `| \`${name}\` | \`${version}\` | ${role} |\n`
    count++
  }
  if (!count) text += '| None declared | — | Source/contracts package |\n'
}
writeFileSync(join(root, 'docs/final-readiness/14-candidate-inventory.md'), text)
writeFileSync(join(root, 'docs/final-readiness/evidence/candidate-source-inventory.json'), JSON.stringify({ commit, baseline, trackedPaths: files.length, workspaces: manifests.map(p => ({ path: p, manifest: JSON.parse(git('show', `${commit}:${p}`)) })), changes: changed, limits: 'Source inventory only. External submodules/provider implementations and deployments are not traversed.' }, null, 2) + '\n')
console.log(JSON.stringify({ commit, workspaces: manifests.length, sourcePaths: files.length, changedPaths: changed.length }))
