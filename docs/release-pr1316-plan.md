# План реализации и владельцы

## Активный implementation graph

| Slice | Owner | Inputs/deps | Output | Acceptance | State |
|---|---|---|---|---|---|
| LSX-WP-001 | implement_content_descriptor + lead integration | frozen spec, existing Notes owner | descriptor decoder/store + native RPC + source status in Notes | alias identity, disk restart, denied source, unknown readonly, actual UI | integration in progress |
| LSX-WP-003 | lead | native owner + revision contract | journal/CAS/receipt + Notes save queue | same-base concurrency, actual process kill/recovery, stale write, typing during save | runtime tests pass; UI pending |
| LSX-WP-005 → 006 | retained_markdown + lead | 001/003 APIs | retained byte spans, YAML patches, stable tree IDs | unrelated byte identity, conflict/rebase, unsupported readonly | core mechanisms verified; native view integration pending |
| CI-001 | implement_repo_binding + lead mount | actual Git + existing Project directory | bindings/snapshots/source spans + RPC/Project UI | real commit/blob/hash, dirty separation, scope/exclusions, restart, actual UI | integration in progress |
| RS-FOCUS-01, #1091 | implementation_runtime_scout | actual Home TaskTrackerWidget | focused quick-add component/local styles | keyboard/pointer/IME/error/theme/zoom, actual browser | verification in progress |
| durable continuation | lead + runtime scout | accepted revision + frozen execution DAG | bound Harness tasks, isolated ownership, receipts | supported worker IDs, real tests, gated full DoD, integrated readback | preparing; cloud unavailable |

Lead owns shared exports, RPC channel map/routing, locale files, existing screen mounts, integration/verification, commit/push and progress ledger. Workers own distinct new paths. No issue closes until full consumer DoD. Existing runtime typecheck failures are recorded and compared to baseline; new failures must be repaired.

Sequencing: native slices → shared owner/event/identity integration → collaborative Docs + human messaging → universal projection/view engine → Base/Task/Calendar interactions → provider Mail/CRM/Calls → Suite workflows and Code Intelligence derived tools. Full normative dependency graphs remain in the delivered machine manifests; this table reports active execution only.

The local Harness is supported; a generic cloud coding worker is not provisioned. Use a revision-bound task receipt to claim a launch. A checkpoint or plan does not prove continued execution. Preserve the original scope in the pending package ledger.

# Архив: план исследования и владельцы

Latest Code Intelligence extension: `/root/lark_core_research` owns13/code-intelligence.json; root owns14 and integration/validation; `/root/rox_knowledge_design` owns independent12 review including new source/UX contracts. Snapshot authority and source-private boundaries extend the existing Lark acceptance; previous completed issues and Macro artifacts remain delivered.

## Lark Suite reference — исследование и публикация завершены

| Task | Owner | Inputs | Artifact | Verification | Status |
|---|---|---|---|---|---|
| live-audit | lead | installed Lark + existing authorized tabs | private captures + sanitized observation manifest | actual screen/controls, documented failures | complete |
| core-research | lark_core_research | official HC/API/SDK | 02-core-suite + core-catalog.json | documented facts/precise source limitations | complete |
| business-research | lark_business_research | official directory/vendor/HC | 03-business-ecosystem + business-catalog.json | native/template/vendor classification | complete |
| portability-bases | rox_knowledge_design | 11 sources + ROX HEAD | 04-audit,05-bases,obsidian-sources | SHA/license/code/probe evidence | complete |
| docs-design | lead | live + current Notes/Tiptap | 06-design + shared entity model | single authority, lossless MD, CRDT boundaries | complete |
| plans-integration | lead | all research | typed packages, DAG, PRD/tests | coverage/schema/deps/privacy | complete |
| challenge | independent worker | combined artifacts | review + corrections | reproduce contract inconsistencies | complete |
| delivery | lead | corrected bundle | commit/push/readback | clean scoped files and remote hashes | complete |

