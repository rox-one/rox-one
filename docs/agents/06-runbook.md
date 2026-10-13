# 06 — Ранбук: точные рецепты операций

Копипастабельные рецепты для репозитория `rox-one/rox-one`. Все команды проверены по
`package.json`, `.github/workflows/*`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/plans/lane-process.md`.
Гейт-имена `G0–G7` — из [`03-dod-gates.md`](./03-dod-gates.md); архетипы — в
[`05-archetypes.md`](./05-archetypes.md). Менеджер — **Bun 1.4.2**, hoisted linker (`bunfig.toml`).

---

## 1. Worktree (одна задача = одна ветка)

```bash
git -C /Users/t/Projects/rox-one fetch origin main
git -C /Users/t/Projects/rox-one worktree add ~/Projects/rox-worktrees/<slug> -b <branch> origin/main
cd ~/Projects/rox-worktrees/<slug> && bun install
```

Ветки: `feature/`, `fix/`, `refactor/`, `docs/` (`CONTRIBUTING.md`). Ветки выпуска — `release/desktop-*`.
Правило: **fetch → ветка от `origin/main` → install**. Не начинать от локального `main`, не пушить
в `main` напрямую (только PR; ruleset `24843533`: `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`/`freshness` strict).

---

## 2. Гейт-команды G0–G7

| Гейт | Команда | Что доказывает |
|---|---|---|
| G0 Recon | `git fetch` + worktree выше; чтение доков | база SHA, область, ownership, точка отката; нет недостающих прав |
| G1 Типы/сборка | `bun run typecheck:all` (+ per-package `tsc --noEmit`) | типы и сборка затронутого |
| G2 Тесты | `bun test <paths>` · `bun run test` (храповик) · i18n-гейты | затронутые наборы + нет новых регрессов; 12 локалей |
| G3 Ревью | субагент `code-review` | независимое чтение диффа |
| G4 Security | субагент `security-reviewer` | veto по auth/secrets/upload/callback |
| G5 Smoke | `electron:dev` / `webui:dev` / `viewer:dev` / `server:dev` | живая поверхность + скриншот с SHA |
| G6 Ship | `gh pr create` → `gh pr checks --watch` → `gh pr merge --merge` | merged; `freshness` strict |
| G7 Деплой+Live | каналы деплоя (§6 ниже) + живой smoke | выкатка + live-подтверждение |

**Типы (per-package):**
```bash
bun run typecheck:all                                        # корневой агрегат
cd packages/shared && bun run tsc --noEmit                    # один пакет
cd apps/electron && bun run typecheck                         # electron
bun run viewer:typecheck && bun run webui:typecheck           # viewer/webui
```

**Линт:**
```bash
bun run lint                    # eslint: ipc-sends, tool-name-checks, electron, shared, ui, rovers-strings
bun run lint:ui-tokens          # токены (baseline-храповик)
bun run lint:i18n:parity        # паритет 12 локалей
bun run lint:i18n:sorted        # ASCII-сортировка ключей
bun run lint:i18n:coverage      # покрытие ключей
bun run lint:i18n:budget        # бюджет ключей
```

**Тесты:**
```bash
bun test <path...>                                  # точечно (правило AGENTS.md)
bun run test                                        # агрегат: bun run scripts/test-all.ts (bounded-parallel)
bun scripts/test-all.ts --ratchet                   # храповик долга (ceiling)
bun scripts/test-all.ts --strict                    # любой красный = провал (игнор baseline)
bun scripts/test-all.ts --update-baseline           # обновить baseline (не поднимает ceiling)
bun run test:visual                                 # playwright visual
```

**Храповик (ratchet) — семантика.** `scripts/test-baseline.json` перечисляет уже красные на `main`
наборы; их падения **не** валят прогон — только **новые** падения (`newFailures`) и устаревшие
(`stalePass`) меняют код возврата. `knownRedCeiling` = **59**: рост `knownRed` выше потолка валит прогон,
`--update-baseline` **никогда не поднимает** ceiling, долг может только падать. Источник истины —
ночной Linux-раннер (`nightly-test-all.yml`, cron `0 3 * * *`); локальные macOS-прогоны могут видеть
свои «новые» — это среда, не баг (`lane-process.md` §7).

**Конвейер целиком:** `bun run validate:ci` = `validate:dev` + 4 i18n-гейта (см. `package.json`).

---

## 3. Smoke (живой прогон — называть точные скрипты)

```bash
bun run electron:dev            # десктоп dev (scripts/electron-dev.ts)
bun run webui:dev               # WebUI на 5175
bun run viewer:dev              # viewer на 5174
bun run server:dev              # сервер (CRAFT_DEBUG=true, порт 9100)
bun run server:dev:webui        # сервер + собранный WebUI
bun run electron:dist:dev:mac   # unsigned локальная сборка macOS
```

UI-гейт: скриншот + SHA ревизии (`docs/plans/lane-process.md` §3). Без живого ключа — статус
`BLOCKED` с именем секрета, не «зелёный мок».

---

## 4. PR + CI

Шаблон описания — в `CONTRIBUTING.md` (Summary / Changes / Testing / Screenshots); файла
`.github/pull_request_template.md` в репо нет — вставлять вручную.

```bash
gh pr create --base main --head <branch> --title "<title>" --body-file /tmp/pr-body.md
gh pr checks --watch                 # ждать проверки
gh pr view <N> --json mergeStateStatus,statusCheckRollup
```

Обязательная проверка — `freshness` (`main-freshness.yml`, runs-on `blacksmith-4vcpu-ubuntu-2404`,
~секунды) со **strict**: устаревшую ветку слить нельзя. Перед merge: `update-branch` + дождаться
`freshness`; `BEHIND`/`DIRTY` → **стоп**. Тяжёлые лейны: `ci.yml` (matrix ubuntu-24.04+macos-15, timeout 30 мин),
`validate-server.yml` (macos-15, timeout 45 мин), `native.yml` (часто cancelled).

---

## 5. Merge + rollback

```bash
gh pr merge <N> --merge              # merge-commit — совпадает с историей репо
```

История — merge-коммиты (`git log origin/main --merges --first-parent --format='%h %cI %s'`).

Откат (force запрещён — только revert/PR, `lane-process.md` §2):
```bash
git revert -m 1 <merge-sha>                 # откат одного слияния
git revert <old-sha>..<new-sha>             # диапазон (волна)
# либо вернуть main к зафиксированному SHA через PR (без force)
```

Точка отката фиксируется **до** волны: `ветка-срез @ <SHA>` + дата — в плане/PR.

---

## 6. Deploy (агент доводит до артефактов; production OPS — человеком)

**Каналы по поверхностям:**

| Поверхность | Канал | Статус агента |
|---|---|---|
| Desktop | `release/desktop-*` → `desktop-release.yml` (`bun scripts/desktop-release.ts`; матрица `macos-15` + `windows-2025`; артефакты `apps/electron/release/Rox-*`) → `publish-desktop-release.yml` (`workflow_dispatch` с `run-id` + `tag` → `scripts/publish-desktop-release.ts`) | собирает пайплайн; публикация — по пайплайну |
| Cloud-gateway | CircleCI job `craft-gateway-deploy` (`.circleci/config.yml`: подмена Dockerfile на `Dockerfile.omp` → `npx wrangler deploy`; env `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUD_RUNS_TOKEN`) | канал CI; вручную не воспроизводить |
| Сервер | `Dockerfile.server`: `bun run server:build:subprocess`, порт `9100`, `ROX_SERVER_TOKEN` ≥16 символов — иначе фатальный отказ на старте | локальная сборка/запуск = **G5 smoke**; канала деплоя в репо нет → **G7 = BLOCKED + OPS-чеклист** |
| WebUI | `bun run webui:build` → `apps/webui/dist` | то же: канала деплоя в репо нет → **G7 = BLOCKED + OPS-чеклист** |
| Viewer (Cloudflare Pages) | проект `craft-agents-viewer` (`apps/viewer/wrangler.toml`); деплой: `wrangler pages deploy apps/viewer/dist --project-name craft-agents-viewer` (нужен `CLOUDFLARE_API_TOKEN`) | OPS-человек; без токена **G7 = BLOCKED**. (`pages-worker:deploy` — это воркер `workers/pages`, не viewer.) |

Пример локального запуска сервера (для G5 smoke):

```bash
docker buildx build -f Dockerfile.server -t rox-server .
docker run --rm -p 9100:9100 --user $(id -u):$(id -g) -e HOME=/home/rox -e ROX_SERVER_TOKEN=$(openssl rand -hex 32) rox-server
```

> **Правило:** локальная сборка/запуск — это G5 smoke, **никогда не G7**.
> **HUMAN-ONLY:** production Cloudflare/R2/Pages, правила CF, очистка R2, релизные теги и подпись — агент их не выполняет, только перечисляет как чеклист (`plans/next-program-prompt.md`, «Запреты»).

---

## 7. Durable-раны (harness v2)

Бинарник: `~/.local/bin/harness` → `~/.agents/runtime/harnessctl.py`. Раны живут дольше сессии.

```bash
harness request "<objective>" --cwd "$PWD" --mode execute [--background]
harness request-retry <id> [--background]                 # повтор упавшего запроса
harness submit --file <plan.json> [--no-context]         # точный DAG (см. `04-subagents-skills.md` §7)
harness tasks [--id <id>]                                 # список/статус задач
harness cancel <id>                                       # отмена
harness project-bind [--session <s>] [--cwd "$PWD"]       # привязать проект
harness bind --session <s> --request <id>                 # связать сессию и запрос
harness skill-used <name> --evidence '<json>' [--session <s>] [--task <t>]
harness session --client <c> --native-id <id> [--cwd "$PWD"] [--title "<t>"]
harness status [--summary|--full] [--task <t>]
harness metrics {snapshot|baseline|compare}
```

`--mode` ∈ `{recommend,inspect,execute}`; `--allowed-operations` — список операций через запятую.
`--evidence` — JSON-объект (или `@file.json`) с `observed_result` и `artifact`/`source_event_id`.

---

## 8. Частые сбои и что делать

| Симптом | Действие |
|---|---|
| Конфликт `bun.lock` | **не мёржить руками**: `git checkout --theirs bun.lock && bun install && bun install --frozen-lockfile` (`CONTRIBUTING.md`) |
| CI падает на `bun install --frozen-lockfile` | битый `bun.lock` — перегенерировать тем же Bun 1.4.2 |
| `freshness` не стартует / очередь >30 мин | серийный train, `update-branch` только активной ветки; `--admin --merge` — last resort с фиксацией (`lane-process.md` §6) |
| Тяжёлый лейн «висит» (`validate-server`, `ci.yml` matrix, `native`) | ждать/перезапустить только упавший job; не пушить веерно |
| `knownRed` вырос | новый красный тест — чинить или карантин; ceiling поднимать нельзя |
| i18n-гейт красный | ключ во **все 12** локалей (`ar,de,en,es,fr,hu,ja,ko,pl,ru,zh-Hans,zh-Hant`), ASCII-сортировка; ru — дефолт |
| Ошибка «ветка отстала» при merge | `update-branch` → дождаться `freshness` → merge |
| Конфликт владения файлом | один писатель на область; сообщить владельцу, не править чужой срез |
| Тест красный только локально, зелёный в CI | ожидаемо (среда); при систематике — issue волны (`lane-process.md` §7) |

---

## 9. Эскалация BLOCKED (канонический формат)

Hard stops: (1) нет секрета/прав, (2) security veto, (3) необратимое уничтожение данных, (4) решение владельца (юр./продуктовое — @agisota; агент приносит ADR и останавливается на этом шаге).

Формат (ровно то, чего не хватает):

```
STATUS: BLOCKED
MISSING: <имя секрета | permission | access>   # напр. CLOUDFLARE_API_TOKEN, APPLE_ID, repo write
TRIED: <команда(ы), где упёрлось, exit/ошибка>
EVIDENCE: <SHA ревизии / путь к логу>
NEXT: <что сделает человек: выдать секрет / дать право / подтвердить действие>
UNBLOCKED-WORK: <что уже сделано и проверено без этого>
```

Не репортить успех без evidence; не «чинить» внешний сервис кодом; не выдавать mock за VERIFIED.
