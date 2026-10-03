# Rox Desktop Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Этот документ — синтез пяти завершённых черновиков планирования (roadmap, functional QA, visual QA, dev-loop, completeness) и пяти read-only аудитов (dev-loop, remediation, integration-risk, functional-map, visual-map). Не коммитить, не пушить, не удалять ветки, не править посторонние файлы и не запускать review-gate/test-gate, пока отдельная сессия явно не поручит исполнение конкретной задачи.

**Goal:** Закрыть выпуск desktop Rox по ещё нерешённой работе: read-only current-state preflight с явными ветками open / merged / closed-unmerged PR #5, каждая с named current ship ref и reviewable path; происхождение фикса Ticket-13 ask-mode Allow и возможный порт на этот ship ref **до** lead review-gate; код Задач 6, 23 и 28 (Connect expiry/poll, factory-dispatch, live-turn-gate) **на том же current ship ref**, затем **финальный review/merge gate**; packaging evidence привязан к merged SHA этого gate; ручной desktop Connect/onboarding UI с implementation+test expiry/poll; human terminal handoffs для PR #1–#4 и Ticket-14 cleanup без `git push --delete`; human-blocked R2/ops, identity MIGRATE и release-engineering (этот план — QA, не RC); factory-dispatch test от OMP `LlmConnection` через public connection factory; production-mode dist smoke (prepare backend/session + deferred runtime inside artifact, `CRAFT_DEV_RUNTIME` absent); функциональные/визуальные ворота (включая workbench/session/overlay sweep с включёнными unified-shell gates) и живой Bun+Electron+Vite цикл — не переписывая уже слитые A–H и OMP v2.

**Architecture:** Исторические workstreams A–H ✅ MERGED в интеграционную ветку `rox-integration-remediation-7c33` по **dated evidence 2026-08-12** (не утверждение текущего `origin/main`). SHA `5797f431`, «PR #5 ACTIVE», «3 ahead», dependabot «149 behind» — снимки той даты, не текущее состояние. OMP v2 G1–G4 уже на main отдельной волной. Этот план исполняет остатки: Задача 0 preflight (open / merged / closed-unmerged PR #5 → named current ship ref + reviewable path), Задача 2 provenance/port **на этот ref**, Задача 1 lead review-gate integration tree **без** certified merge, обязательный код Задач 6/23/28 и launcher Задачи 20 **на current ship ref**, Задача 28a финальный review/merge, packaging (Задача 29) **только** от этого merged SHA. In-repo код трогается только если задача явно требует порта Ticket-13, Connect expiry/poll, factory-dispatch test, live-turn-gate hardening, electron-dev port-owner refuse или optional promotion. Cloudflare/R2, identity MIGRATE, signing/notarization/Windows-Linux RC — human-blocked handoffs, не агентное исполнение.

**Tech Stack:** Bun, bun:test, TypeScript package `tsc --noEmit`, Electron (`apps/electron`, `main: dist/main.cjs`), Vite (`apps/electron/vite.config.ts`, React + jotai HMR), esbuild watch (main/preload/worker), electron-builder (`apps/electron/electron-builder.yml`), fake OMP CLI (`omp-fake-cli.ts`, `fake-omp-rpc.mjs`), Rox Connect device-flow (`ROX_AUTH_BASE_URL` default `https://rox.one`).

**Spec:** `plans/remediation-board.md`; `plans/branch-disposition.md`; `docs/omp-integration-gap.md`; `docs/ROX_CLOUD_CONNECT.md`; `docs/repo-known-issues.md`; `plans/next-program/13-live-e2e-evidence.md`; `plans/next-program/decisions/006-branch-deletion.md`; `apps/electron/electron-builder.yml`; `scripts/electron-dev.ts`; `docs/cli.md`. Identity/decision files (`plans/identity-migration-plan.md`, `004-appid-auto-update.md`, `005-website-client-id.md`) — **handoff SoT only**, не executable algorithms.

## Global Constraints

