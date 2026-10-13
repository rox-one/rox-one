# Plan 016: Гигиена dependency-алертов (vendored-скиллы, dependabot.yml, sharp-остатки)

> **Инструкции исполнителю**: шаги — по порядку; каждая проверка — команда + ожидаемый результат.
> При срабатывании «STOP conditions» — остановись и отчитайся.

> **Drift check (выполнить первым)**: `gh api 'repos/rox-one/rox-one/dependabot/alerts?state=open&per_page=100' --paginate --jq 'length'`.
> Если число алертов сильно отличается от 40 ИЛИ `.github/dependabot.yml` уже существует — сверь «Current state» с живым состоянием.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (пункты 1–3) / MED (пункт 4 — sharp)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a8d4dd3d2`, 2026-10-13

## Why this matters

Открытых Dependabot-алертов — **40** (3 critical, ~7 high, ~8 medium, 1 low), и почти все — в **вендоренных lockfile'ах скилл-паков** (`apps/electron/resources/skills/**`), которые приложение поставляет как данные и не исполняет в рантайме. Шум маскирует реальные проблемы (root `katex` low) и делает «зелёный security-таб» недостижимым. Дополнительно: в репо **нет `.github/dependabot.yml`** → плановых version-update PR нет вообще (работают только security-алерты). Наконец, есть непроверенные остатки по `sharp` (транзитивный 0.32.6 и root-пины `@img/sharp-*` 0.34.5), которые могут попадать в серверный бандл.

## Current state

- **Алерты (live, 2026-10-13)**: группировка —
  | Sev | Пакет | Манифест |
  |---|---|---|
  | critical | proxy-addr | `apps/electron/resources/skills/telegram/chiho-telegram/package-lock.json` |
  | critical | tinypool, vitest | `apps/electron/resources/skills/understand-anything/understand/plugin/pnpm-lock.yaml` |
  | high | @modelcontextprotocol/sdk | `…/telegram/chiho-telegram/package-lock.json` |
  | high | brace-expansion, browserslist, nanoid, postcss, source-map-js, vite | `…/understand-anything/…/pnpm-lock.yaml` |
  | high | source-map-js | `…/chiho-telegram/package-lock.json` |
  | low | katex | `package.json` (root) |
  | medium | @vitest/mocker, baseline-browser-mapping, brace-expansion, postcss, vite, vitest (×4 манифеста плагина) | `…/understand-anything/**` |
- **Dependabot-PR**: 0 открытых (2 смержены исторически, #1087/#1). `.github/dependabot.yml` отсутствует → version-updates выключены.
- **Остатки по sharp** (со снимка `docs/final-readiness/evidence/open-dependency-alerts.json` от 2026-10-02 + анализ; **требует перепроверки**):
  - транзитивный `sharp@0.32.6` через `@xenova/transformers@2.17.2` (`sharp: ^0.32.0` в его deps) — уязвим по GHSA-rgj7-g3m4-5g8c (< 0.35.4); путь: `packages/server-core/package.json:54` → lazy import `packages/server-core/src/memory/episodic-memory.ts:133`;
  - root `optionalDependencies` пиннят `@img/sharp-*@0.34.5` + libvips `1.2.4` (pre-patch libheif) рядом с 0.35.5/1.3.4;
  - `scripts/build-server.ts:424-446` копирует `@img/sharp-<plat>-<arch>` по top-level имени → может утащить старые либы в серверный бандл; `copyDependencyTree` обходит только `dependencies` (не optional).
- Electron и direct-sharp-алерты из снимка 10-02 **закрыты по версиям** (electron 44.7.0, sharp 0.35.5) — дублей среди 40 нет.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Список алертов | `gh api 'repos/rox-one/rox-one/dependabot/alerts?state=open&per_page=100' --paginate --jq '.[] \| "\(.security_advisory.severity) \(.dependency.package.name) \(.dependency.manifest_path)"'` | 40 строк |
| Дерево sharp | `cd packages/server-core && bun pm ls sharp` (или `rg -n '"sharp"' bun.lock \| head`) | видно 0.32.6 и/или 0.35.5 |
| Валидация dependabot.yml | `bun x js-yaml .github/dependabot.yml >/dev/null` (или python yaml) | exit 0 |

## Steps

### Step 1: Инвентаризация (не менять ничего)
1. Снять live-список алертов (см. Commands) и подтвердить, что **все** — из `apps/electron/resources/skills/**` (кроме katex в root).
2. Проверить, исполняются ли эти lockfile'ы нашими пайплайнами: `rg -n "resources/skills" .github/workflows scripts package.json | head` — ожидаемо: нет install-шагов по этим путям.
3. Проверить sharp-остатки: `bun pm ls sharp` в root/server-core; `rg -n '@xenova/transformers' packages/server-core/package.json`; `sed -n '420,450p' scripts/build-server.ts`.
**Verify**: выписаны 3 факта — (а) все 40 алертов в vendored path; (б) пайплайны их не ставят; (в) где резолвится sharp-0.32.6.

### Step 2: Политика для vendored-скиллов (решение + документ)
Создать `docs/security/dependency-alerts-policy.md` (новый файл): что такое vendored skill packs, почему их lockfile'ы не в контуре сборки/рантайма, и правило: security-алерты по `apps/electron/resources/**` — **dismiss с reason `not_affected`/`vulnerable_code_not_in_execute_path`** после проверки из Step 1, по каждому — ссылка на этот документ.
**Verify**: файл существует; в нём перечислены 3 critical с обоснованием.

### Step 3: Dismiss вендоренных алертов (по документу из Step 2)
Для каждого алерта из `apps/electron/resources/**`:
```
gh api -X PATCH repos/rox-one/rox-one/dependabot/alerts/<number> \
  -f state=dismissed -f dismissed_reason=not_affected \
  -f dismissed_comment='Vendored third-party skill pack lockfile; not installed or executed by Rox build/runtime. See docs/security/dependency-alerts-policy.md'
```
(katex — починить версией, не dismiss: пункт 4.)
**Verify**: `gh api '…?state=open' --jq 'length'` → остаются только реальные (ожидаемо: katex + возможные sharp).

### Step 4: Починить реальное
1. `katex`: обновить до исправленной версии (`bun update katex --latest` в нужном воркспейсе) → прогнать затронутые сьюты.
2. `sharp`: если Step 1 подтвердил 0.32.6 на runtime-пути — добавить в root `package.json` секцию `overrides: { "sharp": "^0.35.5" }` (или обновить `@xenova/transformers`), затем `bun install` и проверить `bun pm ls sharp` → одна версия 0.35.5.
3. Root `optionalDependencies` `@img/sharp-*` 0.34.5: либо поднять до линии 0.35.5, либо удалить, если они не нужны на рантайме (проверить `scripts/build-server.ts` и `stage-electron-native-deps.sh`).
**Verify**: `bun pm ls sharp` — одна линия; `bun run typecheck:all` exit 0; затронутые сьюты pass.

### Step 5: Включить плановые обновления
Создать `.github/dependabot.yml`: `npm` (bun) для `/`, `/apps/electron`, `/packages/*` (кроме vendored): weekly, group minor+patch, open-pull-requests-limit 5, ignore majors.
**Verify**: yaml валиден; `gh api repos/rox-one/rox-one/dependabot/alerts` не требует изменений; через сутки в PR-очереди появляются групповые апдейты (или ни одного, если всё свежее).

## Test plan

- katex/sharp-изменения: затронутые сьюты (`packages/server-core/src/memory/**`, рендер-сьюты, использующие katex).
- Никаких новых тестов не требуется; доказательство — `bun pm ls`, зелёные сьюты, пустой список open-алертов.

## Done criteria

- [ ] `gh api '…/dependabot/alerts?state=open'` → 0 или только явно задокументированные исключения.
- [ ] `docs/security/dependency-alerts-policy.md` существует и объясняет vendored-политику.
- [ ] `.github/dependabot.yml` существует, валиден, покрывает реальные манифесты.
- [ ] `bun.lock` резолвит `sharp` одной патченной линией; сборка сервера не тянет 0.34.5-либу.
- [ ] `bun run validate:ci` — без новых красных.

## STOP conditions

- Если выяснится, что vendored-lockfile'ы **действительно** ставятся/исполняются нашими пайплайнами → остановись, политика dismiss неверна.
- Если sharp 0.32→0.35 требует правок кода в `episodic-memory.ts` (смена API) → остановись и отчитайся (отдельный план).
- Если dismiss-API недоступен токену → остановись, оставь список готовых команд для владельца.

## Maintenance notes

- Политика vendored-алертов должна перепроверяться при каждом добавлении нового скилл-пака в `resources/skills`.
- Если у команды появится желание «нулевого шума» — следующий шаг: исключать `resources/**` из dependency graph (поддерживается GitHub для отдельных манифестов только через удаление lockfile; оценить перед применением).
