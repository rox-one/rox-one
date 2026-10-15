# PLAN: программа `cookbooks-surface` — волны, владение, гейты

Нормативные документы: [PRD](PRD.md) · [SPEC](SPEC.md) · [ADR 001](decisions/001-runtime-container-and-secrets.md)

## Точка отката

- **Ветка-срез:** `feature/cookbooks-surface` @ `c743d3ee1` (origin/main на 2026-10-14Z)
- **Действие отката:** `git revert -m 1 <merge-sha>` (force запрещён ruleset `24843533`)
- **Что остаётся при откате:** данные `<configDir>/cookbooks/workspace/**` (личные копии) — не удаляются; миграций нет.

## Волны

| Волна | Содержание | Роли | Ветка/воркдерево | Статус |
|---|---|---|---|---|
| W1 | Параллельные писатели: E-main (рантайм+IPC+вендор), E-ui (renderer+флаг), E-i18n (12 локалей) | 3 × `task` | `feature/cookbooks-surface` (одно дерево; владение файлами разведено — SPEC §File map) | ⏳ |
| W1b (Amendment 1) | Нативный UI: удаление view-слоя (E-main2), нативная страница (E-ui2), 36×12 ключей (E-i18n2); фиксы ревью: run-all code-only, заголовок вкладки, клиентские таймауты, синхронизация docs | 3 × `task` | та же | ✅ / ⏳ фиксы ревью |
| W2 | Интеграция: `sort-locales`, `typecheck:all`, фокусные тесты, вендоренный probe, `electron:dev` smoke + скриншот, коммит, PR | lead | та же | ⏳ |
| W3 | Ревью: независимый `reviewer` (G3) + `security-reviewer` (G4; каналы/токен/запуск процессов) | reviewer, security-reviewer | PR | ⏳ |
| W4 | Ship: `gh pr checks --watch` → `gh pr merge --merge` (G6); G7 — desktop-релиз, human-checklist | lead | main | ⏳ |

## W1 — пакеты диспатча

| # | Исполнитель | objective | owned_paths | acceptance | verify | depends_on |
|---|---|---|---|---|---|---|
| 1 | E-main | Main-рантайм сайдкара + IPC + вендор-снапшот + stop-хук | `apps/electron/resources/cookbooks/**`, `apps/electron/src/shared/cookbooks.ts`, `apps/electron/src/main/{cookbooks-runtime.ts,index.ts,handlers/{cookbooks.ts,index.ts}}`, `apps/electron/src/shared/types.ts`, `packages/shared/src/protocol/{channels.ts,routing.ts}`, `apps/electron/src/transport/channel-map.ts`, `apps/electron/resources/AGENTS.md`, `apps/electron/electron-builder.yml`, `apps/electron/src/main/__tests__/cookbooks-*.test.ts` | SPEC §Testing 1–2 зелёные (RED-сначала) | `bun test apps/electron/src/main/__tests__/cookbooks-runtime.test.ts`; `python3 .../electron_handshake_probe.py` | — |
| 2 | E-ui | Renderer-поверхность `cookbooks` + флаг + страница + тесты | `apps/electron/src/shared/{routes.ts,route-parser.ts}`, `apps/electron/src/renderer/{components/app-shell/{route-pages.ts,MainContentPanel.tsx,primary-nav.ts},atoms/panel-stack.ts,platform/{SurfaceTabs.tsx,glyphs.ts},pages/cookbooks/**}`, `packages/core/src/platform/workbench/flags.ts`, `apps/electron/resources/release-notes/next.md` | SPEC §Testing 3–4 зелёные (RED-сначала) | `bun test apps/electron/src/shared/__tests__/route-parser-cookbooks.test.ts apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx` | интерфейс из `@/shared/cookbooks` (создаёт E-main первым артефактом) |
| 3 | E-i18n | 10 ключей × 12 локалей | `packages/shared/src/i18n/locales/*.json` | все 12 файлов валидный JSON, ключи ASCII-сортированы | `bun scripts/sort-locales.ts --check` | — |

**Правила волны:** исполнители не коммитят, полные гейты не гоняют (только свои фокусные тесты); `bun` — по абсолютному пути `/opt/homebrew/bin/bun`; python — `/usr/bin/python3`. Файлы соседей не трогать.

## W2 — чек-лист интеграции (lead)

1. `bun scripts/sort-locales.ts` (форматтер один раз, после всех писателей).
2. `bun test <все новые тесты>` + затронутые соседние наборы.
3. `bun run typecheck:all` (полный агрегат — общий гейт G1).
4. `bun run lint:i18n:parity && lint:i18n:sorted && lint:i18n:coverage && lint:i18n:budget` (G2).
5. `bun run lint:css` + `lint:ui-tokens` (точечно затронутое).
6. Вендоренный probe: `python3 apps/electron/resources/cookbooks/scripts/electron_handshake_probe.py` → `[SUMMARY] 0 failed`.
7. G5: `electron:dev` → скриншот «Кукбуки» с каталогом; quit → нет `serve_lab.py` в процессах.
8. Коммит(ы) с phase-именем, push, PR по шаблону CONTRIBUTING; `gh` — `/opt/homebrew/bin/gh`.
9. В PR: RED evidence, гейт-таблица, скриншот, rollback-точка.

