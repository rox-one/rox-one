# Plan 017: Укрепление guardrail-тулинга (bundle-size, boot-manifest, UI-001)

> **Инструкции исполнителю**: это набор небольших независимых фиксов; делай по одному, каждый — отдельный коммит
> с собственной проверкой. При «STOP conditions» — остановись и отчитайся. Тесты/гейты запускает исполнитель
> (или оркестратор) — в конце каждого шага команда указана.

> **Drift check (выполнить первым)**: `git log --oneline -1 origin/main` и открыть `scripts/check-bundle-size.ts`,
> `scripts/boot-manifest.ts`, `.github/workflows/{bundle-size,ui-001-recovery}.yml` — номера строк ниже сверять с живыми файлами.

## Status

- **Priority**: P1 (пункты 1–3) / P2 (остальное)
- **Effort**: M (суммарно; каждый пункт S–M)
- **Risk**: LOW (изолированные правки тулинга; поведение приложения не меняется)
- **Depends on**: none
- **Category**: dx / tests / tech-debt
- **Planned at**: commit `a8d4dd3d2`, 2026-10-13

## Why this matters

Три гейта (бюджеты бандла, boot-манифест, UI-001 recovery) — источник регулярного «флак-налога» и ручной работы: бюджеты пере-записываются на каждом merge волны (это буквально записанный процесс в `docs/specs/2026-10-09-*/IMPLEMENTATION-NOTES.md`), UI-001 отменяется на полуслове при churn main и падает на шагах, не связанных с поведением, boot-манифест коммитит 37k строк не-гейтящихся хэшей. Ниже — 14 проверяемых улучшений, отсортированных по приоритету; каждое самостоятельно и не требует соседних.

## Current state (файлы и факты)

- `scripts/check-bundle-size.ts` (772 стр.): гейтит **TOTAL** по каждому имени-префиксу (`:12-15`, `evaluateAssets :530-542`), slack `BUDGET_SLACK_BYTES=4096` (`:67`), пол `MIN_BUDGET_BYTES=250 000` (`:60,497`), потолок `MAX_NEW_CHUNK_BYTES=2 500 000` (`:53,518`), пере-запись `--update` (`:714-722`), ключ префикса = regex `HASH_SUFFIX = /-[A-Za-z0-9_-]{8}$/` (`:81,220-222`), чтение чанка молча глотает ошибку (`:260-262`).
- `scripts/boot-manifest.ts` (515 стр.) + `scripts/__tests__/boot-manifest.test.ts` (238): `normaliseSource` (`:375-383`) режет по **первому** якорю (`/src/` раньше `/apps/`,`/packages/`) → теряется пакетная идентичность; `chunkForModule` (`:170-185`) берёт lexicographic `hits[0]`; тест заморозил 15 route-id (`:132-173`) и `skipIf(!existsSync(DIST))` (`:177`); `diff.ok` игнорирует `bootChunks` (`:305-309`), а `apps/electron/src/renderer/boot-manifest.json` — 37 100 строк (59 bootChunks + 15 маршрутов с хэшами).
- `.github/workflows/bundle-size.yml` (79 стр.): `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` (`:45-47`), группа по `ref` без sha (`:46`); заголовок обещает «largest chunk», код гейтит TOTAL (`:2-4` vs `:12-15`).
- `.github/workflows/ui-001-recovery.yml` (196 стр.): `cancel-in-progress: true` и для main (`:24-26`); «source-hash gate» (`:50-99`) сравнивает рабочее дерево с блобами того же HEAD (тавтология) и включает в glob сгенерированный `boot-manifest.json` (`:65`); пост-шаги `if: always()` (`:172-185`).
- `docs/final-readiness/execution/cloud/OWNER-UI-001/rox-readiness-ui-001.navigation-browser.ts` (392 стр.): фикс. `{ timeout: 3500 }` (`:121,137,208,235,377,379`), rAF-тики (`:240,250,263,267`), глобальный `pageerror → assert.deepEqual(errors, [])` (`:104,389`), общий context/server/props между checks (`:55-63,94-101`).
- `scripts/__tests__/check-bundle-size.test.ts`: 9 кейсов спавнят `bun` (`Bun.spawnSync`) (`:98-106`).

## Steps (по приоритету; каждый — отдельный коммит)

### 1. (S) `normaliseSource` — не терять пакет
`scripts/boot-manifest.ts:375-383`: анкорить по первому вхождению `/apps/`|`/packages/`|`/node_modules/` относительно корня репо (repo-relative), а не по `/src/`; добавить `assert` уникальности нормализованных имён в наборе.
**Verify**: `bun run scripts/boot-manifest.ts --check --no-build` → отчёт покажет изменившиеся записи (ожидаемо: часть `bootSources` получит префиксы `apps/`/`packages/`); пере-записать манифест и убедиться, что `bun test scripts/__tests__/boot-manifest.test.ts` зелёный (7/0).

### 2. (S–M) boot-manifest.json — не коммитить 37k строк хэшей
Оставить в committed-файле только: `entry`?нет → **`bootSources`, `routes[id].sources`, набор route-id**; хэши (`entry`, `bootChunks`, `chunks`, `chunk`) — в git-ignored debug-файл (`*.local.json`) или не хранить; `--check` сверяет по source-closure (уже есть `diff.ok`).
**Verify**: `git diff --stat apps/electron/src/renderer/boot-manifest.json` после обычной правки рендера → строки не меняются; `bun run scripts/boot-manifest.ts --check --no-build` → up to date.

