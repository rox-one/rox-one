# Облачная реализация: готовый пакет запуска

**PREPARED_NOT_LAUNCHED.**52 индивидуальных заданий находятся в `packets/WP-*.md`, полные machine contracts — `plans/macro-integration/cloud/packets/WP-*.json`; manifest определяет зависимости, ownership, lanes и spec digest. Запуск cloud provider, расходы, credentials и production deployment в этой работе не выполнялись.

## Что получает cloud coding agent

Exact repository/integration SHA; assigned WP; source baselines; goal; existing files and new files; prerequisite verified receipts; API/DB/event contracts; конкретные screen/control references с inputs/outputs/hover/focus/click/keyboard/states; expected user results; DoD; tests; allowed files; required evidence lanes; output branch/patch/receipt. Full original52 package contracts встроены, не заменены коротким prompt.

## Порядок scheduler

1. Checkout выбранного review branch на exact inputSha. Read `AGENTS.md` and assigned packet. Check toolchain/storage/memory/network/test tenant. `bun scripts/macro-integration/cloud/cli.mjs preflight <inputSha>` returns measured machine readiness; no launches.
2. `bun scripts/macro-integration/cloud/cli.mjs ready <inputSha>` computes packages with proven prerequisites and non-overlapping ownership. Empty receipts initially means only DAG roots, не все52 задания. A started job receives an ownership lease recorded by external scheduler; this preparation CLI does not implement a persistent distributed scheduler.
3. Submit packet prompt to выбранный coding executor with isolated repository checkout. Current ROX CloudRunProvider supports prompt packs/artifacts; repository editing/checkout/branch/PR/credential injection/test lanes require dedicated coding executor adapter or a capable external cloud coding service. RunSpec metadata is not enforcement of those capabilities.
4. Collect commit/patch/redacted proof and per-lane receipt; verify commit ancestry and hashes. Pending macOS/provider lane cannot unblock successors. Integrator applies reviewed commits onto integration branch and reruns interface/concurrency seams.
5. Scheduler advances inputSha to integrated commit; dependency commits must be ancestors. Launch next ready work; conflicts serialize. Keep specDigest stable within run; changed requirements require rebuilt packets and review.

## Environments and installation

Reference existing native workflow Bun1.3.14 (`.github/workflows/native.yml`), Linux Node22 test support. Existing CI jobs self-hosted/Blacksmith; this pack creates no hosted runner. Use root frozen lock install and targeted scripts; minimum conservative resources4CPU/8GiB RAM/8GiB domain disk or16GiB renderer disk. Installation peak/asset downloads measured by executor; need larger storage if full native model assets required.

Linux domain sandbox: PostgreSQL/service migrations and fake provider adapters for deterministic domain tests, source snapshots marked fixture. Renderer lane: Chromium + Playwright synthetic tenant, ARIA and real interaction screenshots. macOS: actual source-built Electron/IPC/fonts/device permissions. Provider live: test Gmail/GoogleCalendar/JMAP/LiveKit/object store read-back; not production account. Logs must retain executionMode/lifecycle/verification separately.

## Output and proof

`completion.schema.json` declares receipt fields; gate checks read actual proof files and checksums, dependency commits ancestry, spec digest, lane states, tests/negative control and reviewed output. Proof root per WP, no traversal/symlink outside root. A fabricated log is still possible: independent review and real runtime/read-back are necessary; CLI integrity checks do not independently re-execute every claimed test.

Command `validate` checks plan/screens/packet integrity without credentials. `render WP-10` outputs exact packet. `ready` never calls createRun/gh PR/deploy. Tests use fake receipt objects only as explicitly synthetic controls; they never create feature completion receipts.

`ui-slices.json` закрепляет per-WP stage boundary и дополнительные UI paths: полный экран может ссылаться на несколько пакетов, каждый выполняет свою slice, а не весь экран заново. `contract-amendments.json` связывает старые primary operations и новые screen wrappers с одним dispatcher, добавляет sourceTransfer schema/политику. Shared locale/registry/file ownership консервативно сериализуется; executor не должен расширять allowedPaths по своему усмотрению.

Build order for refreshed screen contracts: `build-shared-screens.mjs` → `enrich-shared-screens.mjs` → `cloud/build.mjs` → `cloud/cli.mjs validate` → targeted gate tests → artifact validator. Rebuild changes specDigest and requires scheduler reconciliation; never reuse old receipts silently.

## Failure recovery

Disk/toolchain missing→preflight blocked with observed value. Provider unknown send→reconcile, never blind resend. Worker crash→resume same branch/command IDs, inspect persisted state. Spec drift→new digest/review. Dependency missing→pending. Parallel conflicting files→serialize owner. Linux-only environment→native/provider work still open. License unresolved→behavior reimplementation/release hold, not silent copy.

Final ownership supplement: `ui-slices.screenPrimaryUiOwners` allocates all collaboration screen implementation seams/tests; `additionalRoutedSeams` allocates actual current catalog/search/memory/automation/share/skills/mail/connection hosts. CLI.validate rejects a screen implementation path or per-owner routed seam missing from allowedPaths. Existing root MeetingsPage and nested meetings page are distinct; Calendar uses the routed catalog, preserving capture/import. No implicit permission to edit every inspected source file.
