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
| W2 | Интеграция: `sort-locales`, `typecheck:all`, фокусные тесты, вендоренный probe, `electron:dev` smoke + скриншот, коммит, PR | lead | та же | ⏳ |
| W3 | Ревью: независимый `reviewer` (G3) + `security-reviewer` (G4; каналы/токен/запуск процессов) | reviewer, security-reviewer | PR | ⏳ |
| W4 | Ship: `gh pr checks --watch` → `gh pr merge --merge` (G6); G7 — desktop-релиз, human-checklist | lead | main | ⏳ |

## W1 — пакеты диспатча

| # | Исполнитель | objective | owned_paths | acceptance | verify | depends_on |
|---|---|---|---|---|---|---|
| 1 | E-main | Main-рантайм сайдкара + IPC + вендор-снапшот + stop-хук | `apps/electron/resources/cookbooks/**`, `apps/electron/src/shared/cookbooks.ts`, `apps/electron/src/main/{cookbooks-runtime.ts,cookbooks-view.ts,index.ts,handlers/{cookbooks.ts,index.ts}}`, `apps/electron/src/shared/types.ts`, `packages/shared/src/protocol/{channels.ts,routing.ts}`, `apps/electron/src/transport/channel-map.ts`, `apps/electron/resources/AGENTS.md`, `apps/electron/electron-builder.yml`, `apps/electron/src/main/__tests__/cookbooks-*.test.ts` | SPEC §Testing 1–2 зелёные (RED-сначала) | `bun test apps/electron/src/main/__tests__/cookbooks-runtime.test.ts`; `python3 .../electron_handshake_probe.py` | — |
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
| 2026-10-14 | W1 диспатч (E-main, E-ui, E-i18n) | — | ⏳ |