Owned paths are split under docs/lark-suite-reference and plans/lark-suite-reference; lead alone controls native Lark and authenticated Chrome. Existing Macro and RS issues remain delivered, referenced by IDs; this follow-up does not claim product implementation.

Delivery: [receipt](lark-suite-reference/DELIVERY.md), immutable spec commit `242492868a11b4d9af1c1011f20b31a346875f0a`,96 remote blobs PASS,61 new issues exact readback PASS. Concurrent publisher negative control PASS; controlled crash NOT_RUN. All product/cloud jobs remain PREPARED_NOT_LAUNCHED.

## ROX Suite — новый task graph

| Task | Owner | Inputs | Artifact | Verify | State |
|---|---|---|---|---|---|
| suite-product | lead | screenshot1/5/8 + source | 10 issue drafts | source/ranges/UI/domain/DoD | complete |
| suite-collaboration | macro_collab | screenshot2/5 + source | 7 issue drafts | principal/message/document identity | complete |
| suite-meetings | macro_domains | screenshot3/4 + source | 5 issue drafts | local/media/provider distinction | complete |
| suite-services | rox_audit | screenshot6/7 + source | 8 issue drafts | scopes/approvals/signature evidence | complete |
| suite-review | lead/team | all30 drafts | machine manifest + corrections | DAG/schema/source/privacy checks | complete |
| suite-publish | lead | reviewed drafts | 30 new GitHub issues | idempotent publish + exact readback | complete |
| suite-delivery | lead | receipts/R4 | docs commit/push | remote blobs + preserved user edits | complete |

## Revision 4 execution graph

| Task | Owner | Inputs/dependencies | Artifact | Verification | State |
|---|---|---|---|---|---|
| v4-source-delta | lead | remote HEAD / original evidence | v4 recheck + cache-upgrade ADR | blob comparisons, symbols/ranges | complete |
| v4-collaboration-walkthroughs | macro_collab | COL catalogs / ownership | walkthrough Markdown+JSON | step IDs, refs, role/recovery assertions | complete |
| v4-domain-forms | macro_domains | domain catalogs / primary schemas | form Markdown+JSON | field/default/validation/mapping examples | complete |
| v4-cloud-executor | rox_audit | current CloudRun / packets | executor contract+RunSpec schema | alternatives, valid+negative schema cases | complete |
| v4-control-handoff | lead | 219controls / shared authored labels | handoff index / interaction enrichment | exact coverage, Russian copy, negative controls | complete |
| v4-contract-reconciliation | lead | forms / current schema gaps | compiled target amendments / packets | no untyped casts, examples, one dispatcher | complete |
| v4-independent-review | team | all corrected bytes | review findings / resolutions | source/schema/ownership/gate checks | complete |
| v4-delivery | lead | reviewed bundle | commit/push/readback | clean tree / remote blob hashes | complete |

No coding executor launched. Existing61screens/52WPs remain stable; enrichment adds implementation detail, not parallel product surfaces. New runtime observations must be separately measured; prior installed binary screenshots do not certify these specs.

## Revision 3 execution graph

| Task | Owner | Inputs/dependencies | Artifact | Verification | State |
|---|---|---|---|---|---|
| source-head-recheck | lead | original308evidence, GitHub remote | reverification.json +24doc | blobcompare304same/4delta-reviewed | complete |
| current-screen-audit | rox_audit | ROXsource |50screens/68refs/115controls | immutableobjects/ranges | complete |
| collab-leafspec | macro_collab | source+Revision2 |19screens/96controls | queries/commands/roles/routes/interactions | complete |
| domain-leafspec | macro_domains | source+Revision2 |24screens/75controls/58DoD | consent/availability/RSVP/owner/revenue | complete |
| shared-prd-ui | lead | audits | masterPRD/UIcontract/18sharedscreens/48controls |51typedops/domain-specificnegativecases | complete |
| cloud-contracts | lead |52WPs+leafspecs |52packets/manifest/ui-slices/schema/CLI | DAG/hash/leases/lane/prereq/proofgate | complete |
| independent-challenge | workers | allnewdocs/tooling | product/cloud/source review | repair supported findings+negativeprobes | complete |
| final-delivery | lead | allcorrectedbytes | final validation/commit/push/readback | source/schema/Mermaid/tooltests/remotehash | artifact_complete; remote receipt in session completion checkpoint |

