# Plan 015: Разобрать PR #1707 (UI/UX волны 1–3) на срезы и довести до main

> **Инструкции исполнителю**: следуй по шагам, после каждого — команда проверки с ожидаемым результатом.
> При срабатывании условий из «STOP conditions» — остановись и отчитайся, не импровизируй.
> Когда закончишь — обнови строку статуса этого плана в `advisor-plans/README.md`.

> **Drift check (выполнить первым)**: `git fetch -q origin && git log --oneline -1 origin/main`.
> Если main ушёл более чем на ~50 коммитов от `a8d4dd3d2` ИЛИ конфликтов в PR #1707 стало больше двух
> (кроме `perf-baselines/bundle-size.json` и `apps/electron/src/renderer/boot-manifest.json`) — сверь «Current state»
> с живым кодом и, при расхождении, считай это STOP-условием.

## Status

- **Priority**: P1
- **Effort**: L (3–5 дней на все срезы; каждый срез 0,5–1 день)
- **Risk**: MED
- **Depends on**: none (срез B пересекается с уже влитым #1817 — см. ниже)
- **Category**: tech-debt
- **Planned at**: commit `a8d4dd3d2`, 2026-10-13

## Why this matters

PR #1707 (`feat/intelligent-ui-20261009`, 21 коммит, **578 файлов, +20 360/−4 344**) — самый крупный висящий актив интерфейсной программы: волны G8+G9+G10 (хром/полировка), G1–G4/G6 (пилоты), G5 («Диалог»), G7 («Типографика и плотность 2.0»). Он открыт с 09.10, main с тех пор ушёл на 52+ коммита, PR в состоянии `DIRTY` и не ре-базится автоматически (`rebaseable=false`). При этом его содержимое на main **отсутствует** (проверено: `apps/electron/src/renderer/atoms/missions.ts` → 404 на main; шкала токенов — старая). Тащить одним куском нельзя: два ручных разрешения конфликтов уже было (21 и 12 файлов в `c2fadec`/`2eda1c9`), а собственный прогон PR даёт 2 587 passed / 83 failed (22 новых + 59 known-red). Цель плана — разложить 578 файлов на срезы, каждый из которых проходит гейты и откатывается одним ревертом.

## Current state

- Ветка PR: `feat/intelligent-ui-20261009` @ `f87f03f02` (забрать: `git fetch origin pull/1707/head:refs/remotes/pr/1707`).
- **Конфликты с текущим main — ровно два, оба генерируемые артефакты** (проверено `git merge-tree --write-tree --messages origin/main pr/1707`):
  - `perf-baselines/bundle-size.json` — пере-записывается командой `bun scripts/check-bundle-size.ts --update`;
  - `apps/electron/src/renderer/boot-manifest.json` — пере-записывается командой `bun run scripts/boot-manifest.ts` (без флагов: build + write; `--check` — только дифф).
  Оба файла не нужно «мержить» руками — их надо регенерировать на смерженном дереве.
- Состав волн по коммитам (shortstat из `git show --shortstat`):
  | Коммит | Содержимое | Файлов |
  |---|---|---|
  | `37da7801f` | G8+G9+G10 UI polish bundle (chrome ladder, AA-тиры, 28px floor) | — |
  | `458358997` | обновление playground-базлайнов + запись в DESIGN docs | 32 |
  | `06bf30a07` | пилоты G1 orbit / G2 aurora / G3 missions / G4 layout / G6 lanes (за флагами) | 58 |
  | `611b75f9e` | G5 «Диалог»: continuum, artifacts+approvals, composer deck | 83 |
  | `53c4c8db1` | G7 «Типографика и плотность 2.0» + завершение G4 «Студия» | 426 |
  | `09c931d18` | волна ревью G7/G4 (numeric-роль, дефолты плотности, глиф-метки, hero-таймер) | 40 |
  | `900e95089`, `fa1bcc93c` | фикстуры тестов (TooltipProvider, vite-config, node-builtin-стаб) | 2+8 |
  | `15cc66b78` | ratchet-литерал MeetingsPage + пере-запись бюджетов | 2 |
  | `c2fadec91`, `b2ee…` и др. | merge-коммиты main (в срезы не берутся) | — |
- Пересечения с main: **#1817 уже вынес токен-часть G7** (`fix/ui-lint-meetingspage-tokens`); `#1810/#1803` трогали `surface-keepalive`; i18n-локали (12 файлов) — зона постоянных конфликтов.
- Прочие контекстные файлы, которые main активно переписывает (кандидаты на конфликты): `apps/electron/src/renderer/App.tsx`, `packages/shared/src/i18n/locales/*.json`, `apps/electron/src/renderer/boot-manifest.json`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Забрать PR | `git fetch origin pull/1707/head:refs/remotes/pr/1707` | exit 0 |
| Конфликты | `git merge-tree --write-tree --messages origin/main pr/1707 \| grep CONFLICT` | 2 строки (generated-артефакты) |
| Install | `bun install` | exit 0 |
| Сборка рендера | `bun run electron:build:renderer` | dist/renderer собран |
| Бюджеты (пере-запись) | `bun scripts/check-bundle-size.ts --update` | perf-baselines обновлён |
| Манифест (пере-запись) | `bun run scripts/boot-manifest.ts` | boot-manifest.json обновлён |
| Гейт бюджета | `bun scripts/check-bundle-size.ts --check` | OK |
| Гейт манифеста | `bun run scripts/boot-manifest.ts --check --no-build` | up to date |
| Типы Electron | `bun run typecheck:electron` | exit 0 |
| CI-набор | `bun run validate:ci` | exit 0 |
| Целевые тесты | `bun test <paths>` | pass |

## Scope

**In scope**: только файлы из состава PR #1707 (см. таблицу волн) + два generated-артефакта.
**Out of scope**: `packages/server-core/**`, `apps/webui/**`, `apps/viewer/**` (в PR не меняются); любые правки правил/гейтов (см. plan 017 — отдельный трек).

## Git workflow

- На каждый срез — своя ветка от свежего `origin/main`: `slice/1707-<a|b|c|d>-<theme>`.
- Коммиты — conventional, как в репо (пример: `feat(ui): G7 «Типографика и плотность 2.0» + завершение G4 «Студия»`).
- Срезы вливаются по одному; PR #1707 закрывается только после последнего среза, со ссылками на все срезы.

## Steps

### Step 1: Подготовка и фиксация базовой линии
1. `git fetch origin pull/1707/head:refs/remotes/pr/1707`
2. Снять точный список конфликтов: `git merge-tree --write-tree --messages origin/main pr/1707 > /tmp/mt.out` — ожидаем ровно 2 CONFLICT (generated).
3. Зафиксировать число файлов по волнам: `git show --shortstat <commit>` для каждого коммита из таблицы.
**Verify**: в `/tmp/mt.out` ровно 2 CONFLICT, оба — `perf-baselines/bundle-size.json` и `apps/electron/src/renderer/boot-manifest.json`.

### Step 2: Срез A — G8+G9+G10 chrome/polish (+ baselines)
```
git switch -c slice/1707-a-chrome origin/main
git cherry-pick 37da7801f 458358997
# при конфликтах — см. «Как разрешать» ниже
bun install
bun run electron:build:renderer
bun scripts/check-bundle-size.ts --update && git add perf-baselines/bundle-size.json
bun run scripts/boot-manifest.ts && git add apps/electron/src/renderer/boot-manifest.json
bun run typecheck:electron
bun run validate:ci
```
**Verify**: `bun scripts/check-bundle-size.ts --check` → OK; `bun run scripts/boot-manifest.ts --check --no-build` → up to date; `validate:ci` exit 0.

### Step 3: Срез B — G7 типографика/плотность (+ ревью-волна)
Координация: токен-часть частично уже влита через #1817 — если cherry-pick `53c4c8db1`/`09c931d18` даёт конфликты в `eslint-baselines/ui-tokens.json` и `packages/ui`-токенах, бери версию main и переноси только отсутствующие токены.
```
git switch -c slice/1707-b-typography origin/main
git cherry-pick 53c4c8db1 09c931d18
bun install && bun run electron:build:renderer
bun scripts/check-bundle-size.ts --update && bun run scripts/boot-manifest.ts
bun run typecheck:electron && bun run validate:ci
bun test apps/electron/src/renderer/**  # затронутые сьюты; см. Test plan
```
**Verify**: гейты те же; визуальные базлайны обновлены в этом же срезе (`tests/visual/**`), иначе следующий PR снова их сдвинет.

### Step 4: Срез C — G5 «Диалог»
```
git switch -c slice/1707-c-dialog origin/main
git cherry-pick 611b75f9e
bun install && bun run electron:build:renderer
bun scripts/check-bundle-size.ts --update && bun run scripts/boot-manifest.ts
bun run typecheck:electron && bun run validate:ci
```
**Verify**: то же.

### Step 5: Срез D — пилоты G1–G4/G6 (за флагами)
```
git switch -c slice/1707-d-pilots origin/main
git cherry-pick 06bf30a07
bun install && bun run electron:build:renderer
bun scripts/check-bundle-size.ts --update && bun run scripts/boot-manifest.ts
bun run typecheck:electron && bun run validate:ci
```
**Verify**: то же; проверить, что новые флаги по умолчанию OFF и не ломают дефолтный рендер (визуальный прогон).

### Step 6: Закрытие PR #1707
После последнего влитого среза: закрыть #1707 со ссылками на все срезы и коммиты.
**Verify**: `gh pr view 1707 --json state` → CLOSED.

### Как разрешать конфликты (только эти два)
- `perf-baselines/bundle-size.json`, `apps/electron/src/renderer/boot-manifest.json`: **никогда** не мержить руками — взять любую сторону, затем пере-записать командой (`--update` / без флагов) на смерженном дереве и закоммитить результат.
- Любой другой конфликт — STOP (см. ниже).

## Test plan

- Новых тестов план не вводит; обязательны существующие гейты: `validate:ci`, `typecheck:electron`, `bun scripts/check-bundle-size.ts --check`, `bun run scripts/boot-manifest.ts --check --no-build`.
- Затронутые сьюты (по каталогам волн): `apps/electron/src/renderer/**/__tests__/*`, `packages/ui/src/**/__tests__/*`, `tests/visual/**` (обновление базлайнов — в срезе, меняющем вид).
- Перед PR каждого среза: `bun test <перечисленные каталоги>` → все pass; известная краснота — только из `scripts/test-baseline.json`.

## Done criteria

- [ ] main содержит содержимое #1707 (или явно отклонённые части зафиксированы в комментарии PR).
- [ ] PR #1707 закрыт со ссылками на срезы.
- [ ] `bun run validate:ci` на main — зелёный; `bun scripts/check-bundle-size.ts --check` — OK.
- [ ] UI Lint Ratchet зелёный (типографическая тема закрыта срезом B или #1817).
- [ ] Каждый срез — отдельный revertable merge-коммит в main.
- [ ] `advisor-plans/README.md` — статус плана обновлён.

## STOP conditions

- Конфликтов больше двух ИЛИ конфликтует любой не-generated файл → остановись и отчитайся (main мог переписать ту же зону).
- После cherry-pick срез не проходит гейт, и причина не в generated-артефактах (2 неудачные попытки чинить) → остановись.
- Визуальные базлайны требуют пересъёмки более чем на 20% снапшотов → остановись и согласуй.
- Срез требует правок вне `apps/electron/src/renderer/**`, `packages/ui/**`, `packages/shared/src/i18n/**`, `tests/visual/**` → остановись.

## Maintenance notes

- После срезов A/B main получит новую типографическую шкалу — следующие UI-волны должны ссылаться на неё, а не заводить свои литералы (`eslint-baselines/ui-tokens.json` — храповик).
- `boot-manifest.json` пере-записывается каждым срезом; если его churn мешает — см. plan 017 (B1: хранить только source-closure, а не хэши).
- Бюджеты (`perf-baselines/bundle-size.json`) пере-записываются в каждом срезе осознанно — это «приёмка роста» в рамках волны; вне волн рост остаётся красным (см. plan 017, A1/A2).