## W3 — ревью

- `reviewer` (G3): свежий контекст, acceptance + артефакты PR; true source — код дерева; вердикт с пунктами.
- `security-reviewer` (G4): IPC-классификация, токен-изоляция, навигационная политика вида, спавн без секретов, редакция логов.

## W4 — ship

`gh pr checks --watch` → `freshness` (strict) → `gh pr merge --merge`. G7: desktop-релиз — пайплайном `release/desktop-*`/`desktop-release.yml` (публикация — OPS-человек; в отчёте — human-checklist).

## Статус-журнал

| Дата (Z) | Событие | SHA | Статус |
|---|---|---|---|
| 2026-10-14 | Recon A–E (5 скаутов), PRD/SPEC/ADR записаны | `c743d3ee1` | ✅ |
| 2026-10-14 | W1 диспатч (E-main, E-ui, E-i18n) | — | ✅ |
| 2026-10-14 | W1b (Amendment 1: нативный UI) + фиксы ревью G3/G4 | `8134bcff3` | ✅ |
| 2026-10-14 | W2–W4: интеграция, повторные гейты, G3 принято (ре-ревью), G4 без блокеров, merge PR #1956 | merge `964b2d9e` | ✅ влито в main |
| 2026-10-14 | W7 «Colab-UX» (PR #1972): R1–R7 + фиксы ревью (ссылки через usePlatform, numeric) | `4de92ad66` | ✅ |
| 2026-10-14 | W7 merge PR #1972 | merge `24147e9f8` | ✅ влито в main |
| 2026-10-14 | W8 «Срез 2» (PR #2010): секретный мост (креды → ядро, in-memory) + Colab-микро; фиксы ревью (пустой стор→рестарт, ред-регистр stderr, наблюдаемость, гвард P3) | `2d4e9ac0d` | ✅ |
| 2026-10-14 | W8 merge PR #2010 | merge `074b820f` | ✅ влито в main |
| 2026-10-14 | W9 «Colab Controls & Navigation» (PR #2027): стоп/Esc, оглавление, выше/ниже, `\r`, копия исходника, экспорт `.ipynb`; sidecar `/cancel`, CBK-01, dev:isolated; фиксы G3/G4 | `4c0959082` | ✅ |
| 2026-10-14 | W9 merge PR #2027 | merge `475034b4` | ✅ влито в main |
| 2026-10-14 | W10 «Cell Structure» (PR #2050): структурные операции ячеек + hover-«+»/«⋯»/Ctrl+M; sidecar `/cells/*`, run-guard 409, `_document_lock`; IPC `mutate`; фиксы G3/G4 | `a5de9a58c` | ✅ |
| 2026-10-14 | W10 merge PR #2050 | merge `2b18fe4f` | ✅ влито в main |
| 2026-10-14 | W11 «Rich Output & Persistence» (PR #2073): display_data end-to-end (display/хвост/matplotlib), персист выводов + execution_count, CSP-iframe, транспорт-бюджеты; фиксы G3/G4 | `8321dc035` | ✅ |
| 2026-10-14 | W11 merge PR #2073 | merge `cb707f2b` | ✅ влито в main |
| 2026-10-15 | W12 «Rox R1 Max defaults» (PR #2093): общий ROX-ключ в клиенте (gen-rox-defaults + installRoxDefaults, CI-секрет), `api.rox.one/v1` в ядрах кукбуков (lab defaultEnv + credential-only redaction), вендор-ресинк; фикс G3 (P2 redaction, P3 доки) | `2d59d871f` | ✅ |
| 2026-10-15 | W12 merge PR #2093 | merge `52d427a22` | ✅ влито в main |
| 2026-10-15 | W13 «Colab Convenience & Informativity» (PR #2127): командный режим, поиск/замена, автосейв+индикатор, статус-бар, длительности, scroll-spy, «Перезапустить и выполнить», md-микро, конвертация ячеек; + fix AppShellProvider, re-record bundle-size | `f1352a97c` | ✅ |
| 2026-10-15 | W13 merge PR #2127 | merge `3fcb612d4` | ✅ влито в main |
| 2026-10-15 | W14 «Cell Manipulation & Focus» (PR #2165): DnD-перестановка ячеек, мультивыделение + ячеечный буфер (copy/cut/paste), undo/redo структурных операций (Shift+Tab — takeover реестра), fold, меню «Скачать» (.ipynb/.py), Alt+Enter, Tab-индент, прогресс batch, latex-вывод, нумерация оглавления; + re-record bundle-size | `cd7f26803` + `d2519b5ac` | ✅ |
| 2026-10-15 | W14 merge PR #2165 | merge `f56d3e747` | ✅ влито в main |