Decisions:Project-first Channels, CRM Досье, Calendar Meetings, Inbox existing actionable attention preserved, source excerpt no auto-disclosure, current font semantics retained. Per-WP UI scope supplements shared finalscreen DoD; full surface not declared done at first mechanism slice. Historical completed research graph below.

| ID | Владелец | Вход | Зависимости | Артефакт | Проверка | Статус |
|---|---|---|---|---|---|---|
| baseline | lead | GitHub HEAD, local worktrees | — | fixed SHA, clean audit trees | rev-parse, status | complete |
| rox-audit | rox_audit | ROX baseline | baseline | 03 + evidence-rox | paths/symbols; mechanisms beyond routes | complete |
| collab-audit | macro_collab | Macro baseline | baseline | 07–09,14–16 + evidence | handlers/schema/front paths, four sequences | complete |
| domains-audit | macro_domains | Macro baseline | baseline | 10–13,17 + evidence | CRM/mail/calendar/call lifecycle | complete |
| root-audit | lead | manifests/routes/license/history | baseline | 01,02,18 + source graph | manifest resolved edges; license scope | complete |
| architecture | lead | all audits | rox-audit,collab-audit,domains-audit,root-audit | 00,04–06,19–23 + four JSON | exact ROX seams; slices cover scenarios | complete |
| challenge | independent reviewer | integrated draft | architecture | adversarial findings | supported counterexamples, Revision 2 | complete |
| delivery | lead | final documents | challenge | validation report, commit, remote branch | DAG/schema/refs/paths/required coverage | complete |

Стратегии сравнения: копирование Macro services (лицензионный и эксплуатационный риск); отдельное Macro приложение (не удовлетворяет цели); расширение native ROX через существующий Rox2 seam и единый domain authority (основной кандидат). Уточненные tradeoffs и окончательное решение — в 19.

Исследование завершено: 52 WPs / 154 edges, 38 surfaces / 162 capabilities / 38 entity mappings; Revision 2 и domain amendments интегрированы. 104 schemas, 30 diagrams, 612 commit source links, 308 evidence records, 7 rejected negative controls проходят artifact validator. Product runtime tests — NOT_RUN, future gates в22. Git delivery receipt фиксируется completion checkpoint после push/readback.


## Bounded legacy migration fence plan (2026-09-30)

Owner: compound integration reviewer; lead retains integration and publication. Base: `b9b8aa7197f5d25304ec377a049a8f375eccf3e5`. Scope: one read-only inventory module, its filesystem tests, and these scoped notes. No legacy writer, canonical custody, renderer, dependency, or existing worker checkpoint changes.

1. Import only the reviewed fence module and tests into an isolated branch at the exact base.
2. Run `bun test tests/lark-suite-extension/legacy-markdown-migration-fence.test.ts` using Bun built-ins; check the public diff and artifact hashes.
3. Lead reviews and publishes a draft stacked against `feat/rox-compound-workspace-20260930`.
4. Existing compound integrator separately decides recovery disposition and serial canonical pipeline integration. The inventory stays unwired until an actual preparation path and its authority prerequisites are reviewed.

Verification covers unchanged real fixture bytes, interrupted WAL refusal, unreadable/malformed/symlink state, and deterministic file/parent replacement races. It does not claim complete migration, native UI acceptance, adoption of existing files, or closure of the full compound program.