### 3. (S) Семантика отмен и групп в workflow
- `bundle-size.yml`: `cancel-in-progress: true` и для main; в `group` добавить `${{ github.sha }}` для push — старые main-раны не копятся, текущий не режется чужим.
- `ui-001-recovery.yml`: пост-шаги (`Confirm …`, upload) перевести на `if: always() && !cancelled()`; upload — только при `success()`.
**Verify**: `bun x js-yaml .github/workflows/bundle-size.yml >/dev/null && bun x js-yaml .github/workflows/ui-001-recovery.yml >/dev/null`; PR-прогон: при двух пушах подряд старый run отменяется, новый идёт до конца; на main артефакт не появляется у отменённого run.

### 4. (S) UI-001 source-hash gate — исключить generated-артефакты
`ui-001-recovery.yml:65`: убрать `apps/electron/src/renderer/boot-manifest.json` из glob (или все `*generated*`/`boot-manifest.json`); сам шаг сделать информационным (report), если менялся только generated-файл.
**Verify**: прогон с намеренной пере-записью boot-manifest → job зелёный; с правкой реального исходника → шаг по-прежнему красный при расхождении.

### 5. (S) Бюджеты: selective-accept + provenance + пропорциональный slack
- `--update --prefix=<p1,p2>` (принимает только указанные префиксы; остальные — как раньше);
- записывать `recordedAt`/`source` в `perf-baselines/bundle-size.json`;
- totals-slack: `max(4096, round(0.05% от total))`.
**Verify**: `bun scripts/check-bundle-size.ts --update --prefix=index` меняет только указанный префикс (`git diff perf-baselines/bundle-size.json`); юнит-тесты `scripts/__tests__/check-bundle-size.test.ts` pass (обновить 9 CLI-кейсов под новый флаг).

### 6. (S) boot-manifest-тест: не скипать молча; set-семантика route-id
- `boot-manifest.test.ts:177`: при `process.env.CI` и отсутствии `dist/renderer` — **fail** с понятным сообщением (вместо skip); локально — skip допустим.
- `:132-173`: сверять **набор** route-id с `readRouteModules()`/`parseStringArray`, не с замороженным литеральным списком+порядком.
**Verify**: `CI=true bun test scripts/__tests__/boot-manifest.test.ts` без сборки → красный с текстом «build renderer first»; со сборкой → зелёный.

### 7. (S) Мелкие: комментарий workflow, mtime→hash, проглоченный ENOENT, `--no-build` в run-gates
- `bundle-size.yml:2-4` — привести описание в соответствие коду (TOTAL по префиксам + startup-секция).
- `boot-manifest.ts:443-447` — staleness по контентному хэшу входов, не по mtime.
- `check-bundle-size.ts:260-262` — ENOENT после `readdirSync` → hard-fail (не пропускать чанк).
- `docs/openclaw-port/tools/run-gates.sh:84` — добавить `--no-build` к `--check`.
**Verify**: точечные юниты + `bash docs/openclaw-port/tools/run-gates.sh` не собирает рендер как сайд-эффект.

### 8. (M, опционально) Флейки UI-001
- `navigation-browser.ts` — заменить фикс. `timeout: 3500` на предикатные wait'ы с retry-budget; убрать rAF-тики, где есть предикат (`:121,137,208,235,240,250,263,267,377,379`).
- Привязать `pageerror` к активному `check()` (`:104,389`) + allowlist для известных доброкачественных.
**Verify**: `bun docs/final-readiness/execution/cloud/OWNER-UI-001/……navigation-browser.ts` → 17/17; 3 прогона подряд под нагрузкой — одинаковый результат.

### 9. (M, опционально) Префикс-ключ из Rollup-манифеста
`vite.config.ts` → `build.manifest: true`; `check-bundle-size.ts` — брать имя префикса из `.vite/manifest.json` (`name`/`src`), а не regex `-[A-Za-z0-9_-]{8}$`.
**Verify**: пере-запись бюджетов не меняет ключи при смене длины хэша (эмулировать правкой `chunkFileNames`); тесты pass.

## Test plan

- `scripts/__tests__/check-bundle-size.test.ts`, `scripts/__tests__/boot-manifest.test.ts` — обновлять вместе с правками (они и есть контрактные тесты).
- Прогон: `bun test scripts/__tests__/` → все pass; для пунктов 3/4 — живой прогон workflow на PR.

## Done criteria

- [ ] Пункты 1–7 влиты; 8–9 — по решению исполнителя.
- [ ] `bun scripts/check-bundle-size.ts --check` и `bun run scripts/boot-manifest.ts --check --no-build` — зелёные.
- [ ] `bun test scripts/__tests__/boot-manifest.test.ts` → 7 pass / 0 fail; `check-bundle-size`-тесты pass.
- [ ] Ни один пункт не меняет поведение приложения (только тулинг/CI).
- [ ] `advisor-plans/README.md` — статус обновлён.

## STOP conditions

- Пункт 2 меняет контракт `boot-manifest.json`, который читает рантайм (проверить `rg -n "boot-manifest.json" apps/ packages/`) → согласовать формат до правок.
- Пункт 5 ломает существующие 9 CLI-кейсов иначе как обновлением теста → остановись и отчитайся.
- Любая правка требует менять гейт-пороги «вниз» (ослабить) → это STOP: цель обратная.

## Maintenance notes

- После пункта 2 любая волна UI перестаёт двигать 37k-строчный файл — если ревьюеры всё же видят его в диффах, значит где-то остался хэш-контент.
- После пункта 5 «приёмка роста бюджета» становится осознанной и узкой (`--prefix`); в ревью PR ожидать объяснение в теле, а не «пере-записал всё».
