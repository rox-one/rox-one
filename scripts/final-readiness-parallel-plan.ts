import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const dir = resolve(root, 'docs/final-readiness')
const load = (path: string) => JSON.parse(readFileSync(resolve(dir, path), 'utf8'))
const backlog = load('backlog.json')
const latePRs = load('parallel-work/pr-late-arrivals.json')
const ui = load('parallel-work/surface-plan.json')
const svc = load('parallel-work/service-plan.json')
const os = load('parallel-work/platform-plan.json')
svc.sourcePolicy.afterMerge = svc.sourcePolicy.afterMerge.replace('Rebase/merge', 'Merge')
writeFileSync(resolve(dir, 'parallel-work/service-plan.json'), JSON.stringify(svc, null, 2) + '\n')
const hash = createHash('sha256').update(readFileSync(resolve(dir, 'backlog.json'))).digest('hex')
for (const expected of [ui.input.sha256, svc.backlogSha256, os.backlogSha256]) {
  if (expected !== hash) throw new Error('Allocation belongs to a different backlog snapshot')
}
const parentIds = new Set(backlog.tasks.map((t: any) => t.parentId).filter(Boolean))
const leaves = backlog.tasks.filter((t: any) => !parentIds.has(t.id))
const allocations = new Map<string, any>()
const assign = (ids: string[], data: any) => {
  for (const id of ids) {
    if (allocations.has(id)) throw new Error(`Duplicate task owner: ${id}`)
    allocations.set(id, data)
  }
}
for (const p of ui.leafWorkPackages) assign(p.taskIds, {
  workPackage: p.packageId, owner: p.implementationOwnership.moduleOwnerId,
  writePaths: p.implementationOwnership.writePaths,
  startNow: p.startNowWork, dependencies: p.dependencies,
  targetActivities: p.platformActivities, allocationFile: 'surface-plan.json',
})
for (const p of svc.workPackages) {
  for (const lane of p.independentLeafLanes) assign([lane.taskId], {
    workPackage: `${p.id}/${lane.taskId}`, owner: p.id,
    writeBoundary: lane.sourceEditingBoundary, sharedContractIds: p.sharedContractIds,
    startNow: p.startNow, requiredOutput: lane.requiredOutput,
    hardAcceptanceDependencyIds: lane.hardDependencyIds, allocationFile: 'service-plan.json',
  })
}
for (const p of svc.integrationWorkPackages) assign(p.leafTaskIds, {
  workPackage: p.id, owner: p.owner, startNow: p.canStartNow,
  hardAcceptanceDependencyIds: p.hardDependencyIds, allocationFile: 'service-plan.json',
})
for (const p of os.workPackages) assign(p.exactLeafTaskIds, {
  workPackage: p.id, owner: p.owner, writePaths: p.exclusiveWritePaths,
  sharedContractIds: p.sharedFileOwners, startNow: p.startNow,
  environments: p.environments, produces: p.produces,
  hardAcceptanceDependencies: p.hardDependencies, allocationFile: 'platform-plan.json',
})
const leafSet = new Set(leaves.map((t: any) => t.id))
for (const id of allocations.keys()) if (!leafSet.has(id)) throw new Error(`Allocation is not a leaf: ${id}`)
for (const t of leaves) if (!allocations.has(t.id)) throw new Error(`Missing owner: ${t.id}`)
if (leaves.length !== 445 || allocations.size !== 445 || parentIds.size !== 180) throw new Error('Counting contract drift')
const counts: Record<string, any> = {}
for (const t of backlog.tasks) {
  counts[t.family] ??= { descriptions: 0, rollups: 0, leaves: 0 }
  counts[t.family].descriptions++
  counts[t.family][parentIds.has(t.id) ? 'rollups' : 'leaves']++
}
const plan = {
  schemaVersion: 1, repository: 'rox-one/rox-one', generatedAt: new Date().toISOString(),
  backlogSha256: hash, counts: { descriptions: 625, rollups: 180, leaves: 445, families: counts },
  executionPolicy: {
    countOnceByLeafId: true, parentAcceptanceIsAdditionalBreadthNotAnExtraJob: true,
    sourcePreparationCanStartNow: true, taskStartRequiresAllOtherDomainsComplete: false,
    gatesApplyToNamedConsumedOutputAndPhase: true, oneSharedFilePromotionOwner: true,
    gitPolicy: 'Merge only; no rebase. Preserve original dirty worktrees.',
    actualCapacity: 'Four agent slots in this session, including root. Allocation does not claim445 workers or provisioned GUI/signing/hosting resources.',
    prDeliveryReceipt: 'pr-integration-receipt.json',
    initialPullRequestCount: latePRs.initialCapturedPRCount,
    currentRequestedPullRequestCount: latePRs.currentRequestedPRCount,
  },
  tasks: leaves.map((t: any) => ({
    id: t.id, family: t.family, parentId: t.parentId, title: t.heading,
    backlogDocument: t.document, codeReferences: t.codeReferences,
    existingProgress: t.progress?.disposition, existingFullDoDClosed: t.progress?.fullOriginalDoDClosed === true,
    dispatchState: 'ALLOCATED_NOT_YET_FULLY_EXECUTED', allocation: allocations.get(t.id),
    Requirements: t.Requirements, DoD: t.DoD,
    'Full functional verification': t['Full functional verification'], 'Test method': t['Test method'],
  })),
  rollups: backlog.tasks.filter((t: any) => parentIds.has(t.id)).map((t: any) => ({
    id: t.id, children: leaves.filter((c: any) => c.parentId === t.id).map((c: any) => c.id),
    document: t.document, Requirements: t.Requirements, DoD: t.DoD,
    'Full functional verification': t['Full functional verification'], 'Test method': t['Test method'],
  })),
  hardAcceptanceEdges: { services: svc.hardDependencies, surfaces: ui.hardAcceptanceEdges,
    platforms: os.workPackages.flatMap((p: any) => p.hardDependencies.map((d: any) => ({ consumerPackage: p.id, ...d }))) },
  sharedOwnership: { services: svc.sharedContractOwners, surfaces: ui.sharedPathCoordination, platforms: os.sharedFileOwnership },
  mandatoryRuntimeSequences: svc.mandatoryRuntimeSequences,
  environmentProvisioning: os.environments,
  validation: { uniqueLeafAssignments: 445, unassigned: 0, duplicates: 0, unknownTaskIds: 0, acceptancePreserved: true },
}
writeFileSync(resolve(dir, 'parallel-work/launch-plan.json'), JSON.stringify(plan, null, 2) + '\n')
const esc = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
let md = `# [PW] Parallel launch plan: all product targets and exact task ownership\n\nThis plan schedules the audited work; it does not declare445 tasks completed or445 executors running. Source and runtime progress must be re-evaluated against the actual integrated revision in [the PR integration receipt](parallel-work/pr-integration-receipt.json). Historical source evidence remains bound to its original commit.\n\n## [PW-COUNT] Exact count without double-counting\n\n**625 descriptions =445 executable leaves +180 parent acceptance rollups.** There are182 parent-marked records and443 subtask-marked records; standalone \`QA-012\` and \`INT-018\` are leaves even though they have no parent. Parent breadth, combinations and full DoD still require proof. Implementation, unit tests and four target lanes reuse the same leaf ID.\n\n| Family | Descriptions | Rollups | Executable leaves |\n| --- | ---: | ---: | ---: |\n`
for (const [family, n] of Object.entries(counts) as any) md += `| ${family} | ${n.descriptions} | ${n.rollups} | ${n.leaves} |\n`
md += `\nFull machine-readable dispatch: [445 leaves, exact owners, code references, requirements, DoD and tests](parallel-work/launch-plan.json). Backlog input SHA-256: \`${hash}\`.\n\n## [PW-LAUNCH] Start now\n\n1. Root integrates the19 requested PR heads (17 initial plus two late arrivals) without dropping either side's behavior; records changed contracts, focused tests and remote merged states. Integration has a single promotion owner. Draft status alone is not a product defect; qualify substantive changes before publishing.\n2. Launch Windows, macOS and hosted Web source/build/environment work simultaneously. They consume the same versioned shared contracts and can build separate preliminary artifacts immediately. No target waits for another target to finish.\n3. Launch the84 service leaves and237 UI leaves in isolated source branches, bounded by actual executor capacity. Probe existing implementations first; finish the remaining requirements instead of rewriting features already delivered by PRs.\n4. Launch37 integration leaves and43 QA/release/recheck leaves: scenarios, fixtures, CI, typecheck repairs, accessibility, security and recovery work start now. Actual composed acceptance consumes concrete outputs as they become available.\n5. Provision GUI machines, signing, provider sandboxes, staging TLS/storage and target browsers concurrently; a missing environment delays its specific runtime proof only.\n6. Review dirty Compound/OMP/sidebar work read-only; capture exact deltas and adopt reviewed changes into isolated branches. Existing user worktrees and active data remain preserved.\n\n**Dispatch mechanics:** one root integrator plus three active worker slots in this session. Initially assign workers to (a) Windows build/native/install, (b) macOS build/native/signing and (c) hosted Web build/identity/ops; root promotes scoped patches and runs integration gates. Rotate finished or externally blocked workers to the next ready leaf. More workers/runners may expand independent domain lanes; capacity is not inferred from task count. Each assignment records source SHA, leaf IDs, owner, allowed paths, contract inputs, artifact directory and exact acceptance commands. Shared-file owners promote bounded patches; consumers may continue in separate worktrees.\n\n## [PW-TARGETS] All target lanes start in parallel\n\n| Package | Owner | Exact leaf IDs | Initial outputs / gate scope |\n| --- | --- | --- | --- |\n`
for (const p of os.workPackages) md += `| ${p.id}: ${esc(p.title)} | ${p.owner} | ${p.exactLeafTaskIds.join(', ')} | ${esc(p.produces.join('; '))} |\n`
md += `\n[Platform allocation](parallel-work/platform-plan.json) includes source references, full per-leaf acceptance, shared files, output-phase dependencies and22 environment types to provision independently. Windows10 and11 need separate installed GUI receipts. macOS arm64/Intel and the declared minimum OS need recorded runtime evidence. Signing/notarization/updates require real identities and actual artifact bytes. Hosted Web requires an authenticated server, HTTPS/WSS, persisted storage and real browser workflows; a static renderer or HTTP200 does not close its DoD.\n\n**Hosted identity decision:** use isolated account/workspace authorization as the planning assumption; personal hosted mode may reuse the same explicit ownership contract. Confirm the product mode before committing a new identity schema. Source/build/browser adapter and staging preparation can proceed independently.\n\n## [PW-DOMAINS] Services and microservices\n\nBoth leaves in each domain envelope can begin in parallel in isolated branches. Shared protocol/auth/SQLite/secrets/process/version files have one promotion owner. Existing contract fixtures allow consumer implementation before producer changes are complete.\n\n| Domain envelope | Leaf IDs | Shared contract owners |\n| --- | --- | --- |\n`
for (const p of svc.workPackages) md += `| ${p.id}: ${esc(p.title)} | ${p.leafTaskIds.join(', ')} | ${p.sharedContractIds.join(', ')} |\n`
md += `\n[Service/integration allocation](parallel-work/service-plan.json) lists42 domain envelopes,84 independent service lanes,37 integration leaves,16 shared contract owners and22 consumed-output edges. OMP decoder/branch handling, RPC shapes, authority, credentials, migrations and native custody require exact contract compatibility; they do not impose a blanket service-before-UI schedule.\n\n## [PW-SURFACES] Every screen/function/module\n\n[Surface allocation](parallel-work/surface-plan.json) gives237 individually assigned UI leaves across81 surface owners, including exact paths, code references through the full dispatch export, native/browser prerequisites and full original acceptance. Each starts with source inspection, isolated patch, component/negative/race tests and fixture preparation. Four target activities per UI leaf produce948 verification activities; these are not948 additional tasks.\n\n| Surface owner | Parent scope | Leaf IDs |\n| --- | --- | --- |\n`
for (const p of ui.parentRollups) md += `| ${p.packageId} | ${esc(p.title)} | ${p.childTaskIds.join(', ')} |\n`
md += `\n## [PW-HARD-ORDER] Only unavoidable output dependencies\n\nThese are phase gates, not prerequisites to start whole tasks. Existing qualified producer outputs can satisfy a gate immediately; no artificial wait for the entire producer's DoD.\n\n| Producer result | Dependent operation | Why sequence is unavoidable | Work continuing in parallel |\n| --- | --- | --- | --- |\n| Versioned payload/capability contract | Full cross-runtime serialization/permission proof | Both ends must interpret the same real message | Adapter/components/negative fixtures against the current contract |\n| Trusted actor + current workspace grant | Protected real read/write/subscription | Authorization must precede that operation | Screen/state/race tests and unrelated domains |\n| Reviewed schema/native-owner migration | First write into migrated persistent store | Ownership/schema must exist before writing | Migration fixtures, UI and other stores |\n| Durable operation commit/ACK | Readback, replay and restart proof | A receipt cannot prove a nonexistent committed operation | Other leaf implementation and independent operations |\n| Target native binaries/helper manifest | Installer/app assembly | Packaging consumes actual target bytes | Build scripts, installer UX, other target artifacts |\n| Built artifact + authorized signing identity | Sign/notarize/staple/verify installation | Signature covers actual artifact bytes | Unsigned smoke tests, other targets, environment provisioning |\n| Signed N and N+1 + update feed | Real upgrade/interruption/rollback proof | Two versions are inputs to an upgrade | Updater unit tests, feed scripts, other features |\n| Qualified server/runtime + TLS/WSS + durable storage | Real hosted login/reconnect/upload/restart journeys | Browser operations require a reachable correctly configured server | Web components, adapters, local contract tests |\n| Provider grant and permitted test account | Real external send/write/readback/revoke | Side-effect execution requires that grant/account | Synthetic negative tests and unrelated providers |\n| Exact integrated source/lock/artifact bytes | Final SBOM/provenance/regression/signoff | Release evidence must describe the shipped revision | Continuous preliminary testing of each ready domain |\n\n[Exact service edges](parallel-work/service-plan.json), [surface consumed outputs](parallel-work/surface-plan.json) and [platform phase edges](parallel-work/platform-plan.json) identify producer/consumer IDs. Reciprocal platform package references concern different phases (native staging versus installed verification); they are not cyclic whole-package waits. Final candidate binding is a release replay gate, not a development freeze.\n\n## [PW-COORDINATION] Collisions are local coordination\n\n- Root dependency/lock/CI owner promotes version updates and frozen-install results. Consumers implement in separate checkouts; no simultaneous writes to one checkout.\n- Transport/auth owners approve additive DTO/capability changes. Domain owners write their handlers, tests and adapters independently.\n- UI shell/routes and broad shared components use one file promotion owner, with parallel bounded patches and isolated tests. A shared path is not a reason to queue an entire module.\n- Signing and GUI/media hardware are leased per run. Serialize only conflicting use of that resource; other environments/tests continue.\n- Never discard cloud/Compound/September behavior by selecting an entire conflict side. Inspect both contracts and preserve stronger ownership, revision and request-scope checks.\n\n## [PW-ACCEPTANCE] Handoff and closure requirements\n\nEach leaf dispatch ends with its existing **Requirements / DoD / Full functional verification / Test method**, preserved verbatim in [launch-plan.json](parallel-work/launch-plan.json). The worker supplies source SHA and patch, frozen-lock/toolchain details, target/artifact hash, executed commands with exit codes, readback and negative/race/restart receipts, and explicit unavailable environment/provider outputs. Preliminary fixtures and source presence do not close full functional DoD. Parent owners additionally replay the parent breadth/combination workflow after all relevant child evidence exists.\n\n**Launch-plan DoD:** all445 leaves assigned exactly once;180 parent rollups preserved; all three targets scheduled now; hard gates named by actual consumed output and phase; full acceptance and immutable code references retained; PR integration receipt distinguishes local lineage, remote merged states and unresolved verification.\n\n**Launch-plan verification/test:** run \`bun scripts/final-readiness-parallel-plan.ts\` to validate the input hash and exact leaf partition, then \`bun scripts/final-readiness-audit.ts --validate\` to verify original625 task blocks and pinned code references. Recheck PR states/main SHA independently after publication.\n`
writeFileSync(resolve(dir, '16-parallel-launch-plan.md'), md)
console.log(JSON.stringify(plan.validation))
