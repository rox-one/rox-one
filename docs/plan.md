# План исследования и владельцы

## ROX Suite — новый task graph

| Task | Owner | Inputs | Artifact | Verify | State |
|---|---|---|---|---|---|
| suite-product | lead | screenshot1/5/8 + source | 10 issue drafts | source/ranges/UI/domain/DoD | complete |
| suite-collaboration | macro_collab | screenshot2/5 + source | 7 issue drafts | principal/message/document identity | complete |
| suite-meetings | macro_domains | screenshot3/4 + source | 5 issue drafts | local/media/provider distinction | complete |
| suite-services | rox_audit | screenshot6/7 + source | 8 issue drafts | scopes/approvals/signature evidence | complete |
| suite-review | lead/team | all30 drafts | machine manifest + corrections | DAG/schema/source/privacy checks | complete |
| suite-publish | lead | reviewed drafts | 30 new GitHub issues | idempotent publish + exact readback | complete |
| suite-delivery | lead | receipts/R4 | docs commit/push | remote blobs + preserved user edits | ready_for_delivery |

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
| v4-delivery | lead | reviewed bundle | commit/push/readback | clean tree / remote blob hashes | ready_for_delivery |

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
