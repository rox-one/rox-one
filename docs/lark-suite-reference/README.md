# Lark Suite, portable knowledge и Code Intelligence → ROX

**Исследование + PRD/spec/implementation plans, Revision 2.** Дата 2026-09-30. Рабочий source baseline ROX: `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; документация этого пакета появляется в отдельном delivery commit. Нельзя запускать cloud agent только с baseline checkout: требуется source/spec package revision и hash из delivery manifest.

Remote `main` перепроверен при доставке: `f63294ba4fffa7238b46b24e918925a313ad0b12`. `git diff --name-only e953786… f63294b… -- apps packages` пуст: проверенные product source files совпадают; docs branch продолжает прежний delivery lineage без изменения чужой ветки.

## Начать здесь

1. [Executive summary](00-executive-summary.md) — короткое решение и critical path.
2. [Live audit](01-live-product-audit.md) — реальные Lark screens, evidence labels, gates и failed attempts.
3. [Core Suite](02-core-suite.md) — Docs/Sheets/Drive/Wiki/Base/Forms/Chat/Contacts/Meetings/Calendar/Tasks/Mail/Favorites/Templates/Reminders/Announcements/OKR/Subscriptions.
4. [Business ecosystem](03-business-ecosystem.md) — Help Desk/Attendance/Workplace/Admin/Approval/Recruitment/Leave/Purchase/OOO/Reimbursement/Report/Lingo/Moments/Meegle/Coze/Tanca/Seleam/DocuGenius.
5. [Obsidian source audit](04-obsidian-reference-audit.md) — 11 pinned sources + md-dragger, actual mechanisms, licensing and limits.
6. [Rox Bases PRD/spec](05-rox-bases-design.md) — 7 views, 18 types, native projections, relations/formulas/ACL/migration.
7. [Rox Docs PRD/spec](06-rox-docs-design.md) — 12 screens, blocks, comments, ToC, Map/Outline, keyboard/touch/highlights/actions/drag/tabs/columns/code/planner.
8. [Target entity model/ERD](07-domain-entity-model.md) — exact existing refs, page subtypes, owner scopes, events/outbox.
9. [Automations](08-automation-integration.md) — 9 concrete screens, typed nodes, executor/recovery/approval.
10. [Implementation plan](09-implementation-plan.md), [Test/DoD](10-test-plan.md), [Decisions/unknowns](11-decisions-open-questions.md), [Independent critical review](12-critical-review.md).
11. [Code Intelligence source/design](13-code-intelligence.md), [UI screens](14-code-intelligence-ui.md) — OpenWiki/GitDiagram/Groma/local code search in Project, Sources, Docs/Wiki and Sessions.

## Machine-readable inputs

Directory [plans/lark-suite-reference](../../plans/lark-suite-reference):

- `core-catalog.json` — 18 core features, 112 documented screens, 75 actions, conceptual entities/relations and source refs.
- `business-catalog.json` — 18 ecosystem records, 58 documented screen entries, 30 forms, 47 official sources and exact ROX seams.
- `capabilities.json` — central all-requested-alias coverage and separate OBSERVED overlays; duplicate Subscriptions records explained.
- `live-observations.json` + `live-capture-index.json` — 34 meaningful observations / 63 capture attempts, hashes only. Screenshots/AX stay private locally.
- `obsidian-sources.json` — pinned SHAs/licenses/manifests/source files, current ROX gaps, limited actually executed probes.
- `entity-graph.json` — proposed target ROX entities/relations, not Lark database.
- `work-packages.json` + `dependency-dag.json` — implementation slices with owner/input/output/exact files/API/DB/events/ACL/UI/tests/acceptance/risk/cloud preflight.
- `code-intelligence.json` — pinned reference repositories, integration contracts and additional work packages.
- `execution-packages.json` + `execution-dag.json` — combined **61 packages /161 edges /255 proposed owned paths**, including the three explicit Docs↔Code Intelligence dependencies and one shared integration owner.
- `issue-drafts.json` + `publication-catalog.json` + `issues/*.md` —61 separate requirements prepared for GitHub; `publication.json` records exact actual remote bodies when published.
- `validation-report.json` — actual artifact checks; explicitly not product runtime proof.
- `delivery.json` — immutable package commit/digest/readback gate; no provider tokens/private data.

## Evidence and verification

Actual research verification: source file/commit/license inspection; live UI through Codex CUA; Ideascape `bun test test/map-file.test.ts` **35pass/0fail** at pinned source; ROX NativeNotesEngine probe proved YAML/CRLF lossless gap and stale CAS rejection. Existing ROX Code Intelligence helper tests ran **4pass/0fail/26assertions**; the source audit retained their limited size/Syft/production-mount coverage. These tests do not establish Obsidian UI or new ROX behavior. Plan schema/ref/DAG checks and11 rejected negative controls are recorded in machine validation. Build new product only using work package gates and actual runtime acceptance.

Rebuild central derived manifests: `bun tools/lark-suite-reference.mjs --build`. Validate after all owned files exist: `bun tools/lark-suite-reference.mjs --validate`. Raw private capture manifest is local, referenced only by opaque IDs/hash; rebuilding does not upload it.

The baseline already includes `@craft-agent/shared/code-intelligence`, local regex/provenance helpers, optional Syft runner and a simple RepoArchitectureExplainer. This packet extends them with bounded on-demand providers; the current capability inventory placeholders are reconciled explicitly before enable. Source hash validation caught and fixed the erroneous classification of existing `types.ts` as a proposed new path.

## Prior delivered work retained

This pack expands [Macro integration](../macro-integration/README.md) and [ROX Suite issues](../rox-suite/README.md). Thirty previously published issues1091–1120 remain independent GitHub deliverables. New plans refine concrete behaviors/authority and link those issues; they are not automatically implemented or relaunched. All product jobs remain **PREPARED_NOT_LAUNCHED**; no provider account setup, app installation or cloud execution was performed here.