- Не переоткрывать workstreams A–H и OMP v2 G1–G4 (коммиты `d01981c6f`, `1dc41d014`, `4035a02c5` на main) как незавершённый продукт.
- A–H MERGED означает «влито в `rox-integration-remediation-7c33`» по dated evidence 2026-08-12, а не «уже на текущем `origin/main`». Не считать PR #5 ACTIVE, KEEP-список или ahead/behind текущими, пока Задача 0 не запишет live state и не назовёт current ship ref (ветки open / merged / closed-unmerged). Задача 1 — integration review-gate **после** provenance/port, **не** certified ship merge. Финальный review/merge (Задача 28a) закрывает current ship ref **после** кода Задач 6, 23 и 28; packaging evidence bind к этому merged SHA. Не merge closed-unmerged PR #5.
- Не считать `validate:dev` / `validate:ci` / `test:shared:all` / root `tsc --noEmit` воротами OMP/WS/startup/visual. Root `tsc --noEmit` — заранее сломанный пустой tsconfig, не регрессия.
- `ROX_SERVER_TOKEN` / `CRAFT_SERVER_TOKEN` <16 символов — фатал на boot (`packages/server-core/src/bootstrap/headless-start.ts`). Генерация: `bun run packages/server/src/index.ts --generate-token`.
- Второй сервер на том же `ROX_CONFIG_DIR`/`CRAFT_CONFIG_DIR` отказан (`packages/server-core/src/bootstrap/lock-identity.ts`); рестарт обязан убить старый PID или взять отдельный config dir.
- Connect обязателен по умолчанию (`ROX_CLOUD_REQUIRED`); `0` только для pure engine/dev без cloud identity. Default `ROX_CLIENT_ID` = `craft-agents-desktop` до согласия website.
- Auth/device/cabinet/Neon SoT — репозиторий `rox-one/rox-one-website`, не этот desktop repo.
- Ticket 14: агенты не выполняют `git push --delete`. KEEP refs из dated 2026-08-12 evidence (подтвердить в Задаче 0): `main`, `chore/repo-hygiene`, `cursor/integration-audit-7c33` (PR #2), `cursor/rox-program-p0-archaeology-env-a5eb` (PR #3), `cursor/rox-remediation-a5eb` (PR #4), `rox-integration-remediation-7c33` (PR #5), dependabot PR #1. PR #1–#4 и §5 SAFE_TO_DELETE **исключены** из completion этого релиза (human handoff, Задачи 3 и 17).
- `bun run electron:dist:dev:mac` (`CSC_IDENTITY_AUTO_DISCOVERY=false` + `CRAFT_DEV_RUNTIME=1`) — не release candidate. `electron:dist:mac` — production-mode QA smoke, тоже не RC. Этот план **не производит RC**. productName остаётся `Craft Agents` до human-dated M5.
- bunfig.toml `[test].preload` обязан держать `./scripts/test-config-isolation.ts` первым. Не импортировать `packages/shared/src/config/storage.ts` до установки `CRAFT_CONFIG_DIR`. Текущая изоляция сторожит `~/.craft-agent`. Если human-blocked M1 когда-либо сменит default на `~/.rox`, preload/assertion обязаны отвергать оба real home (включая descendants и symlink-equivalent) **до** любой storage/OMP suite.
- Не коммитить секреты. `ROX_API_KEY` не в репозитории. Live-turn без ключа = BLOCKED, не fake-green. Real OMP recheck по умолчанию — только Ticket-13 ask-mode Allow на ship-ветке.
- Не копировать third-party код, не менять production infra, не применять Cloudflare/R2 lifecycle/delete из этого агентного плана. Root `.env` **сейчас отсутствует**: shell `CRAFT_VITE_PORT` / `CRAFT_CONFIG_DIR` работают. Пиновый `.env` shell-assignment **не** перебивает — нужен isolated checkout `.env` или будущий code change, не `VAR=… bun run`.
- Коды OMP на проводе — строки (by design). Resume из OMP session store — не делаем. Knowledge write-proposal tools UI-gated; KnowledgeAgentPanel unmounted (W2) — не этот релиз.
- `electron:dev:terminal` не поддерживается (`scripts/electron-dev.ts` не читает `--terminal`).
- kimi-K3 403 для live-ключа и `/manifest*` 401 — не дефекты этого плана.
- Никогда не чистить HMR-маркер через `git checkout -- <file>` (это discard всего tracked файла).
- ReauthScreen мёртв (нет перехода `appState=reauth`) — не live-acceptance, пока нет supported trigger без правки исходников.
- Windows Git Bash: назначенный human/host **или BLOCKED**, не silent skip.

---

## Карта файлов и SoT (не создавать новые, пока задача явно не велит)

**Не трогать как «доделать A–H»:** уже слитые exclusive-файлы workstreams A–H, R3 denylist/`scrubOmpStderr`, R4 S1/S4/K3/E2/A2, ticket 08/16, `omp-agent.ts` header (`fcf4da70`).

**SoT, которые читают исполнители:**

- `plans/remediation-board.md` — статус A–H, Wave 4/5, Ticket 13, review-gate checklist; integration-row «ACTIVE» = dated 2026-08-12, сверить в Задаче 0
- `plans/branch-disposition.md` — классы веток, KEEP, §5 proposed deletes, Ticket 14
- `plans/next-program/decisions/006-branch-deletion.md` — запрет агентских remote delete
- `plans/next-program/13-live-e2e-evidence.md` — session `260813-vivid-moon`, `permission_request`
- `plans/identity-migration-plan.md` — 12 MIGRATE runbooks **существуют и не исполнены**; acceptance/verification аудитом не инспектировались — **не** executable SoT этого плана
- `plans/next-program/decisions/004-appid-auto-update.md` — M5 human-blocked, нет bridge date
- `plans/next-program/decisions/005-website-client-id.md` — O1 default flip OPEN; human/website-blocked
- `docs/ROX_CLOUD_CONNECT.md` — Connect policy и device-flow
- `docs/omp-integration-gap.md` — v2 closed; remainder #5 optional
- `docs/repo-known-issues.md` — token/lock, known cosmetics
- `scripts/electron-dev.ts`, root `package.json`, `apps/electron/electron-builder.yml`, `apps/electron/vite.config.ts`

**Где может появиться новый/портированный код (только по задаче, только на named current ship ref Задачи 0):**

- Ticket-13 ask-mode Allow, если фикса нет на текущем ship ref (после Задачи 0)
- Connect approval expiry / poll failure → renderer + tests (Задача 6)
- Factory-dispatch test: OMP `LlmConnection` → public `createBackendFromConnection` / `createBackendFromResolvedContext` → fake-CLI turn handled by `OmpAgent` (Задача 23). Прямой `createBackend({ provider: 'omp' })` недостаточен
- `packages/shared/src/agent/live-turn-gate.ts` (`claimLiveTurnVerified`) + negative tests empty file / directory / caller boolean (Задача 28)
- `scripts/electron-dev.ts` — refuse foreign port owners immediately before any termination, **или** больше не убивать слушателей (Задача 20)
- `apps/electron/src/main/extension-host/__tests__/worker-list-commands.test.ts` — human port или discard
- optional default label `providerType: omp`; optional unstub collections inspector
- **Не** `callback-page.ts` `errorDetail` (уже escaped + existing test)
- **Не** identity M1–M6 resolver/схемы, пока human не авторизует runbook

---

## 1. Вне скоупа / исторический firewall

Следующее **выполнено или явно won't-do**. Не ставить checkbox «сделать заново». Помечать в отчётах как out of scope.

**Workstreams A–H ✅ MERGED в `rox-integration-remediation-7c33` (не GA на main, пока PR #5 не смержен):**

- A `fix/p0-omp-first-run` — hang → typed `OMP_NO_MODELS`; 6 startup codes; `queryLlm` honors model
- B `security/p0-viewer-share-auth` — owner-capability; legacy shares immutable in-app (24 share-auth теста остаются зелёными)
- C `feat/knowledge-runtime-completion` — 3 read tools, navigator live (Inbox/Daily/Databases/Tags **не** входят: нет provider contract)
- D Track-1 RENAME_NOW / `ROX_CLIENT_ID` override — safe user-visible renames; Track-2 MIGRATE **не** выполнен
- E MCP SSE/stdio contract + OMP proxy
- F secrets Infisical vertical slice, без UI
- G collections FR-11/FR-45/PanelHost; вердикт **KEEP_EXPERIMENTAL** (не GA)
- H docs/v2 alignment + классификация 94 веток; remote deletion **не** делалась

**OMP v2 на main (другая волна, не PR #5):** G1 MCP source proxies, G2 `thinking_delta`/`thinking_complete`, G3 branching/`omp_turn_anchor`, G4 skills sync. Remainder 1–4 — historical strikethrough. Матрица ⚠️/❌ в `docs/omp-integration-gap.md` для Thinking/MCP proxies/skills/branching — **устарела**, не открывать.

**Wave 4 уже на integration tree:** R1 PASS_WITH_KNOWN_FAILURES (token≥16, single-instance lock — ops, не баги); R2 P0 PASS; R3 MERGE-READY (denylist + `SECRET_ENVVAR_DENIED` + `scrubOmpStderr` уже fixed); R4 S1/S4/K3/E2/A2 fixed. Параграф R4 обрывается после A2 stderr latching — не выдумывать новые R4 follow-up.

**Wave 5 уже VERIFIED (не переигрывать таблицу):** install/build/boot, server-side onboarding, runtime, session/prompt bounded `OMP_NO_MODELS` ~0.8s, negative paths, restart/restore, web login. **Не** покрыто: desktop onboarding UI.

**Прочее out of scope:** tickets 08/16; `omp-agent.ts` stale comment `fcf4da70`; OMP codes-as-strings; resume from OMP store; write-proposal tools; remount KnowledgeAgentPanel; secrets provider UI; npm-scope big-bang; SessionManager edits; production share-data rewrites **и применение R2 lifecycle/delete**; website auth/cabinet/Neon в этом repo; identity MIGRATE executable algorithms; signing/notarization/Windows NSIS/Linux AppImage RC; «починить» root `tsc --noEmit`; kimi-K3 403; `/manifest*` 401; live ReauthScreen без supported trigger; полный пятишаговый real-OMP rerun Wave 5.

---

## 2. Integration cutover — current ship ref (после preflight и Ticket-13)

Порядок внутри этого раздела **обязателен:** Задача 0 (named current ship ref по PR #5 state) → Задача 2 (provenance + возможный порт **на current ship ref**) → Задача 1 (diff/review integration tree только по post-port дереву; **не** certified merge). Код Задач 6, 23, 28 и launcher Задачи 20 садится на тот же current ship ref. Certified review/PR/merge — Задача 28a; packaging (Задача 29) — только от её merged SHA.

### Задача 0. Current-state preflight (read-only, mandatory)

**SoT:** live git/GitHub refs; dated evidence 2026-08-12 в `plans/remediation-board.md` и `plans/branch-disposition.md` — **только снимок**, не текущие факты.

**Prerequisite:** Никакого review-gate, merge, port, classify, delete. Только запись live state.

- [ ] **Шаг 1.** Записать текущий `origin/main` SHA. Не подставлять `5797f431` как current.
- [ ] **Шаг 2.** Для PR #1–#5 записать: state (open/closed/merged/draft), head SHA, base, ahead/behind vs base и vs current main.
- [ ] **Шаг 3.** Выбрать **ровно одну** live-ветку PR #5 и записать **named current ship ref** (branch + SHA) и **reviewable path** (PR или эквивалент). Не продолжать, пока оба имени не записаны.

  **A. PR #5 open:** current ship ref = PR #5 head (ожидаемо `rox-integration-remediation-7c33`). Reviewable path = PR #5. Ticket-13 и обязательный код Задач 6, 23, 28 и launcher Задачи 20 садятся на этот head. Certified merge — только Задача 28a (не Задача 1).

  **B. PR #5 merged:** current ship ref **не** открытый PR #5. Записать merge SHA и target branch (обычно `main`). На этом SHA проверить Ticket-13. Named successor ship branch/PR **от этого merge SHA** становится current ship ref для remaining required code (Ticket-13 если отсутствует; Задачи 6, 23, 28, launcher 20). Reviewable path = этот successor PR. Не порт в уже смерженный PR #5.

  **C. PR #5 closed unmerged:** PR #5 **не** ship path и **не** merge target. Named successor ship branch/PR от текущего `origin/main` (или surviving local integration SHA, если он ancestor-полезен — записать почему) становится current ship ref; reviewable path = этот successor PR. Записать причину, почему PR #5 не шипится. Задачи 1 и 28a **не** merge PR #5.

- [ ] **Шаг 4.** На head **named current ship ref** (не «предполагаемой» PR #5, если Задача 0 назвала successor) проверить, есть ли уже Ticket-13 ask-mode Allow / command-hash / `admin_approval` fail-closed.
- [ ] **Шаг 5.** Пометить все 2026-08-12 значения (ACTIVE, KEEP, «3 ahead», dependabot «149 behind», SHA `5797f431`) как dated evidence only. Execution идёт только от этой записи.

**Acceptance:**

- Существует preflight record: main SHA; PR #1–#5 state/head/base/ahead-behind; PR #5 state branch (**open** | **merged** | **closed-unmerged**); **named current ship ref** (branch + SHA); **reviewable path**; Ticket-13 present-or-absent on that ship ref.
- Ни один последующий шаг не использует dated 2026-08-12 числа как live facts.
- Ни один последующий port/code task не целится в «PR #5 / integration tree» в обход named current ship ref.

**Verification:**

- Record датирован днём исполнения. Read-only: нет checkout-destroy, нет push, нет review-gate.

### Задача 2. Происхождение фикса Ticket-13 (ask-mode Allow) на current ship ref

**SoT:** `plans/remediation-board.md` (Ticket 13 re-check 2026-08-13); `plans/next-program/13-live-e2e-evidence.md` (session `260813-vivid-moon`, `permission_request`); Задача 0 record (named current ship ref).

**Prerequisite:** Задача 0 записана, current ship ref named. Wave 5 live-run claimed VERIFIED на **live-run branch**. Board **не** утверждает, что privileged-broker fail-closed Allow (`admin_approval` без command hash) есть на ship-ветке. Не переигрывать всю таблицу Wave 5. **Эта задача строго предшествует** review-gate Задачи 1 и certified merge Задачи 28a.

**Files (только если фикса нет на named current ship ref):** код ask-mode Allow / command-hash / `admin_approval` fail-closed с live-run ветки → **current ship ref**. Не порт в closed-unmerged PR #5 и не в already-merged PR #5.

- [ ] **Шаг 1.** Diff head **named current ship ref** на ask-mode Allow / command-hash / `admin_approval` fail-closed, как описано в Ticket 13 re-check (использовать Задача 0, не dated board).
- [ ] **Шаг 2.** Если фикса нет на current ship ref — портировать на этот ref **до** Задачи 1 review-gate и **до** заявления, что live permission path release-ready.
- [ ] **Шаг 3.** Не коммитить секреты. `ROX_API_KEY` остаётся uncommitted.
- [ ] **Шаг 4.** Не считать kimi-K3 403 дефектом (live model был `gpt-5.6-luna`).

**Acceptance:**

- На **current ship ref** ask-mode Allow для host prompt **с command hash** не fail-closed как `admin_approval`.
- Если фикса нет — current ship ref **не** merge-ready по permission path; Задача 1 не стартует review-gate; Задача 28a не merge.
- Claim «Ticket 13 VERIFIED» относится к **named current ship ref**, который реально шипится.
- Если порт произошёл — Задача 1 и Задача 28a гонят gate против **post-port** дерева на current ship ref.

**Verification:**

- Evidence SoT остаётся `plans/next-program/13-live-e2e-evidence.md`. Перепроверять только Allow path на current ship ref (см. Задачу 28).
- Live re-check (human, нужен `ROX_API_KEY`): ask-mode Allow успешен или запрашивает документированный privileged path **с command hash**; сессия возвращается в idle. Неполный пятишаговый Wave 5 rerun.
- `bun test` `live-turn-gate` green **не** доказывает live turn.

### Задача 1. Lead review-gate integration tree на current ship ref (не certified merge)

**SoT:** `plans/remediation-board.md` (§Review gate checklist; integration-row «ACTIVE» = dated); Задача 0 live PR #5 state + named current ship ref + reviewable path; `docs/repo-known-issues.md`.

**Prerequisite:** Задача 0 complete. Задача 2 complete, включая любой required port **на current ship ref**. A–H уже MERGED в интеграционную ветку (dated). Не реимплементировать workstreams. Не считать G1–G4 на main доказательством, что remediation-программа на main. **Не** гонять полный diff/review по pre-port дереву. **Не** merge как certified ship: код Задач 6, 23, 28 ещё не обязан быть на дереве.

**Files:** не менять exclusive A–H файлы; не править production infra.

- [ ] **Шаг 1.** Зафиксировать линию по Задаче 0: единственный integration review target — **named current ship ref** (PR #5 head если open; successor если merged или closed-unmerged). PR #1–#4 **исключены** из этого close-out (Задача 3 handoff). Не merge closed-unmerged PR #5. Не reopen A–H/v2.
- [ ] **Шаг 2.** Прогнать board review-gate против **post-Задача-2** tree vs ownership map: полный diff, package typechecks, targeted tests с RED-evidence, typed error paths, persisted-state compat, security, no third-party copy, no production-infra edits.
- [ ] **Шаг 3.** Не трактовать root `tsc --noEmit` как регрессию (пустой root tsconfig, pre-existing).
- [ ] **Шаг 4.** Соблюдать R1: токен <16 символов фатален; второй сервер на том же config dir отказан — рестарт останавливает старый PID или берёт другой dir.
- [ ] **Шаг 5.** Не выдавать `bun run electron:dist:dev:mac` за RC. Production-mode sibling `bun run electron:dist:mac` — QA smoke (Задача 29), не RC; packaging **только** после Задачи 28a и **только** от её merged SHA. Артефакты: `apps/electron/release/Craft-Agents-${arch}.dmg` / `.zip`; productName `Craft Agents` до human-dated M5.
- [ ] **Шаг 6.** Записать исход review-gate: pass **или** явный named blocker. **Не** merge PR #5 / current ship ref как certified ship в этой задаче. Если PR #5 open — он остаётся current ship ref для Задач 6/23/28. Если PR #5 already merged — не re-merge; successor из Задачи 0 несёт remaining code. Если PR #5 closed unmerged — не reopen/merge его; remaining code на successor. Certified merge = Задача 28a.

**Acceptance:**

- Review-gate recorded against **post-Ticket-13** tree on **named current ship ref**. PR #5 **не** certified-merged здесь.
- Ветки open / merged / closed-unmerged Задачи 0 соблюдены; нет требования смержить closed-unmerged PR #5.
- Нет нового production infra, нет копирования third-party, нет scope creep в exclusive A–H файлы.
- Unsigned `CRAFT_DEV_RUNTIME=1` mac-артефакты не названы RC. Этот план не производит RC. Packaging evidence не собирается в этой задаче.

**Verification:**

- Package typechecks (не root): `bun run tsc --noEmit` в `packages/shared`, `packages/server-core`, `packages/session-tools-core`, `packages/core`, `apps/electron`, `apps/webui`, `apps/viewer`.
- i18n: `bun test packages/shared/src/i18n` плюс `bun run lint:i18n:parity`, `lint:i18n:sorted`, `lint:i18n:coverage`.
- Уже записанный post-merge bar перепроверять только если дерево сдвинулось относительно historical evidence: shared/server-core/session-tools-core/viewer 0 fail; renderer 3 pdfjs `?url` failures — known pre-existing на dated базе `5797f431`; live `/login` title Rox; CLI ping/health OK; `CLI --validate-server` step 11 падает bounded (~1.2 s) с `No text_delta` / typed `OMP_NO_MODELS`, не hang.
- Если упаковка: см. Задачу 29 **после** Задачи 28a; evidence bind к merged SHA 28a. Gatekeeper/notarize — human release-engineering, не этот gate (`notarize` закомментирован).

---

## 3. KEEP PR #1–#4 и dependabot lag — human handoff, не release completion

### Задача 3. Инвентаризация KEEP + terminal human handoff / exclusion

**SoT:** `plans/branch-disposition.md` §1, §3, §5 «Not proposed for deletion»; Задача 0 live PR state.

**Prerequisite:** Ticket 14 / §5 deletes **не** включают KEEP refs. Не путать с SAFE_TO_DELETE. **Этот релиз не требует** merge/close #1–#4.

**Human owner (required):** _unassigned — fill before claiming inventory done._ Completion record: owner, date, per-PR disposition.

- [ ] **Шаг 1.** Сверить dated 2026-08-12 KEEP inventory с Задачей 0. Dated snapshot (не current): `main`; `chore/repo-hygiene`; `cursor/integration-audit-7c33` (PR #2, unique `plans/integration-audit.md` +430); `cursor/rox-program-p0-archaeology-env-a5eb` (PR #3 UNIQUE_DELTA: `.cursor/environment.json`, `docs/cloud-agents/environment.md` +149, `plans/repository-archaeology.md` +126, `plans/rox-current-state-audit.md` +111, `plans/session-domain-convergence.md` +169); `cursor/rox-remediation-a5eb` (PR #4, `plans/remediation-board.md` +69); `rox-integration-remediation-7c33` (PR #5); dependabot `packages/server-core` (PR #1, dated 1 ahead +2/−2, **149 behind**).
- [ ] **Шаг 2.** Записать live ahead/behind и state каждого PR #1–#4 из Задачи 0. Dependabot behind-count — refresh, не «149» unless still true.
- [ ] **Шаг 3.** Явно отметить конфликт/дублирование: PR #4 и PR #5 оба несут `plans/remediation-board.md` (если оба still open).
- [ ] **Шаг 4.** Upstream PR #663 OPEN при том, что `feature/pr-663-workspace-icon-rail` уже ancestor rox main — это коррекция старого unmerged-ports claim, **не** unique delta.
- [ ] **Шаг 5.** **HUMAN HANDOFF / EXCLUSION:** PR #1–#4 **исключены** из completion этого релиза. Человек назначает terminal disposition каждого (merge / close / rebase / keep-open + reason) во внешнем tracked record. Агент не merge/close эти PR как часть плана.

**Acceptance:**

- Ни одна §5 delete-команда не содержит KEEP refs.
- Dependabot behind — явный rebase/conflict risk в handoff, не «игнорировать, пока open».
- UNIQUE_DELTA PR #3 нельзя объявить «уже на main @ dated `5797f431`» без Задачи 0.
- Этот план может быть complete, пока #1–#4 open, **только если** exclusion + named owner + completion record существуют.

**Verification:**

- Сверить delete-листы с `plans/branch-disposition.md` §3 и §5 Not proposed.
- Handoff record names owner and per-PR terminal disposition or explicit keep-open.

---

## 4. Отложенные security/ops follow-up (viewer-share, OAuth)

### Задача 4. Viewer share ops — HUMAN-BLOCKED change request (не применять из этого плана)

**SoT:** `plans/remediation-board.md` (WS B follow-up, R3 deferred); in-repo share-auth уже green (24 теста, 401/403/legacy-immutable).

**Prerequisite:** In-repo share-auth merged (WS B). Это **не** in-repo тесты, **не** блокер merge PR #5, и **не** агентное исполнение. Не трогать production share data. Не применять lifecycle/delete/conditional-write из этого плана.

**Human owner / change approver (required):** _unassigned._

Заполнить named ops change request; **не** выполнять шаги в Cloudflare/R2:

- [ ] **Шаг 1.** Retention period + legal approval для legacy-share objects (lifecycle может удалить единственные копии).
- [ ] **Шаг 2.** Object inventory + backup до любой policy.
- [ ] **Шаг 3.** Staging/canary план; monitoring; rollback.
- [ ] **Шаг 4.** Conditional-write (ETag/If-Match) client-compatibility check со in-app share clients.
- [ ] **Шаг 5.** Cloudflare rate-limit на share mutation endpoints — тоже human/ops, в том же CR.
- [ ] **Шаг 6.** Явное human execution **вне** этого агентного плана. Не писать bun-тесты «вместо» dashboard/R2. Не мигрировать production share rows.

**Acceptance:**

- CR существует с owner, retention, inventory/backup, staging, compatibility, monitoring, rollback.
- Из этого плана **не** applied lifecycle/delete/write-semantics.
- In-repo share-auth matrix остаётся неизменной.
- Release completion **не** зависит от выполнения CR.

**Verification:**

- Evidence — CR document, не bun test и не live R2 mutation.
- Нет перезаписи production share rows из этой сессии.

### Задача 5. Escape OAuth callback `errorDetail` — COMPLETE (verification-only)

**SoT:** `packages/shared/src/auth/callback-page.ts` (escape `errorDetail` уже есть); `packages/shared/src/auth/__tests__/callback-page.test.ts` (script payload рендерится escaped).

**Prerequisite:** Фикс уже на дереве. Не re-implement. Не менять relay URLs (M6). Не часть PR #5.

**Files:** не модифицировать `callback-page.ts` повторно.

- [x] **Шаг 1.** `errorDetail` экранируется до вставки в generated HTML — already present.
- [x] **Шаг 2.** Callback page не ребрендилась; `https://agents.craft.do/auth/*` не менялись.
- [x] **Шаг 3.** Existing XSS regression: `callback-page.test.ts` asserts attacker script payload is escaped text.

**Acceptance:**

- Задача COMPLETE. Не открывать как implementation ticket.
- Existing test остаётся evidence; не добавлять redundant rewrite.

**Verification:**

- Retain `bun test packages/shared/src/auth` (существующий XSS regression) как evidence, если дерево сдвинулось. Не требовать ручной re-implementation.

---

## 5. Продуктовые остатки

### Задача 6. Desktop Connect expiry/poll — implementation+test, затем ручной UI

**SoT:** `docs/ROX_CLOUD_CONNECT.md`; `plans/remediation-board.md` Wave 5 (onboarding VERIFIED **server-side only**); `apps/electron/src/main/onboarding.ts` (expiry/failure сегодня только в main logs); `apps/electron/src/renderer/hooks/useOnboarding.ts` (игнорирует `expiresIn`, poll каждые 2s, swallows state-read failures); `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx`; `apps/electron/src/renderer/App.tsx` (gates: loading → onboarding | workspace-picker | ready; **reauth не live**).

**Prerequisite:** Server-side Wave 5 rows уже VERIFIED — не reopen. Headless seeding **не** покрывает UI. Connect required unless `ROX_CLOUD_REQUIRED=0`. Не флипать `ROX_CLIENT_ID` с `craft-agents-desktop`. Текущий «failure paths bounded» **не executable**: waiting может быть вечным. Сначала implementation+test **на named current ship ref (Задача 0)**, потом visual sign-off. Этот код — prerequisite финального merge (Задача 28a). Не вводить credentials в план/репозиторий.

**Files:** `apps/electron/src/main/onboarding.ts`; `apps/electron/src/renderer/hooks/useOnboarding.ts`; targeted tests рядом с `useOnboarding.test.ts` / onboarding handlers. Изменения **только** на current ship ref.

- [ ] **Шаг 1.** На current ship ref: пропагировать approval expiry и poll/state-read failure из main в renderer. Остановить poll interval на документированном deadline (`expiresIn` или явный cap). Показать error state, не вечный `waiting`.
- [ ] **Шаг 2.** Restart Connect обязан cancel/supersede prior poll/flow.
- [ ] **Шаг 3.** Тесты на current ship ref: (a) expiry → renderer error, interval stopped; (b) network/state-read failure → error, не silent swallow; (c) restart cancels prior flow. RED→GREEN. Код шагов 1–3 обязан быть на named current ship ref до Задачи 28a.
- [ ] **Шаг 4.** Только после шагов 1–3: на машине с desktop binary пройти `onboarding:startRoxConnect` → `POST {auth}/api/auth/device/start` → `verification_uri_complete` → poll until approved **или** expiry/error → `CredentialManager` `service_oauth::global::rox-cloud` → renderer `getRoxCloudState` connected → provider/LLM setup. Изоляция: disposable `HOME` + `CRAFT_CONFIG_DIR` (см. Задачу 20/27). Не вводить credentials, пока `.env` может перебить isolation.
- [ ] **Шаг 5.** Оставить `ROX_CLIENT_ID` default `craft-agents-desktop`, пока website не принимает Rox-branded id.
- [ ] **Шаг 6.** Пройти RoxConnectStep waiting / error (expiry + network) / success визуально (не playground OnboardingFlowDemo: он пропускает rox-connect, git-bash, omp-credential).
- [ ] **Шаг 7.** Не трактовать SSR `OnboardingWizard.test.tsx` как visual/E2E coverage этого UI.

**Acceptance:**

- Expiry и poll failure достигают renderer error; poll останавливается; restart supersedes.
- Implementation+tests шагов 1–3 присутствуют на **named current ship ref**; Задача 28a не стартует без этого diff.
- Desktop Connect достигает `connected` и продолжает provider/LLM setup против `ROX_AUTH_BASE_URL` (default `https://rox.one`) **после** bounded failure paths.
- Connect остаётся required by default.
- Wave 5 «onboarding VERIFIED (server-side)» **не** цитируется как UI evidence.
- Не утверждать «failure paths bounded» до шагов 1–3.

**Verification:**

- Targeted tests red-then-green на expiry и network-error.
- Human desktop walk RoxConnectStep waiting / expiry-error / network-error / success; renderer watch `getRoxCloudState` until `connected` or error.
- Optional: `GET {auth}/api/me/balance` с `Authorization: Bearer <access_token>` после Connect.
- Channels `START_ROX_CONNECT` / `GET_ROX_CLOUD_STATE` / `CLEAR_ROX_CLOUD` — `LOCAL_ONLY` в `packages/shared/src/protocol/routing.ts`.

### Задача 7. Knowledge Inbox/Daily/Databases/Tags — blocked on provider contract

**SoT:** `plans/remediation-board.md` WS C remaining; knowledge read-tools уже live (underscore wire names).

**Prerequisite:** WS C navigator/read-tools MERGED. Provider contract **не существует**. Не «доделывать knowledge» через уже verified 165 knowledge + 119 session-tools.

- [ ] **Шаг 1.** Либо задокументировать provider contract и только потом наполнять четыре поверхности, либо явно оставить их out of this release как contract-blocked.
- [ ] **Шаг 2.** Не экспонировать write-proposal tools (UI-gated by design).
- [ ] **Шаг 3.** Не ремаунтить KnowledgeAgentPanel как close-out.

**Acceptance:**

- Четыре поверхности либо живут от реального контракта, либо явно вне релиза.
- Read tools unchanged. Нет fake populated Inbox/Daily/Databases/Tags.

**Verification:**

- Не добавлять coverage до появления контракта.
- Не ссылаться на stale MCP-proxy row матрицы как на этот gap.

### Задача 8. OPTIONAL — collections shell с KEEP_EXPERIMENTAL

**SoT:** `plans/remediation-board.md` WS G (вердикт KEEP_EXPERIMENTAL, 14/14 playground, W2 inspector stubs, zero real panel contributions).

**Prerequisite:** FR-11/FR-45/PanelHost уже merged. Playground 14/14 **недостаточен** для promotion. Не блокер PR #5. Не редактировать `SessionManager.ts` (rank drag уже `reorderRank`).

- [ ] **Шаг 1.** Если продукт хочет GA: заменить W2 inspector stubs реальными inspector contributions.
- [ ] **Шаг 2.** Посадить хотя бы один real panel contribution в PanelHost (не playground-only).
- [ ] **Шаг 3.** Если не берём — оставить KEEP_EXPERIMENTAL и не называть shell GA.

**Acceptance:**

- Вердикт меняется с KEEP_EXPERIMENTAL только после unstub inspector + real PanelHost contributions.
- 3 pdfjs `?url` renderer failures — pre-existing на `5797f431`, не регрессия G и не этот promotion.

**Verification:**

- Playground 14/14 плюс live PanelHost/inspector против real session data.
- Renderer bar 81 sessions + 749 renderer; 3 pdfjs fails не списывать на эту задачу.

### Задача 9. OPTIONAL — default label для OMP-provider sessions

**SoT:** `docs/omp-integration-gap.md` remainder #5 (единственный не-strikethrough full-integration item); auto-tagging уже покрыто bridge + event-bus `set_session_labels`.

**Prerequisite:** G1–G4 закрыты. Не делать OMP session-store resume (won't-do). Не reopen MCP proxies / thinking_delta / branching / skills sync.

- [ ] **Шаг 1.** Если продукт хочет: правило default label для `providerType: omp` (матрица: «правило: default label для omp-провайдера»).
- [ ] **Шаг 2.** Иначе явно отклонить optional leftover.
- [ ] **Шаг 3.** Не менять `supportsBranching` / thinking / skills / host-tool proxy.

**Acceptance:**

- Новые OMP-сессии получают default label без ручного `set_session_labels`, **или** работа явно отклонена.
- Item 5 optional, не release blocker, пока план его явно не повышает.
- Matrix Auto-tags ⚠️ не трактовать как открытый v1 gap.

**Verification:**

- Создать omp-provider session — label по правилу; non-OMP не размечается этим правилом.
- Существующие event-bus automations живы.

### Задача 10–15. Identity MIGRATE — HUMAN-BLOCKED handoffs (не executable в этом плане)

**SoT:** `plans/identity-migration-plan.md` (12 MIGRATE runbooks **существуют, не исполнены**); `plans/next-program/decisions/004-appid-auto-update.md`; `plans/next-program/decisions/005-website-client-id.md`. Audit corpus **не инспектировал** acceptance/verification этих runbooks. Точные precedence / symlink / env alias / deep-link / appId / relay / npm / mobile / legal / decommission шаги **не** authorized steps этого плана.

**Prerequisite:** Не исполнять M1–M6 из этой сессии. Не блокер PR #5. Track-1 safe renames уже done. Default `ROX_CLIENT_ID` остаётся `craft-agents-desktop`.

**Human owner (required):** _unassigned._ Human-approved review каждого runbook **до** любой in-repo identity работы.

#### Задача 10. M1 config home — BLOCKED handoff

Runbook topics (не шаги): F1–F3 `~/.craft-agent` → `~/.rox`. Когда человек авторизует:

- Atomic backup **до** move; verification **до** switching the active path; documented rollback.
- Collision: если существуют **оба** `~/.rox` и `~/.craft-agent` — explicit merge/keep/abort decision. Не silently prefer `~/.rox` (это обходит sessions/credentials старой инсталляции).
- Isolation **до** любой M1 verification и **до** каждой storage/OMP suite: preload + `test:config-isolation` отвергают real `~/.craft-agent` **и** real `~/.rox` (descendants и symlink-equivalent targets).
- Нет agent-authored resolver algorithm в этом плане.

- [ ] **Шаг 1.** Human reviews F1–F3 и записывает collision/backup/rollback contract.
- [ ] **Шаг 2.** Не исполнять move/symlink из этого плана.

**Acceptance:** Handoff record exists. Этот релиз complete без M1.

#### Задача 11. M2 `CRAFT_*` → `ROX_*` — BLOCKED handoff

Runbook topic (не шаг): E1 ~40 env aliases. Не кодировать resolver/`getEnv` precedence здесь.

- [ ] **Шаг 1.** Human reviews E1. Не менять login placeholder / env names из этого плана.

**Acceptance:** Handoff only. `CRAFT_SERVER_TOKEN` остаётся рабочей переменной.

#### Задача 12. M3 dual deep-link — BLOCKED handoff

Runbook topic (не шаг): D1 `craftagents://` + `rox://`. Снимать `craftagents://` сейчас strand'ит user scripts.

- [ ] **Шаг 1.** Human reviews D1. Не регистрировать схемы из этого плана.

**Acceptance:** Handoff only.

#### Задача 13. M5 appId / productName / auto-update — BLOCKED (human-dated)

**SoT:** decision 004; yml `appId` `com.lukilabs.craft-agent`, productName `Craft Agents`, `publish.url` `https://agents.craft.do/electron/latest`.

- [ ] **Шаг 1.** Человек ставит bridge date **до** любого изменения `appId`/`productName`/`artifactName`/`publish.url`. **Не трогать yml** до этой даты.
- [ ] **Шаг 2.** Legal review `copyright: Craft Docs Ltd.`, `maintainer: support@craft.do` — human/legal.
- [ ] **Шаг 3.** Не исполнять bridge/Rox-branded builds из этого плана.

**Acceptance:** Нет appId flip. Artifact names `Craft-Agents-*`. Этот план не RC.

#### Задача 14. M6 + O1 OAuth relay / client id — BLOCKED (website + human)

Default `ROX_CLIENT_ID` = `craft-agents-desktop` — контракт с website. Default flip OPEN. Не реализовывать better-auth/device/cabinet/Neon в desktop repo. Не менять relay URLs.

- [ ] **Шаг 1.** Human/website: Rox-operated relay и third-party redirect URIs — вне этого repo.
- [ ] **Шаг 2.** Desktop default flip только после website acceptance. Env override уже покрыт `packages/shared/src/auth/__tests__/rox-cloud.test.ts`.

**Acceptance:** Старый default не strand'ить. Handoff only.

#### Задача 15. Identity leftovers — не этот релиз (handoff list)

Записать, не исполняя: M4 `@craft-agent/*` → `@rox/*`; A3 iOS bundle ids; P6 `CRAFT_LOGO`; L3 legal files; L5 system prompt / `agents-noreply@craft.do`; U12 dead ReauthScreen + `onboarding.reauth.*` (`handleReauthLogin` unused — **нет live trigger**, исключён из visual gate); U13/U14 KEEP_INTERNAL.

- [ ] **Шаг 1.** Чеклист blocker каждого пункта (codemod / App Store / design / legal / product / dead-code).
- [ ] **Шаг 2.** Нет silent rename. Не блокер PR #5.

**Acceptance:** Ни один leftover не исполнен и не блокирует этот релиз.

**Verification (10–15):** Verification suite не требуется, пока human не авторизует конкретный runbook. Не цитировать identity-plan algorithms как шаги этого документа.

### Задача 16. OPTIONAL follow-up — 3 pre-existing pdfjs `?url` renderer failures

**SoT:** `plans/remediation-board.md` WS G follow-up; dated base `5797f431` (сверить current main в Задаче 0).

**Prerequisite:** Не регрессия PR #5. Не блокер, пока план явно не повышает.

- [ ] **Шаг 1.** Воспроизвести три `?url` pdfjs failures на base vs integration — тот же набор.
- [ ] **Шаг 2.** Чинить только эти tests/loader, если follow-up взят. Без renderer refactor.

**Acceptance:**

- Renderer suite 0 fail **или** тройка явно documented as known-on-base. Нет новых pdfjs failures.

**Verification:**

- Targeted renderer pdfjs tests на integration vs current main (dated comparison base `5797f431`); счёт 3 или 0.

---

## 6. Ticket 14 — архивация веток (human-only, без remote delete)

### Задача 17. Port или discard `worker-list-commands.test.ts` + HUMAN HANDOFF branch cleanup

**SoT:** `plans/branch-disposition.md` §4–§5; `plans/next-program/decisions/006-branch-deletion.md`; donor `feat/shell-ext-activate2`; feature уже на main: `extensionHost:listCommands` в `packages/shared/src/protocol/channels.ts` и `apps/electron/src/main/handlers/extension-host.ts` (PRs #42/#44).

**Prerequisite:** Human решает port vs discard **до** любых §5 deletes. Агенты **не** делают `git push --delete`. Dated §5 lists ~85 rox-one + ~9 donor SAFE_TO_DELETE — **исключены** из completion этого релиза.

**Human owner (required):** _unassigned._ Completion record: owner, date, port/discard, cleanup deferred.

**Files (если port):** Create `apps/electron/src/main/extension-host/__tests__/worker-list-commands.test.ts` (142 lines) на rox-one.

- [ ] **Шаг 1.** Human: портировать 142-строчный worker-level test на rox-one **или** письменно discard coverage.
- [ ] **Шаг 2.** Не запускать `plans/branch-disposition.md` §5 proposed `git push --delete`.
- [ ] **Шаг 3.** Не удалять KEEP lines (см. Global Constraints / Задача 3).
- [ ] **Шаг 4.** **HUMAN HANDOFF / EXCLUSION:** 85 rox-one + 9 donor SAFE_TO_DELETE **не** входят в release completion. Если человек когда-либо исполняет §5: donor deletes first (6 merged/superseded, затем `feat/shell-ext-activate2`, затем shared `fix/sandbox-env-strip` + `fix/test-pollution-fetches`), затем rox-one feature/spec/fix, затем 62 `feature/pr-*`. Команды остаются proposed, не executed в этом плане.
- [ ] **Шаг 5.** Tracked external handoff names owner + «cleanup deferred / excluded from this release».

**Acceptance:**

- Письменное human decision: файл есть на rox-one **или** discard записан.
- Этой задачей remote branches не удалены.
- Cleanup нельзя пометить done без human port/discard **и** нельзя считать этот релиз blocked на 85+9 deletes.
- Plan complete while SAFE_TO_DELETE remain **только если** exclusion + named owner + completion record существуют.

**Verification:**

- Если ported: 142-line test на integration/main line; падает без coverage `extensionHost:listCommands`.
- Если discarded: decision recorded; всё ещё нет remote delete из этой секции.
- Негатив сейчас: `git show origin/main:apps/electron/src/main/extension-host/__tests__/worker-list-commands.test.ts`.
- Handoff record exists for branch cleanup exclusion.

---

## 7. Developer operating loop (live renderer vs unsigned dist)

### Задача 18. Не открывать unsigned dist во время live renderer work

**SoT:** root `package.json` scripts `electron:dist:dev:mac` / `electron:dist:mac`; `apps/electron/electron-builder.yml` (`directories.output: release`); `scripts/electron-dev.ts`.

**Prerequisite:** Unsigned local mac artifact уже мог быть собран (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `CRAFT_DEV_RUNTIME=1`, output `apps/electron/release/`). Эта секция его **не** пересобирает. `CRAFT_DEV_RUNTIME=1` меняет SDK/interceptor resolution vs production — не RC.

- [ ] **Шаг 1.** Не запускать `apps/electron/release/mac-arm64/Craft Agents.app` и `apps/electron/release/mac/Craft Agents.app` для UI iteration.
- [ ] **Шаг 2.** Не открывать `apps/electron/release/Craft-Agents-arm64.dmg` / `.zip` (и x64 siblings), чтобы проверить renderer change.
- [ ] **Шаг 3.** Не перезапускать `bun run electron:dist:dev:mac` или `bun run electron:dist:mac` ради renderer tweak.
- [ ] **Шаг 4.** Live work — отдельный `electron:dev` (следующая задача).

**Acceptance:**

- Packaged app — не окно renderer iteration.
- Нет второго `electron-builder` ради live UI.
- Renderer под `apps/electron/src/renderer` сервится Vite, не `dist/renderer/index.html` внутри .app.

**Verification:**

- DevTools: `location.origin` = `http://localhost:<port>` (default `http://localhost:5173`), никогда `file://` и никогда path под `apps/electron/release/`.
- Если `file://` или процесс — packaged `Craft Agents.app`: quit и `bun run electron:dev`.

### Задача 19. Запуск live Electron + Vite (не packaged app)

**SoT:** `scripts/electron-dev.ts`; root `electron:dev`; `apps/electron/vite.config.ts`; window-manager loadURL `VITE_DEV_SERVER_URL`.

**Prerequisite:** Packaged .app закрыт. Нужны repo-root `node_modules/.bin/vite` и `electron`; cwd Electron = `apps/electron` (`main: dist/main.cjs`). Root `.env` загружается **после** shell/folder detection и **перезаписывает** `CRAFT_VITE_PORT` / `CRAFT_CONFIG_DIR`. **Сейчас root `.env` отсутствует** — shell assignment работает. Пиновый `.env` shell **не** перебивает. Задача 20 preflight (port/config/home) **до** этого запуска.

- [ ] **Шаг 1.** Выполнить Задачу 20 preflight. Только потом из корня репо: `bun run electron:dev` (эквивалент `bun run scripts/electron-dev.ts`) с **уже разрешённым** effective port.
- [ ] **Шаг 2.** Дождаться логов: one-shot esbuild main+preload+toolbar-preload → `node --check` → Vite + watchers → `Starting Electron`. Electron стартует сразу после spawn Vite (нет wait-for-5173); `did-fail-load` ретраит Vite URL до 5×1s, затем `loadFile(dist/renderer/index.html)` — это **не** этот loop.
- [ ] **Шаг 3.** Подтвердить окно на recorded effective origin (`vite dev --config apps/electron/vite.config.ts --port <effective> --strictPort`).
- [ ] **Шаг 4.** Стоп: Ctrl+C (SIGINT/SIGTERM cleanup: dispose esbuild, kill Vite + Electron). Не оставлять stray Electron.
- [ ] **Шаг 5.** Не подменять: `apps/electron` `dev` (`vite dev` only); `playground:dev` (`kill -9` на 5173, `/playground.html`, нет Electron); `electron:start` / `cd apps/electron && bun run start` (full build, file://); `electron:dev:terminal` (нет argv handling).

**Acceptance:**

- Ровно один `electron:dev` владеет Vite port и Electron window.
- `VITE_DEV_SERVER_URL=http://localhost:<effective-port>` на Electron child (`getElectronEnv()`).
- Renderer не с unsigned `release/`.
- Launch не начинался, пока preflight не записал effective port/config/home и не подтвердил, что порт свободен.

**Verification:**

- Терминал: Vite `--strictPort` на preflight port; Electron `electron apps/electron`.
- DevTools: `location.origin === 'http://localhost:<effective-port>'`.

### Задача 20. Launcher port-owner refuse + preflight port / config / home **до** `electron:dev`

**SoT:** `scripts/electron-dev.ts` `detectInstance()` / `loadEnvFile()` (после folder detection, безусловный overwrite); folder suffix `*-N` → port `N173` если `CRAFT_VITE_PORT` unset. **Текущий дефект:** после downloads/builds launcher делает `lsof -ti:${port} | xargs kill -9` (шире TCP-LISTEN preflight). Preflight-only `lsof` **недостаточен**: процесс может занять порт в этом интервале, и kill query убьёт чужого владельца, даже если каждый checklist step выполнен. `--strictPort` безопасно отвергает занятый порт.

**Prerequisite:** Root `.env` **сейчас отсутствует**. Shell `CRAFT_VITE_PORT=15173` в этом checkout выбирает 15173. Если появится пиновый `.env` — shell assignment **не** работает: нужен isolated checkout со своим `.env` **или** будущий code change, который делает launch args authoritative. Не «починить» override через `VAR=… bun run`. Код launcher — **на named current ship ref**; prerequisite Задачи 28a.

**Files:** `scripts/electron-dev.ts` (обязательное изменение на current ship ref).

- [ ] **Шаг 0. Code (RED→GREEN, current ship ref):** Изменить `scripts/electron-dev.ts` так, чтобы он **не** безусловно убивал слушателей порта. Допустимо: (a) полностью убрать kill и положиться на Vite `--strictPort` (occupied port → fail, Electron не стартует с чужим URL), **или** (b) непосредственно **перед** любым targeted termination проверить ownership/identity выбранного порта и **немедленно отказать**, если owner чужой (не этот launcher / не наш Vite). Проверка — immediately before termination, не только в preflight. Покрыть гонку: процесс, занявший порт после preflight и во время downloads/builds, не убивается; launcher abort или `--strictPort` reject. Не оставлять `lsof -ti:${port} | xargs kill -9` без identity check.
- [ ] **Шаг 1. Preflight (первое действие, до любого `electron:dev`):** Прочитать root `.env` если есть. Записать intended vs effective: `CRAFT_VITE_PORT`, `CRAFT_CONFIG_DIR`, `HOME`. Current: `.env` absent → effective = shell/folder/default. Preflight — defense in depth, **не** замена шага 0.
- [ ] **Шаг 2.** Если `.env` пинит port или config: **STOP**. Не launch. Isolated checkout `.env` без пина, или code change. Не shell override.
- [ ] **Шаг 3.** Resolve effective port (default checkout `rox-one` без `-<N>`: **5173**; isolated intent: **15173** только если `.env` не пинит иначе).
- [ ] **Шаг 4.** `lsof -nP -iTCP:<effective-port> -sTCP:LISTEN` **до** launch. Если порт принадлежит чужому процессу — **ABORT**. Не звать `electron:dev`.
- [ ] **Шаг 5.** Только если порт свободен **и** шаг 0 влит в current ship ref: preferred isolated launch `CRAFT_VITE_PORT=15173 bun run electron:dev` (works **because `.env` absent**). 5173 не трогать.
- [ ] **Шаг 6.** Если нужен отдельный user data: disposable `HOME` + `CRAFT_CONFIG_DIR` (mkdtemp), не `$HOME/.craft-agent-15` на реальном home, плюс instance vars. Снова: `.env` не должен пинить эти значения.
- [ ] **Шаг 7.** Folder-name alternative: checkout `craft-agents-1` без `CRAFT_VITE_PORT` и без pinning `.env` → port `1173`. Занятый порт → Vite `--strictPort` fail или launcher abort; Electron не должен падать в file:// из-за kill-then-stale-URL. Шаг 4 + шаг 0 обязательны.

**Acceptance:**

- `scripts/electron-dev.ts` на current ship ref отказывает чужому owner immediately before termination **или** больше не убивает слушателей. Гонка downloads/builds покрыта.
- Preflight record: effective port, config dir, HOME, `.env` absent-or-isolated, port free **before** launch.
- `location.origin` совпадает с preflight port (`http://localhost:15173` в isolated примере).
- На этом порту нет чужого процесса **до и после** start.
- 5173 не тронут при isolated port.
- Чужой слушатель никогда не убит этим launcher (код, не только preflight).

**Verification:**

- Log: Vite `--port` = preflight effective port.
- Post-start `lsof` — только этот Vite, совпадает с preflight.
- Гонка: занять порт чужим процессом после старта launcher work и до kill/`listen` site → чужой процесс жив; launcher abort или `--strictPort` reject.
- Второй default `bun run electron:dev` без isolated port **не** убивает этот Vite (refuse / `--strictPort`); не делать во время isolated session.

### Задача 21. HMR для renderer; restart Electron для main/preload/workers

**SoT:** `scripts/electron-dev.ts` (esbuild watch, нет `app.relaunch`, нет electron-reloader, wait on `electronProc.exited`); Vite React + jotai babel HMR plugins; preload bound at BrowserWindow create.

**Prerequisite:** Живой `electron:dev` с Vite origin. Не ждать auto-restart.

- [ ] **Шаг 1. Hot-reload без Electron restart / без `electron:build`:** `apps/electron/src/renderer/**`; HTML entries `index.html`, `playground.html`, `browser-toolbar.html`, `browser-empty-state.html` (HTML обычно full-page reload, не Electron restart); renderer-consumed `@craft-agent/ui` (`optimizeDeps.exclude`); jotai atoms через `plugin-react-refresh` + `plugin-debug-label`.
- [ ] **Шаг 2. Требуют quit окна / Ctrl+C и новый `bun run electron:dev` (esbuild уже переписал dist, процесс загрузил `dist/main.cjs` и preloads at start):** `apps/electron/src/main/**` → `dist/main.cjs`; `apps/electron/src/preload/bootstrap.ts` → `dist/bootstrap-preload.cjs` (новый window недостаточен для main; preload нужен новый webContents); `apps/electron/src/preload/browser-toolbar.ts` → `dist/browser-toolbar-preload.cjs`; `apps/electron/src/main/extension-host/worker.ts` → `dist/extension-host-worker.cjs`.
- [ ] **Шаг 3. One-shot, не watched — полный restart `electron:dev`:** Pi agent server; WhatsApp worker (`scripts/build-wa-worker.ts`); Discord worker (`scripts/build-discord-worker.ts`); copy `apps/electron/resources` → `apps/electron/dist/resources`; bundled uv bootstrap `apps/electron/resources/bin/<platform>-<arch>/`.

**Acceptance:**

- Renderer TSX/CSS save обновляет существующее окно, Electron PID не меняется.
- Main/preload save не меняет running behavior до restart.
- Worker/Pi/resource edits не появляются, пока `electron:dev` не stop/start.
- Не гонять `electron:build` / `electron:start` ради renderer-only edit.

**Verification:**

- Renderer: save видимого файла; UI updates; `pgrep -lf 'electron apps/electron'` PID тот же.
- Main/preload: log `Watching main process` / `Watching preload` переписывает `apps/electron/dist/*.cjs`, поведение то же до restart.
- Если renderer «не применяется»: не packaged .app; `location.origin` всё ещё Vite URL (не 5-retry file:// fallback). HMR module-dependent (React/jotai plugins настроены, не asserted для каждого модуля).

### Задача 22. Быстрый HMR proof с чистым деревом

**SoT:** `scripts/electron-dev.ts`; `apps/electron/src/renderer/`; `window-manager.ts` подавляет `page-title-updated` (OS title не доказательство).

**Prerequisite:** `electron:dev` up, `location.origin` = `http://localhost:<port>`. Не оставлять маркер в дереве. Не коммитить.

- [ ] **Шаг 1.** Записать Electron PID: `pgrep -lf 'electron apps/electron'`.
- [ ] **Шаг 2.** Выбрать смонтированный файл под `apps/electron/src/renderer/`. `git status -- <file>` обязан быть **clean**. Если dirty — **ABORT**, выбрать другой файл. Не трогать `src/main` / `src/preload`. Не использовать `index.html` `<title>Rox</title>`.
- [ ] **Шаг 3.** Сохранить reverse hunk **только** планируемой однострочной правки (копия исходной строки / patch файла). Однострочная видимая правка (лейбл или CSS).
- [ ] **Шаг 4.** Save. Ожидать React Fast Refresh или Vite page reload в том же окне. Electron не должен quit.
- [ ] **Шаг 5.** Восстановить **только** plan-created hunk (вернуть сохранённую строку / reverse patch). **Никогда** `git checkout -- <file>` и никогда whole-file reset. Untracked маркер — удалить только добавленную строку, не весь файл.
- [ ] **Шаг 6.** HMR откатил маркер; PID неизменен; другие hunks (если были в других файлах) не тронуты.

**Acceptance:**

- UI изменился без restart и восстановился после marker-only reverse.
- `git status -- <the-file>` clean относительно pre-edit. PID неизменен. Packaged app не участвовал.
- Никакой `git checkout --` не выполнялся.

**Verification:**

- `git status -- apps/electron/src/renderer` без leftover **этого** маркера.
- DevTools origin всё ещё `http://localhost:<effective-port>`.
- PID совпадает с pre-edit.
- Pre-edit dirty files (если executor abort'ил) не revert'ились.

---

## 8. Functional verification (явные bun-пути, не `validate:dev`)

Изоляция **перед любой** OMP/config storage прогонкой: `bunfig.toml` `[test].preload` = `./scripts/test-config-isolation.ts`. Подтверждение: `bun run test:config-isolation` (`CONFIG_DIR` ≠ `join(homedir(), '.craft-agent')` и не child этого пути). Текущий default home — `~/.craft-agent`; assertion **не** покрывает `~/.rox`, пока human-blocked M1 не сменит default — тогда расширить preload на оба real home **до** suite. `@craft-agent/electron` **не имеет** test script — только root `bun test` или явные пути. Никакой in-scope bun test не запускает Electron/BrowserWindow.

### Задача 23. OMP lifecycle (fake CLI, без live credentials)

**SoT:** `packages/shared/src/agent/__tests__/omp-startup-lifecycle.test.ts`, `omp-session-flow.test.ts`, `omp-lifecycle-hardening.test.ts`, `omp-query-llm.test.ts`, `omp-source-proxy.test.ts`, `errors.test.ts`, `backend/__tests__/factory.test.ts`; `packages/shared/src/agent/backend/factory.ts` (`createBackendFromConnection`, `createBackendFromResolvedContext`, `connectionToAgentProvider`); fake CLI `omp-fake-cli.ts`, `fixtures/fake-omp-rpc.mjs`.

**Prerequisite:** Isolation gate (Задача 23 шаг 1). Нет package.json script на эти файлы. Не подменять root `test:shared:all` / `validate:dev` / `validate:ci`. Factory-dispatch test **на named current ship ref**; prerequisite Задачи 28a. Без live credentials.

- [ ] **Шаг 1.** `bun run test:config-isolation`.
- [ ] **Шаг 2.** Primary: `cd packages/shared && bun test src/agent/__tests__/omp-startup-lifecycle.test.ts src/agent/__tests__/omp-session-flow.test.ts src/agent/__tests__/omp-lifecycle-hardening.test.ts src/agent/__tests__/omp-query-llm.test.ts src/agent/__tests__/omp-source-proxy.test.ts src/agent/__tests__/errors.test.ts src/agent/backend/__tests__/factory.test.ts`
- [ ] **Шаг 3.** Factory-dispatch (credential-free, обязателен, **на current ship ref**): добавить/запустить deterministic test, который **начинает с OMP `LlmConnection`** и идёт через public connection factory / resolved-context path — `createBackendFromConnection` и/или `createBackendFromResolvedContext` (включая `connectionToAgentProvider`, provider/auth validation, driver selection, runtime preparation в `packages/shared/src/agent/backend/factory.ts`). Доказать, что получившийся fake-CLI turn обрабатывает **`OmpAgent`** (не hang, не anthropic/pi backend). Прямой `createBackend({ provider: 'omp' })` и listing-only `factory.test.ts` **недостаточны** — они обходят seeded OMP connection route.
- [ ] **Шаг 4.** Не считать optional `cd packages/shared && bun run test` обязательным доказательством, если listed files не в run.

**Acceptance:**

- Exit 0, 0 fail.
- Startup matrix (`omp-startup-lifecycle`, `chatEvents` timeout 8s): exit-before-ready → typed_error.code `OMP_NO_MODELS` (stderr `/models\.yml|API key/i`) | `OMP_AUTH_REQUIRED` | `OMP_START_FAILED` | `OMP_PROTOCOL_ERROR` | `OMP_NOT_CONFIGURED` (ENOENT) | `OMP_READY_TIMEOUT` (silent never-ready, 20s timer shrunk in-test). Last event `complete`; `agent.isProcessing()` false; no hang. Ровно один typed_error и один error на no-models. Abort during slow-ready: complete, нет typed_error/error, isProcessing false. Failed startup затем `fake.setScenario('healthy')` respawn: `text_complete`, нет typed_error. chat → `reconnect()` → chat оба дают `text_complete`.
- Healthy turn (`omp-session-flow`): `text_delta` `['Hello',' world']`, `text_complete` `'Hello world'` `isIntermediate false`, `complete.usage` inputTokens=10 outputTokens=5, isProcessing false. `thinking_delta`/`thinking_complete` `'let me think'` до `text_complete`. `omp_turn_anchor.entryId` `'bbbb2222'`. `set_host_tools` включает `mcp__session__spawn_session`, `mcp__session__call_llm`, `mcp__session__browser_tool`, `mcp__session__bash`, unprefixed `bash`, все `loadMode 'essential'`. `setModel('kimi-K2')` шлёт `set_model {provider:'rox', modelId:'kimi-k2'}` без ключа `model`.
- Hardening: concurrent chat during slow-ready → `fake.readArgvLog().length === 1`, один stream с `text_complete`. SIGTERM-immune never-ready → `OMP_READY_TIMEOUT` затем retry `spawnCount===2`, first pid reaped (SIGKILL). ~80KB stderr после `'No models available'` всё ещё `OMP_NO_MODELS`. Mid-turn crash: ровно один error, last event complete, isProcessing false.
- queryLlm: `--model kimi-k2` как `result.model`; без `--model` если unrequested; rejected model fallback warning `unknown-model-x`; ENOENT `OMP_CLI_PATH` rejects.
- Source-proxy (30s it): `PROXY_TOOL mcp__ompsrc__echo`; `host_tool_result` id `htc-1` isError false text `'echo:hello-from-omp'`.
- `errors.test.ts`: map `OMP_*` → `AgentError.code`; `scrubOmpStderr` redacts sk-ant / ghp_ / jwt / bearer, держит `'No models available'`.
- `factory.test.ts` listing: `getAvailableProviders()` содержит anthropic, pi, omp (length 3); `isProviderAvailable('omp')` true. **Этого мало.** Factory-dispatch test на current ship ref: OMP `LlmConnection` → public `createBackendFromConnection` / `createBackendFromResolvedContext` → fake-CLI turn handled by `OmpAgent` (не hang, не anthropic/pi). `createBackend({ provider: 'omp' })` как единственный entry — fail этой задачи. Задача 28a не стартует без этого теста на ship ref.

**Verification:**

- Isolation: preload; suites mkdtemp fake CLI dirs; restore `OMP_CLI_PATH` in afterEach; `agents.destroy()`; hardening afterEach `pkill -9 -f` fake script path затем `rmSync`. Не писать `~/.craft-agent` / `~/.rox` / `~/.omp`.
- Wall-clock: chatEvents 8s; session-flow 15–20s; hardening 15–20s; source-proxy 30s.
- Не доказывает: реальный `omp` binary, `~/.omp/agent`, `api.rox.one`, live `ROX_API_KEY`. Root `bun test` green ≠ эти файлы ran.

### Задача 24. Seeded configuration и migrations

**SoT:** `packages/shared/src/config/__tests__/`; `bun run test:shared:config`; `bun run test:config-isolation`; `bun run test:shared:llm-connections`.

**Prerequisite:** Isolation preload. `test:shared:all` не покрывает OMP agent / WS / electron startup. Не использовать `test:connection-fabric` как in-scope config gate (тянет packages/core identity).

- [ ] **Шаг 1.** `bun run test:config-isolation`
- [ ] **Шаг 2.** `cd packages/shared && bun test src/config/__tests__/llm-connections.test.ts tests/llm-connections.test.ts src/config/__tests__/storage-startup-migration.test.ts`
- [ ] **Шаг 3.** `bun run test:shared:config` (четыре файла: llm-connections + storage-migrations + storage-startup-migration + default-thinking-level)
- [ ] **Шаг 4.** Additional storage I/O: `cd packages/shared && bun test src/config/__tests__/storage-update-llm-connection.test.ts src/config/__tests__/session-drafts.test.ts src/config/__tests__/env-overrides.test.ts src/credentials/__tests__/secure-storage-recovery.test.ts tests/session-validation.test.ts src/sessions/__tests__/jsonl-crash-recovery.test.ts`

**Acceptance:**

- Exit 0, 0 fail.
- config-isolation: `CONFIG_DIR !== join(homedir(), '.craft-agent')` и не prefix+`/`. Не трактовать это как защиту `~/.rox` (M1 human-blocked). Не писать real `~/.craft-agent` / `~/.rox`.
- `getDefaultModelsForConnection('omp')` ids `['rox/explore','rox/standard','rox/max','rox/vision','rox/fast']`; default `'rox/standard'`; mini `'rox/fast'`.
- storage-startup-migration: subprocess `CRAFT_CONFIG_DIR` = mkdtemp `'craft-agent-config-'`; seeded `rox-kimi` → name `'ROX · OMP'`, defaultModel `'rox/standard'`, models public ROX plane, `migrationsApplied` содержит `'rox-kimi-public-models-v1'`.
- `storage-migrations.test.ts` — pure predicates, без disk I/O.

**Verification:**

- Startup-migration и default-thinking-level изолируются subprocess env, не мутацией frozen `CONFIG_DIR` родителя.
- Не доказывает first-run `~/.omp/agent/models.yml` (это `omp-first-run.test.ts`), Electron `loadStoredConfig` at launch, live LLM.

### Задача 25. Session WebSocket RPC (transport)

**SoT:** `apps/electron/src/__tests__/transport.test.ts`, `transport-resolve-target.test.ts`; `apps/electron/src/transport/__tests__/codec.test.ts`, `routed-client.test.ts`, `channel-map-parity.test.ts`; `packages/shared/src/protocol/__tests__/handshake-fixture.test.ts`, `routing.test.ts`; renderer `transport-wait.test.ts`, `reconnect-recovery.test.ts`, `transport-connection-banner.test.ts`.

**Prerequisite:** Нет Electron process. Servers на 127.0.0.1 port 0. `server-bootstrap.test.ts` (SSH) out of scope.

- [ ] **Шаг 1.** `bun test apps/electron/src/__tests__/transport.test.ts apps/electron/src/__tests__/transport-resolve-target.test.ts apps/electron/src/transport/__tests__/codec.test.ts apps/electron/src/transport/__tests__/routed-client.test.ts apps/electron/src/transport/__tests__/channel-map-parity.test.ts`
- [ ] **Шаг 2.** `bun test packages/shared/src/protocol/__tests__/handshake-fixture.test.ts packages/shared/src/protocol/__tests__/routing.test.ts apps/electron/src/renderer/lib/__tests__/transport-wait.test.ts apps/electron/src/renderer/lib/__tests__/reconnect-recovery.test.ts apps/electron/src/renderer/components/app-shell/__tests__/transport-connection-banner.test.ts`

**Acceptance:**

- Exit 0, 0 fail.
- Handshake: `client.isConnected` true после `createPair()`; `server.port > 0` при port=0; handshake без `protocolVersion` close code 4004.
- RPC: `invoke('greet','World') === 'Hello, World!'`; `add(3,4)===7`; unknown channel `CHANNEL_NOT_FOUND`; handler throw `HANDLER_ERROR`; reconnect replay; auth token `'valid-token'` → connected, wrong token → not.
- CHANNEL_MAP: compile-time AssertNever + runtime invoke|listener.
- Protocol 1.0; каждый RPC channel ровно в `LOCAL_ONLY` xor `REMOTE_ELIGIBLE`; onboarding `START_ROX_CONNECT` / `GET_ROX_CLOUD_STATE` / `CLEAR_ROX_CLOUD` и `SAVE_OMP_CREDENTIAL` — LOCAL_ONLY.
- Banner hidden для null/local/healthy-remote; shown когда remote reconnecting. Banner tests пинят i18n `'en'`.

**Verification:**

- afterEach destroys clients/closes servers. Не доказывает preload bootstrap, production handler registration, painted UI, live native sidecar.

### Задача 26. Desktop startup и restart (без автоматического BrowserWindow)

**SoT:** `apps/electron/src/main/__tests__/init-gate.test.ts`, `i18n-bootstrap.test.ts`, `connection-setup-logic.test.ts`; `apps/electron/src/shared/__tests__/ipc-channels.test.ts`; isolated `sessions-annotations.isolated.ts`, `session-branch-rollback.isolated.ts`, `notifications-routing.isolated.ts`.

**Prerequisite:** Нет in-scope теста, который запускает Electron. `session-persistence.test.ts` — inlined characterization, не I/O. `native-sidecar-health.test.ts` — view mapping only.

- [ ] **Шаг 1.** `bun test apps/electron/src/main/__tests__/init-gate.test.ts apps/electron/src/main/__tests__/i18n-bootstrap.test.ts apps/electron/src/main/__tests__/connection-setup-logic.test.ts apps/electron/src/shared/__tests__/ipc-channels.test.ts`
- [ ] **Шаг 2.** Isolated (не в default `bun test`): `bun test apps/electron/src/main/__tests__/sessions-annotations.isolated.ts apps/electron/src/main/__tests__/session-branch-rollback.isolated.ts apps/electron/src/main/__tests__/notifications-routing.isolated.ts`
- [ ] **Шаг 3.** Manual smoke: Задача 20 preflight, затем `bun run electron:dev`. Alternative after build: `bun run electron:start`. Не `apps/electron` `dev`. Не `electron:dev:terminal`.
- [ ] **Шаг 4.** Manual restart: quit Electron (скрипт не вызывает `app.relaunch`). Relaunch. Main/preload правки видны только после process restart; renderer HMR — нет.

**Acceptance:**

- Automated: exit 0. InitGate `wait()` resolves after `markReady`; rejects `'init failed'` after `markFailed`; settles once.
- i18n-bootstrap: subprocess `CRAFT_CONFIG_DIR`; persisted `uiLanguage` hydrates main i18n (timeout 15s/it).
- ipc-channels: `flattenValues(RPC_CHANNELS)` length === `EXPECTED_COUNT`, нет duplicate wire strings.
- Manual: процесс жив, окно открывается, renderer грузится (dev: Vite URL + 5 retries; prod: `loadFile dist/renderer/index.html`); нет crash loop.

**Verification:**

- Isolated tests mock electron — GUI не спавнится.
- `electron:start` failure может быть build, не runtime. Instance isolation: folder `*-N` без `CRAFT_VITE_PORT` → port `N173`.

### Задача 27. First-run onboarding seam (автотесты + isolated manual)

**SoT:** `packages/shared/src/agent/__tests__/omp-first-run.test.ts`; `apps/electron/src/renderer/hooks/__tests__/useOnboarding.test.ts`; handlers `apps/electron/src/main/onboarding.ts`. `saveOmpRoxCredential` пишет через `homedir()` в `~/.omp/agent`.

**Prerequisite:** Desktop Connect UI (Задача 6) — отдельный live device-flow. Этот task — shared seam + slug helpers. Manual **обязан** disposable `HOME` **и** disposable `CRAFT_CONFIG_DIR`. Root `.env` сейчас absent — shell isolation работает. Если `.env` пинит `HOME`/`CRAFT_CONFIG_DIR` — STOP (isolated checkout `.env` или code change), не shell override. Задача 20 preflight до `electron:dev`.

- [ ] **Шаг 1.** `cd packages/shared && bun test src/agent/__tests__/omp-first-run.test.ts`
- [ ] **Шаг 2.** `bun test apps/electron/src/renderer/hooks/__tests__/useOnboarding.test.ts` (slug/connection-setup; не wizard)
- [ ] **Шаг 3.** Snapshot real `~/.craft-agent`, `~/.rox`, `~/.omp` (mtime/hash or `find`). Preflight Задача 20.
- [ ] **Шаг 4.** Manual isolated: `export HOME=$(mktemp -d)` и `export CRAFT_CONFIG_DIR=$(mktemp -d)`; подтвердить, что `.env` не перебивает ни одно. Затем `bun run electron:dev`. Пройти welcome → (rox-connect UI без credential submit, если isolation не доказана) → provider-select / omp-credential (`OmpCredentialStep`, typedCode `OMP_NO_MODELS`). **Не вводить OMP/Connect credentials**, пока isolation (HOME+config, not overridden by `.env`) не подтверждена. Optional `onboarding:deferSetup` без credential write.
- [ ] **Шаг 5.** Только если шаг 4 isolation effective: Submit → `onboarding:saveOmpCredential` пишет в disposable HOME, не real `~/.omp`. Restart с теми же disposable HOME+config: deferred → wizard не возвращается.
- [ ] **Шаг 6.** Verify: real `~/.craft-agent`, `~/.rox`, `~/.omp` unchanged vs snapshot.

**Acceptance:**

- Missing models.yml+config.yml: ready false, code `OMP_NO_MODELS`, `canProvision` false без ключа.
- `provisionOmpRoxConfig` создаёт `models.yml`/`config.yml` под tempHome; raw apiKey отсутствует; `apiKey: ROX_API_KEY`; `https://api.rox.one/v1`.
- `isOmpCredentialErrorCode` true только для `OMP_NO_MODELS`, `OMP_AUTH_REQUIRED`, `OMP_NOT_CONFIGURED`.
- Manual: окно показывает onboarding; secret не пишется raw в models.yml; real homes/`~/.omp` не мутированы.
- Credential entry не выполнялась, если `.env` мог override isolation.

**Verification:**

- `omp-first-run` mkdtemp `'omp-first-run-'`, never real `~/.omp`.
- Post-manual diff of real config root and real `~/.omp` is empty.
- Не доказывает live Rox Cloud device-flow (это Задача 6). `registerOnboardingHandlers` не покрыт electron bun test в этой карте.

### Задача 28. Real OMP — Ticket-13 на ship-ветке + RED→GREEN `live-turn-gate.ts`

**SoT:** `packages/shared/src/agent/live-turn-gate.ts` (`claimLiveTurnVerified`, `evaluateLiveTurnGate`); `packages/shared/src/agent/__tests__/live-turn-gate.test.ts`; `packages/shared/src/agent/live-turn-e2e.ts`; historical Wave 5 VERIFIED evidence `plans/next-program/13-live-e2e-evidence.md`. **Текущий дефект:** `live-turn-gate.ts` принимает `existsSync` paths (empty file / directory) и caller-supplied `verified: true`. Existing test покрывает только non-missing paths. Stating content-evidence rules без изменения gate — fail этой задачи.

**Prerequisite:** Default bun tests **никогда** не claim VERIFIED. Без user-provided `ROX_API_KEY` — STOP, BLOCKED. Не dummy key в CI. Совмещать с Задачей 2. Wave 5 stream/host-tool/MCP/permission/restart — historical VERIFIED; **не** rerun пять шагов по умолчанию. Full live requalification **только** если named tree change на current ship ref инвалидирует historical evidence (записать SHA/files). Код gate — **на named current ship ref**; prerequisite Задачи 28a.

**Files:** `packages/shared/src/agent/live-turn-gate.ts`; `packages/shared/src/agent/__tests__/live-turn-gate.test.ts`. Оба в allowed-code. Изменения только на current ship ref.

- [ ] **Шаг 0. RED→GREEN `claimLiveTurnVerified` / `live-turn-gate.ts` (обязателен, до live recheck):** Изменить gate так, чтобы он **не** принимал `existsSync`-only paths и **не** доверял caller-supplied `verified: true` / caller booleans. Требовать nonempty **regular files** (не empty file, не directory) и record-level evidence (matching log/trace records). Добавить negative tests, которые **падают на текущем gate** и зеленеют после фикса: (a) empty file; (b) directory path; (c) caller boolean / `{ verified: true }` без matching log/trace records — claim не `live-turn-verified`, throws. Existing «path exists» test **недостаточен**. Running existing gate test green while unsafe behavior remains — fail этой задачи.
- [ ] **Шаг 1.** Всегда (без сети): `cd packages/shared && bun test src/agent/__tests__/live-turn-gate.test.ts` — включая negative tests шага 0.
- [ ] **Шаг 2.** `bun packages/shared/src/agent/live-turn-e2e.ts` — never claims VERIFIED; exit 0 на BLOCKED и READY-but-not-run.
- [ ] **Шаг 3.** Если stdout `BLOCKED` / `missingSecret ROX_API_KEY`: STOP. Не claim `stream_answer`, `host_tool`, `mcp_tool`, `permission_prompt`, `restart_restore`.
- [ ] **Шаг 4. Default live recheck (human, `ROX_API_KEY`):** только Ticket-13 ask-mode Allow на **named current ship ref** (Задача 2). Observable: permission request UI; Allow outcome **с command hash** (не `admin_approval` fail-closed); session returns idle. Non-empty log **и** non-empty browser/trace file; bind claim to concrete records, не caller boolean. Не добавлять credentials в репозиторий.
- [ ] **Шаг 5.** Full five-step requalification **только** при named tree change. Тогда для каждого шага nonempty regular file + log/trace records: stream output text; host-tool result; MCP result; permission request/Allow; restored session identity. Empty files / directories / `verified: true` без records — не VERIFIED.
- [ ] **Шаг 6.** `claimLiveTurnVerified` (уже изменённый шаг 0) только если gate READY, оба evidence files nonempty regular files, и step evidence — records не booleans. Throws без log+trace даже если READY; throws на BLOCKED даже если files exist; throws на empty file / directory / asserted boolean.

**Acceptance:**

- `live-turn-gate.ts` изменён на current ship ref; `claimLiveTurnVerified` требует nonempty regular files + record-level evidence.
- Negative tests (empty file, directory, caller boolean without records) red-then-green. Existing path-exists-only suite **не** sufficient.
- Gate tests exit 0. Без ключа: `hasRoxApiKey` false, ready false, `missingSecret 'ROX_API_KEY'`.
- `evaluateLiveTurnGate` BLOCKED: claim `live-turn-not-claimed`, steps BLOCKED, reason `/ROX_API_KEY/`.
- `live-turn-e2e.ts` печатает `status: BLOCKED` или `READY` плюс `claim: live-turn-not-claimed`; никогда `live-turn-verified`.
- Default complete = Ticket-13 Allow path on current ship ref with nonempty event/trace. Не полный Wave 5 rerun.
- Full five-step VERIFIED только после named invalidating tree change + content-level records.
- Задача 28a не стартует без этого gate-diff на ship ref.

**Verification:**

- Gate tests `tempHome()` `'live-turn-gate-'`. bun test green ≠ live OMP turn. Fake CLI не замена. READY ≠ VERIFIED. `existsSync` ≠ nonempty evidence. Modified gate rejects empty file, directory, and boolean-without-records.

### Задача 28a. Финальный review/merge gate текущего ship ref

**SoT:** Задача 0 named current ship ref + reviewable path; post-port Задача 2; код Задач 6, 20 (launcher), 23, 28 на этом ref; board review-gate checklist.

**Prerequisite:** Задачи 0, 1, 2 complete. Задачи 6, 23, 28 **код на current ship ref** (Connect expiry/poll + tests; factory-dispatch connection-path test; `live-turn-gate.ts` + negative tests). Задача 20 шаг 0 (launcher port-owner refuse or no-kill) на том же ref. Не merge, пока любой из этих diffs отсутствует. Не reopen A–H / OMP v2. Не `git push --delete`. Не коммитить секреты. Не merge closed-unmerged PR #5.

**Files:** не менять exclusive A–H; не production infra.

- [ ] **Шаг 1.** Подтвердить, что **named current ship ref** (Задача 0, с учётом successor updates) содержит: Ticket-13 port-or-confirm; Задача 6 implementation+tests; Задача 23 OMP `LlmConnection` → public connection factory → `OmpAgent` fake-CLI turn; Задача 28 `live-turn-gate.ts` + negative tests; Задача 20 launcher refuse-or-no-kill. Если нет — STOP, не merge.
- [ ] **Шаг 2.** Reviewable path: открытый PR (PR #5 если он всё ещё current ship ref и open; иначе successor PR из Задачи 0 B/C). Полный diff vs base, package typechecks, targeted tests с RED-evidence, security, no third-party copy, no production-infra.
- [ ] **Шаг 3.** Merge **или** явный named review-blocker. Записать **merged SHA** (или blocker). Это **единственный** certified ship merge этого плана. Packaging (Задача 29) **запрещена** без этого SHA.
- [ ] **Шаг 4.** Если merge: evidence Задачи 29 bind к этому SHA — checkout/build **from that SHA**, не unmerged follow-up working tree.

**Acceptance:**

- Current ship ref смержен **или** blocked с именованным дефектом.
- Merged SHA (если merge) содержит код Задач 6, 23, 28 (+ launcher Задачи 20, + Ticket-13).
- Packaging не стартует без этого SHA.
- Ветки open / merged / closed-unmerged PR #5 Задачи 0 соблюдены.

**Verification:**

- Recorded merge SHA (GitHub / `git log -1`). Diff SHA vs pre-6/23/28 tree показывает required files: onboarding expiry/poll, connection-factory dispatch test, `live-turn-gate.ts`, `scripts/electron-dev.ts`.
- Нет push `--delete`, нет credentials в дереве.

### Задача 29. Packaging QA (unsigned + production-mode smoke) — не RC

**SoT:** root scripts `electron:dist:dev:mac`, `electron:dist:mac`, `electron:dist:win`, `electron:dist:linux`; `apps/electron/electron-builder.yml`; **не** `apps/electron` `dist:mac` (`bash scripts/build-dmg.sh arm64`). Deferred runtime: `packages/shared/src/agent/backend/internal/drivers/anthropic.ts` `strict:false` на startup — packaged SDK path валидируется при prepare backend, не при open window.

**Prerequisite:** Задача 28a complete с **merged SHA**. Собирать и смоукать **только** дерево этого SHA. Manual/build smoke, не bun:test. yml mac targets dmg+zip **arm64 и x64** — local run может dual-arch. `notarize` commented out; `hardenedRuntime: true`; `gatekeeperAssess: false`. Этот план **finalizes QA only и не производит RC**. Signing/notarization/Windows/Linux RC — Задача 29b. x64 artifact **не** принимается только по наличию files/hashes: нужен x64 host/Rosetta production smoke **или** explicit product/release exclusion.

- [ ] **Шаг 0.** Checkout/build from Задача 28a merged SHA. Записать SHA в evidence. Не smoke unmerged working tree.
- [ ] **Шаг 1.** Unsigned local: `bun run electron:dist:dev:mac` (`CSC_IDENTITY_AUTO_DISCOVERY=false CRAFT_DEV_RUNTIME=1 bun run electron:build && cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --config electron-builder.yml --mac`)
- [ ] **Шаг 2.** Не использовать `apps/electron` `dist:mac` как этот путь.
- [ ] **Шаг 3.** Inspect unsigned `apps/electron/release/`: `Craft-Agents-${arch}.dmg` / `.zip`; productName `'Craft Agents'`; appId `com.lukilabs.craft-agent`. Unpacked: `mac-arm64/Craft Agents.app` vs `mac/Craft Agents.app`. Record timestamps/hashes. `CRAFT_DEV_RUNTIME=1` — **не** RC.
- [ ] **Шаг 4.** Manual unsigned: mount/open current-arch dmg или .app. Ожидать Gatekeeper (right-click Open / quarantine strip). Процесс жив, окно открывается. Не называть RC.
- [ ] **Шаг 5. Required production-mode smoke (отдельный от шага 1):** `bun run electron:dist:mac` **без** `CSC_IDENTITY_AUTO_DISCOVERY=false` и **без** `CRAFT_DEV_RUNTIME=1`. `CRAFT_DEV_RUNTIME` **absent** в process env. Fresh artifact timestamps/hashes (новее этого run). Launch current-arch production `.app`/`.dmg`. **Недостаточно открыть окно:** подготовить/создать backend/session, чтобы сработала deferred runtime resolution (packaged SDK/Bun/interceptor). Доказать, что resolved paths остаются **внутри** `.app` artifact, не dev-runtime.
- [ ] **Шаг 5b. mac x64 / Rosetta:** yml emits x64 DMG/ZIP. Либо (a) production-mode launch на **x64 host или Rosetta** с тем же backend/session + in-artifact runtime proof, что шаг 5; либо (b) explicit product/release exclusion x64 с named owner и recorded decision — тогда x64 artifacts не handoff. Current-arch-only launch **не** покрывает x64.
- [ ] **Шаг 6.** Optional: `cd apps/electron && bun run build:validate`.

**Acceptance:**

- Packaging evidence bound к Задача 28a merged SHA.
- Оба builder exit 0. Unsigned и production-mode артефакты существуют с distinct hashes. asar: false; extraMetadata.main `dist/main.cjs`; Codex/Copilot MCP excluded; mac hardenedRuntime true.
- Unsigned `CRAFT_DEV_RUNTIME=1` **не** production RC и **не** замена шага 5.
- Шаг 5: backend/session prepared; deferred runtime paths inside artifact; `CRAFT_DEV_RUNTIME` absent. «Окно открылось» ≠ production resolution.
- x64: smoke на x64 host/Rosetta **или** named product/release exclusion. Не принимать Intel package только потому что files/hashes существуют.
- Ни один артефакт этого плана не назван RC.

**Verification:**

- Record SHA, env (`CRAFT_DEV_RUNTIME` unset), resolved runtime path prefix inside `.app`.
- x64/Rosetta evidence **или** exclusion record.
- Тяжёлый dual-arch, мутирует `apps/electron/release/`. Не доказывает Developer ID, notarization, Gatekeeper pass без right-click, auto-update с `https://agents.craft.do/electron/latest`, Windows NSIS, Linux AppImage.

### Задача 29b. Human release-engineering — BLOCKED (этот план не RC)

**Human owner (required):** _unassigned._

Этот план **не** производит release candidate. Пока handoff не complete, Windows/Linux/signing **не** молча skip.

- [ ] **Шаг 1.** Signing identity (Developer ID) + notarization/Gatekeeper evidence на mac production artifact(s) that Task 29 did not exclude (arm64 и x64, unless x64 has named product/release exclusion).
- [ ] **Шаг 2.** Release-channel / electron-updater evidence (`publish.url`, appId — M5 BLOCKED, не flip здесь).
- [ ] **Шаг 3.** Windows NSIS artifact + required Windows onboarding pass (или **BLOCKED**, не skip).
- [ ] **Шаг 4.** Linux AppImage artifact или explicit product exclusion.
- [ ] **Шаг 5.** Named approver записывает: RC out of scope for this plan **или** RC produced outside this agent session.

**Acceptance:** Handoff record exists. QA plan complete without RC. Windows unavailable → **BLOCKED** on 29b/Task 30 Git Bash, не recorded skip.

---

## 9. Visual / UX verification (playground + live, не unit tests)

Нет Playwright/Cypress/visual-regression. bun unit/SSR и `apps/electron/resources/scripts/tests` CLI smokes **не** visual coverage. Playground (`apps/electron/src/renderer/playground.html`, registry `playground/registry/index.ts`) — dry-run catalog: `PlaygroundAppShellProvider` **форсит** `isCompactMode true`; OnboardingFlowDemo пропускает rox-connect / git-bash / omp-credential; ThinkingCard не доказывается. Sibling functional QA владеет behavioral pass/fail.

### Задача 30. First-run и onboarding visual (live Electron + WebUI login)

**SoT:** `apps/electron/src/renderer/App.tsx`; `components/onboarding/OnboardingWizard.tsx` (welcome, rox-connect, git-bash Windows, provider-select, local-model, credentials, omp-credential, complete); `apps/webui` `login.html`; AppShell `OnboardingDialog` (memory seed).

**Prerequisite:** Empty-auth profile на disposable HOME+config (Задача 20/27). Live/staged auth для Rox Connect / OAuth / Copilot / OMP только если isolation effective. **Windows host/owner (human):** _unassigned._ Если unassigned или host unavailable: Git Bash path = **BLOCKED** (не skip). Task 30 не complete, пока Git Bash BLOCKED, если Windows не excluded отдельным product handoff. Связано с Задачей 6 — здесь chrome/stacking. ReauthScreen **исключён** (нет `appState=reauth` transition; `handleReauthLogin` placeholder).

- [ ] **Шаг 1.** Electron empty auth: Splash/loading → onboarding | workspace-picker | ready. **Не** требовать ReauthScreen. Titlebar-drag 50px не перекрывает step titles; wizard `bg-foreground-2`, centered, scrollable (`p-4` / `sm:p-8`).
- [ ] **Шаг 2.** Пройти шаги: welcome → rox-connect (idle → starting → waiting with codes → success | expiry-error | network-error) → Windows git-bash (**assigned host** или BLOCKED) → provider-select (Claude, ChatGPT, Copilot, API, Local, OMP, Setup later).
- [ ] **Шаг 3.** Каждая credential branch: validating/error/success; Claude two-step OAuth; Copilot device-code; local-model; omp-credential → complete. Credential entry только при disposable HOME+config и `.env` not overriding.
- [ ] **Шаг 4.** После first ready: memory `OnboardingDialog` над shell, не dual full-screen с wizard.
- [ ] **Шаг 5.** Settings → AI: embedded wizard add/edit; edit prefill; back/cancel без blank overlay.
- [ ] **Шаг 6.** WebUI `login.html` static, default **ru**; en только если `localStorage i18nextLng` = en. viewport-fit=cover, theme-color `#1F1F24`. Затем LoadingScreen → Electron App gates.

**Acceptance:**

- Каждый шаг центрирован на desktop и scrollable на ~390px без clipped primary buttons.
- Rox Connect waiting/error/success, Git Bash (**or BLOCKED with named owner**), Claude OAuth, Copilot device, OMP credential визуально различны и совпадают с production copy, не playground mock.
- Setup later → ready без leftover wizard.
- Memory dialog — modal over shell after ready.
- WebUI login default Russian; brand/language не расходятся с i18n App после login.
- Reauth не в acceptance.

**Verification:**

- Live Electron first-run, не playground Onboarding Flow demo. Isolation: real homes unchanged.
- Live WebUI `/login` затем `/`. Resize ~390 и ≥1024 на самом высоком шаге (credentials + error).
- SSR OnboardingWizard.test.tsx не visual coverage.
- Git Bash: pass on assigned Windows host **или** BLOCKED record — never skip.

### Задача 31. Chat, thinking, permissions, tool overlays (desktop ≥768)

**SoT:** `pages/ChatPage.tsx` → `ChatDisplay`; `packages/ui` `ThinkingCard`, `TurnCard`; `PermissionRequest` (`data-tutorial=permission-banner`); `AdminApprovalRequest`; `CredentialRequest`; `AcceptPlanDropdown`; overlays Activity/MultiDiff/Code/HTML/Image/JSON/Mermaid/PDF/DataTable/Terminal/Document.

**Prerequisite:** Thinking-capable live model для ThinkingCard (иначе record blocked и всё равно сделать permission/plan/overlay). Окно ≥768 (не дублировать compact task). Fake CLI не visual.

- [ ] **Шаг 1.** Стрим reasoning: ThinkingCard над assistant TurnCard, expanded while `thinking.isStreaming`, force-collapse on `thinking_complete`; reload — card vanishes (runtime-only).
- [ ] **Шаг 2.** Модель без extended thinking: thinking control disabled. `thinkingLevel` sticky через `setThinkingLevel` когда модель умеет.
- [ ] **Шаг 3.** PermissionRequest Allow / Always Allow / Deny; long command scroll inside card. Затем AdminApproval и CredentialRequest. Structured input заменяет composer, не toast.
- [ ] **Шаг 4.** Cycle Explore/Ask/Execute (safe/ask/allow-all) через dropdown и Shift+Tab. Цвета: safe `bg-foreground/5 text-foreground/60`, ask `bg-info/10 text-info`, allow-all `bg-accent/5 text-accent`. Accept Plan из safe → allow-all; ask не override. Следить за optimistic vs `reconcilePermissionModeState`.
- [ ] **Шаг 5.** Desktop Radix AcceptPlanDropdown (не compact vaul).
- [ ] **Шаг 6.** Tool overlays trigger mapping: bash/mcp__/browser_ → ActivityCardsOverlay; Edit/Write → MultiDiff; escape-stack overlay → Island → fullscreen z 300+. OverlayErrorBanner max-width 850px. **Исчерпывающий visual pass каждого overlay type — Задача 35**, не этот шаг.
- [ ] **Шаг 7.** Composer: send, attachments, SkillSelectorPopover, ActiveTasksBar chips.

**Acceptance:**

- ThinkingCard над ответом, collapsed после complete, отсутствует после reload.
- Permission actions не clip. Mode badge color совпадает после cycle/plan/reconcile.
- Desktop model picker — hierarchical dropdown + thinking submenu, не `CompactModelSelector`.

**Verification:**

- Live thinking stream (`OMP thinking_*`). packages/ui unit tests не visual proof.

### Задача 32. MCP, sources, skills, settings navigator

**SoT:** sidebar Sources; `SourceInfoPage`; `EditPopover` add-source*; `SetupAuthBanner`; Skills `SkillInfoPage`; `shared/settings-registry.ts` 18 pages; `ConnectionsPage` (CF-6, не settings subpage).

**Prerequisite:** Populated workspace: ≥1 MCP stdio + remote, 1 API source, 1 skill. Не re-walk OnboardingWizard в AI settings (Задача 30).

- [ ] **Шаг 1.** Sources filter api/mcp/local; add-source* popovers не clip navigator.
- [ ] **Шаг 2.** MCP SourceInfoPage: ToolsDataTable loading|rows|error|empty; status dots connected / untested / `mcp_auth` / `local_disabled` (stdio off в settings/workspace Local MCP — muted `bg-foreground/30`, Disabled).
- [ ] **Шаг 3.** SetupAuthBanner `mcp_auth` | `api_auth` | error в banner и inputAreaCover; Connect/credentials/retry не перекрывают composer.
- [ ] **Шаг 4.** Skills list vs OMP-only; SkillInfoPage save busy/error.
- [ ] **Шаг 5.** Marketplace skillpack: idle → busy/disabled → success/error (busy не пропускать).
- [ ] **Шаг 6.** Sweep SETTINGS_PAGES: runtime, context, marketplace, knowledge, extensions, app, ai, appearance, input, workspace, accounts, permissions, labels, organizations, messaging, server, cloudRuns, shortcuts.
- [ ] **Шаг 7.** ConnectionsPage tabs services/credentials/imports/policies/audit включая empty/disabled при optional RPC missing.
- [ ] **Шаг 8.** KeyboardShortcutsDialog над settings, не под TopBar.

**Acceptance:**

- Пять разных visuals: `local_disabled`, `mcp_auth`, tools-loading, tools-error, tools-empty.
- Все 18 settings ids — реальная страница, не blank panel.
- Marketplace busy ≠ idle.

**Verification:**

- Toggle Local MCP servers и сразу re-check stdio `local_disabled` — playground samples static.
- Skill/source not-found — в Задаче 34, не здесь.

### Задача 33. Responsive Electron и WebUI (768 shell, 640 knowledge, ~390)

**SoT:** AppShell `isAutoCompact` / `MOBILE_THRESHOLD` / `COMPACT_VIEWPORT_WIDTH` 768; knowledge `KNOWLEDGE_MOBILE_WIDTH` 640; WebUI `useIsMobile` `(max-width: 768px)` только touch/keyboard/safe-area. Compact: `CompactModelSelector`, `CompactPermissionModeSelector`, `CompactSessionListFilter/Menu`, `CompactAcceptPlanDrawer`, `MobileAppMenu`.

**Prerequisite:** Измерять **shell container width** (`useContainerWidth`), не OS window. Playground mobile frames (iPhone 15 390×844, SE 375×667, Pixel 8 412×915) — orientation only, forced compact.

- [ ] **Шаг 1.** Electron resize через 768: ниже — hide sidebar/navigator, compact headers, full-width session list; выше — desktop split без stuck compact header.
- [ ] **Шаг 2.** На ~390 и ~768 в Electron и WebUI открыть четыре compact drawers. Худший clip: just-below-768 vs `@container/panel` overflow-hidden.
- [ ] **Шаг 3.** WebUI compact settings (`isWebUI && isAutoCompact && settings route`) — single-panel stack; Electron compact chat этого не использует.
- [ ] **Шаг 4.** Knowledge: при shell ≥768 сузить knowledge panel <640 → full-width tree; если shell уже compact — knowledge mobile chrome сразу.
- [ ] **Шаг 5.** WebUI phone/DevTools: login.html + chat input; virtual keyboard не кроет composer или FabNewChat (`bottom: calc(env(safe-area-inset-bottom)+1rem)`).

**Acceptance:**

- Crossing 768 без overlapping TopBar / double headers / visible navigator в compact.
- Compact drawers fully paint; нет clipped chevrons.
- Knowledge switch at 640 (или сразу при compact shell).
- Send/FAB tappable с клавиатурой.

**Verification:**

- Не принимать playground mobile frames как sign-off.
- Перепроверить четыре compact controls на ~390 и just-below-768.

### Задача 34. Combined error и empty states (stacked banners)

**SoT:** WebUI `ErrorScreen`; Electron `SessionLoadErrorScreen`; `TransportConnectionBanner`; `ToolchainStatusBanner`; `WorkspacePicker`; in-chat `connectionUnavailable` + `OmpCredentialStep`; `EntityListEmptyScreen`; `OverlayErrorBanner`; `login.html` `.error.visible`. `ReauthScreen` **исключён** unless a supported fixture/state transition reaches `appState=reauth` without source edits (сегодня: type + render branch only, `handleReauthLogin` placeholder).

**Prerequisite:** Намеренно комбинировать remote-fail + session load fail. Не считать playground TopBar overlap demo равным live SSH masking. Не требовать live ReauthScreen.

- [ ] **Шаг 1.** WebUI: kill WS после login → ErrorScreen Retry / Log out → `/login`. Не путать с SessionLoadErrorScreen.
- [ ] **Шаг 2.** Electron ready + failed session list → SessionLoadErrorScreen. Комбинировать с TransportConnectionBanner (reconnecting/connecting/failed-auth/failed-network/disconnected, SSH masking until `ssh.phase=ready`) и ToolchainStatusBanner. Banners над shell, TopBar offset ~48px, не кроют traffic lights.
- [ ] **Шаг 3.** WorkspacePicker loading → list | empty-create. **Не** ReauthScreen.
- [ ] **Шаг 4.** In-chat: `connectionUnavailable` disables send; OMP_* reuse compact `OmpCredentialStep`; EmptyStateHint на truly empty session.
- [ ] **Шаг 5.** EntityListEmptyScreen: sessions (none / archived / filters), sources, skills (`noSkillsConfigured`; omit emptyState если `ompSkills.length>0`), projects, automations. Skill/source notFound. BrowserEmptyStateCard. Knowledge idle/loading/empty.
- [ ] **Шаг 6.** Settings pageError + workspace `modeCyclingError`. OverlayErrorBanner вместе с transport banner.
- [ ] **Шаг 7.** `login.html` `authFailed` vs `networkError`; ru и en строки различны.

**Acceptance:**

- Нет двух full-screens одновременно (WebUI ErrorScreen, SessionLoadError, Onboarding). Reauth не в этом наборе.
- Empty copy специфична фильтру (archived ≠ filtered ≠ none-yet ≠ sources ≠ skills).
- `connectionUnavailable` и OMP credential — in-chat, не App gates.
- OverlayErrorBanner читаем при видимом TransportConnectionBanner.
- ThinkingCard absence after reload — **не** missing empty state.

**Verification:**

- Combine remote transport fail + session load fail в Electron; отдельно WebUI WS kill.
- Banner copy unit tests не этот pass. `/manifest*` 401 — pre-existing cosmetic, не visual P0.

### Задача 35. Exhaustive workbench / session-view / overlay visual sweep

**SoT:** `apps/electron/src/renderer` — `HomeFrontPage`, Omnibox, ModeBar, ActivityRail, SurfaceTabs, StatusBarHost, InspectorHost, `BrowserPanelPage`, Knowledge surface, `NotesPage`, Automations, Messaging pairing; session list/board/table filters; overlays Code/HTML/Image/JSON/Mermaid/PDF/DataTable/Terminal/Document. Feature gates: `apps/electron/src/renderer/atoms/unified-shell.ts` (unified shell, mode bar, top chrome, tab groups, browser surface, status bar default **off**); `platform/index.tsx` omits ActivityRail, SurfaceTabs, InspectorHost when those gates are off.

**Prerequisite:** Live Electron (Задача 20 preflight + launcher шаг 0), populated workspace, окно ≥768 unless a row is explicitly compact. **До любого exhaustive row:** включить unified-shell / workbench feature gates (Appearance/Workbench) и открыть Inspector; записать exact flag state. Playground catalog и listing overlay types в Задаче 31 SoT **не** coverage. Settings sweep (Задача 32) **не** покрывает эти surfaces. Clean disposable profile с defaults-off **не** достигает ActivityRail / SurfaceTabs / InspectorHost.

Каждый ряд — observable live pass (open, interact, screenshot/notes). Не skip без product-approved deferral record.

- [ ] **Шаг 0. Enable gates + open Inspector (до шагов 1–4):** Appearance/Workbench: включить unified shell, mode bar, top chrome, tab groups, browser surface, status bar. Открыть InspectorHost. Записать exact flag state (on/off per gate) вместе со screenshots/notes. Не начинать exhaustive rows на defaults-off profile.
- [ ] **Шаг 1. Session views/filters:** list, board, table (включая filter/empty vs populated). Normal session views, не только chat composer.
- [ ] **Шаг 2. Shell chrome:** `HomeFrontPage`; Omnibox (idle + overlay/results); ModeBar; ActivityRail; SurfaceTabs; StatusBarHost (включая overlay/status states); InspectorHost (open/closed).
- [ ] **Шаг 3. Routes:** `BrowserPanelPage`; `KnowledgeSurfacePage`; Notes (`NotesPage`); Automations; Messaging pairing dialogs.
- [ ] **Шаг 4. Overlays (каждый тип открыть live):** Code, HTML, Image, JSON, Mermaid, PDF, DataTable, Terminal, Document. Плюс ActivityCardsOverlay и MultiDiff из Задачи 31, если ещё не signed на live data.
- [ ] **Шаг 5.** Записать pass/fail per surface. Intentional deferral только с named product owner.

**Acceptance:**

- Evidence включает recorded unified-shell/workbench flag state **и** Inspector open **до** exhaustive sweep.
- Каждый enumerated surface имеет live observable step (opened, primary control visible, no blank panel).
- Overlay types each painted at least once (not merely listed).
- Omnibox / inspector / status overlay states exercised.
- Messaging pairing dialog reached.
- Нет silent skip. Defaults-off profile не принимается как coverage ActivityRail / SurfaceTabs / InspectorHost.

**Verification:**

- Live Electron, не playground. Notes/screenshots per row **plus** flag-state record from шаг 0. bun/SSR tests не visual proof.

---

## Порядок и зависимости (не переставлять в «сначала A–H»)

1. Задача 0 (read-only current-state preflight) **первая**. PR #5 open / merged / closed-unmerged → named current ship ref + reviewable path. Dated 2026-08-12 SHA/PR facts не current.
2. Задача 2 (Ticket-13 provenance + possible port **на current ship ref**) **строго до** Задачи 1. Задача 1 review-gate только против post-port tree; **не** certified merge.
3. Задача 6: implementation+test expiry/poll **на current ship ref до** visual waiting/error/success. Не наследует Wave 5 «onboarding VERIFIED (server-side)».
4. Задача 17 human port/discard **до** любого §5 remote delete; агенты delete не делают. PR #1–#4 (Задача 3) и 85+9 SAFE_TO_DELETE **исключены** из release completion (human handoff).
5. Identity M1–M6 (Задачи 10–15), R2/Cloudflare (Задача 4), release-engineering (Задача 29b) — human-blocked handoffs, не executable algorithms этого плана.
6. Knowledge surfaces blocked на provider contract — не follow-on к WS C navigator.
7. Shell GA зависит от real panel contributions, не от 14/14 playground.
8. CF/R2 CR не блокирует merge PR #5 / Задачу 28a. OAuth `errorDetail` — COMPLETE (existing test).
9. Functional OMP/transport/startup — явные bun paths + factory-dispatch от OMP `LlmConnection` через public connection factory; `validate:dev` не в цепочке.
10. Live OMP default: только Ticket-13 Allow на current ship ref с nonempty event/trace. Задача 28 RED→GREEN `live-turn-gate.ts` + negative tests empty file/directory/caller boolean. Full five-step только при named tree change.
11. Dev-loop: Задача 20 **launcher code** refuse foreign owners immediately before termination (или no-kill) **и** port/config/home preflight **до** `electron:dev`; renderer HMR не зависит от `electron:build`; never `git checkout --` для HMR; unsigned dist не RC.
12. Код Задач 6, 20 launcher, 23, 28 **на current ship ref** → Задача 28a финальный review/merge → Задача 29 packaging **только** от merged SHA; production-mode smoke готовит backend/session и доказывает deferred runtime inside artifact при `CRAFT_DEV_RUNTIME` absent; x64 host/Rosetta smoke **или** named exclusion.
13. Headless verification: token ≥16 и stop previous instance (или fresh config dir). First-run: disposable HOME+config; no credential entry unless `.env` cannot override.
14. Visual: Задача 35 **сначала** enable unified-shell/workbench gates + open Inspector + record flags, затем exhaustive workbench/session/overlay. Reauth исключён. Windows Git Bash: assigned host или BLOCKED.
15. Website владеет Connect/auth/cabinet/Neon.

---

## Исключения (повтор, чтобы не «схлопнуть в A–H merged»)

- Реимплементация A–H; reopen G1–G4 и remainder 1–4; tickets 08/16; `omp-agent.ts` `fcf4da70`; R3 denylist/`scrubOmpStderr`; R4 S1/S4/K3/E2/A2.
- Wave 5 VERIFIED rows кроме desktop onboarding UI и Ticket-13 ship-branch attribution. Полный пятишаговый real-OMP rerun без named tree change.
- OMP codes-as-strings; resume from OMP store; write-proposal tools; remount KnowledgeAgentPanel.
- «Починить» token≥16 или single-instance lock; stale matrix ⚠️/❌.
- Agent `git push --delete`; delete KEEP branches; re-port 62 `feature/pr-*`; считать PR #1–#4 или §5 cleanup частью этого релиза без human handoff.
- `electron:dist:dev:mac` / `CRAFT_DEV_RUNTIME=1` как RC; этот план как производитель RC.
- `validate:dev` или renderer unit tests как OMP / Electron-window / visual-regression evidence.
- Listing-only `factory.test.ts` или прямой `createBackend({ provider: 'omp' })` как proof connection-route `OmpAgent`; inlined `session-persistence.test.ts` как disk I/O.
- Preflight-only `lsof` как proof, что launcher не убивает чужой порт.
- `existsSync` / caller `verified: true` / empty file/directory как live-turn evidence без изменения `live-turn-gate.ts`.
- Packaging/QA against unmerged follow-up; packaging не от merged SHA Задачи 28a.
- Current-arch-only mac smoke как coverage x64 artifact без x64/Rosetta run или named exclusion.
- Задача 35 sweep на defaults-off unified-shell (ActivityRail/SurfaceTabs/InspectorHost unmounted).
- Применение Cloudflare/R2 lifecycle/delete из этого агентного плана; production share-data rewrites.
- Executable identity MIGRATE algorithms (M1–M6) без human-approved runbook review.
- Connect APIs внутри desktop repo; re-implement OAuth `errorDetail`.
- Live ReauthScreen без supported trigger; silent skip Windows Git Bash.
- `git checkout --` для HMR cleanup; shell override пинового `.env`.
- kimi-K3 403; `/manifest*` 401; root `tsc --noEmit` как remediation regression.
- Документировать `electron:dev:terminal` как supported workflow.
