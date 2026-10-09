# План 007: Убрать мёртвые `marketing:*`/`docs:*` скрипты из корневого `package.json`

> **Инструкции исполнителю**: ты — edit-only агент. Выполняй шаги по порядку, правь **только** файлы из раздела «Scope». Команды верификации в этом плане прогоняет оркестратор, а не ты; тебе не нужно запускать тесты/линт/форматтер и не нужно ничего коммитить/пушить. Если сработал любой пункт из «Границы и escape hatch» — остановись и отчитайся, не импровизируй.
>
> **Drift check (сначала)**: `git -C /Users/t/Projects/archive/rox-one-e01-wt diff --stat 3114264ee..HEAD -- package.json`
> Если `package.json` изменился с момента написания плана — сверь приведённый ниже фрагмент с живым файлом; при расхождении это STOP-условие.

## Шапка

- **Ревизия**: `3114264ee` (ветка `e01-decisions`, рабочее дерево `/Users/t/Projects/archive/rox-one-e01-wt`).
- **Находка**: TECH-02 (карточка `/tmp/improve-full.md:555-563`).
- **Impact**: низкий (npm-поверхность вводит в заблуждение; `bun run marketing:*`/`docs:*` падают на несуществующих путях). **Effort**: S. **Risk**: LOW. **Confidence**: HIGH.

## Почему это важно

Корневой `package.json` объявляет шесть скриптов, которые указывают на каталоги `apps/marketing` и `apps/docs-site`; этих каталогов в дереве **нет** (в `apps/` только `cli`, `cloud-gateway`, `electron`, `ios`, `modal-gateway`, `viewer`, `webui`, `workspace-service`). При этом `docs/repo-known-issues.md:7` уже заявляет, что эти скрипты «were removed (ticket 08)», а тикет-карточка `plans/next-program/tickets/08-webui-parity-hygiene.md:11` держит пункт приёмки `- [ ] marketing:* and docs:dev scripts removed`. То есть единственная задача здесь — **сделать код соответствующим доку**, удалив мёртвые скрипты. `apps/webui` их не заменяет: это отдельное приложение со своими скриптами (`webui:dev`/`webui:build`/`webui:typecheck` → `apps/webui/*`), которое существует и не имеет отношения к маркетингу/доксайту.

## Текущее состояние

Все факты проверены на `3114264ee`.

- `package.json` (корневой манифест; блок `"scripts"` начинается на `:24`). Мёртвые записи — строки `:124-129`, идут сразу после `"server:dev:webui"` (`:123`) и перед `"build"` (`:130`):

```json
    "marketing:dev": "vite dev --config apps/marketing/vite.config.ts",
    "marketing:build": "vite build --config apps/marketing/vite.config.ts",
    "marketing:preview": "vite preview --config apps/marketing/vite.config.ts",
    "docs:dev": "cd apps/docs-site && bun run dev",
    "docs:build": "cd apps/docs-site && bun run build",
    "docs:preview": "cd apps/docs-site && bun run preview",
```

- `apps/marketing` и `apps/docs-site` отсутствуют: `ls -d apps/marketing apps/docs-site` → оба «No such file or directory». Список `apps/`: `cli cloud-gateway electron ios modal-gateway viewer webui workspace-service`.
- Ни один живой потребитель не ссылается на эти скрипты. Единственные вхождения `marketing:*`/`docs:dev|build|preview` вне `package.json` — это документы трекеров/доков, не код и не CI:
  - `docs/repo-known-issues.md:7` — «`marketing:*` and `docs:dev` scripts … were removed (ticket 08)».
  - `plans/next-program/tickets/08-webui-parity-hygiene.md:11` — `- [ ] marketing:* and docs:dev scripts removed; CRAFT_WEBUI_PORT removed`.
  - `plans/next-program-spec.md:38`, `plans/integration-audit.md:68,424`, `plans/problem-inventory.md:441` — исторические аудит-записи.
  - В `.github/workflows/**`, `scripts/**`, `README*` ссылок на эти скрипты нет.
- `CRAFT_WEBUI_PORT` уже вычищен из кода (grep по репо: только упоминания в `plans/**` и `docs/repo-known-issues.md`). `workspaces` в `package.json:18-22` больше не содержит исключений `!apps/marketing`/`!apps/online-docs` — строка `docs/repo-known-issues.md:7` про них тоже уже верна.

### Что НЕ меняем (и почему)

- `docs/repo-known-issues.md` — **не трогать**: после удаления скриптов строка `:7` становится фактически верной сама собой, правка не нужна.
- `plans/next-program/tickets/08-webui-parity-hygiene.md` — **не трогать**: `plans/next-program/README.md:46` прямо фиксирует «Ticket bodies stay historical (`ready-for-agent`); this table is the status of record», а `:37` уже отмечает тикет 08 как shipped (`#16`). Правка чек-бокса исторической карточки неуместна.
- `plans/problem-inventory.md`, `plans/integration-audit.md`, `plans/next-program-spec.md` — исторические трекеры, вне scope.

## Scope

**In scope** (единственный файл, который ты правишь):

- `package.json` (корень) — удалить 6 строк скриптов `:124-129`.

**Out of scope** (не трогать, даже если выглядит связанным):

- Любые `docs/**` и `plans/**` (включая `docs/repo-known-issues.md` и тикет 08 — см. выше).
- `apps/webui/**` — другое приложение, к мёртвым скриптам отношения не имеет (не «заменяет» marketing).
- `bun.lock`, `tsconfig*`, любые другие манифесты.
- Форматирование/переупорядочивание остальных строк `package.json`.

## Executor steps (только правки файлов)

1. Открой `/Users/t/Projects/archive/rox-one-e01-wt/package.json`. В блоке `"scripts"` удали ровно шесть строк (`:124-129`):

   ```
       "marketing:dev": "vite dev --config apps/marketing/vite.config.ts",
       "marketing:build": "vite build --config apps/marketing/vite.config.ts",
       "marketing:preview": "vite preview --config apps/marketing/vite.config.ts",
       "docs:dev": "cd apps/docs-site && bun run dev",
       "docs:build": "cd apps/docs-site && bun run build",
       "docs:preview": "cd apps/docs-site && bun run preview",
   ```

   Ничего больше не меняй. Проверь, что запятая остаётся только у предыдущей записи `"server:dev:webui"` (её строку **не** изменяй) и что следующая запись — `"build": "bun run scripts/build.ts"` (тоже без изменений). Итоговый вид участка:

   ```json
       "server:dev:webui": "bun run server:build:subprocess && bun run webui:build && CRAFT_WEBUI_DIR=apps/webui/dist bun run server:dev",
       "build": "bun run scripts/build.ts",
   ```

   Больше в этом плане правок нет.

## Verification gates (оркестратор)

Все команды — с абсолютным cwd `/Users/t/Projects/archive/rox-one-e01-wt`.

1. JSON валиден + ключей нет:

   ```
   bun -e 'const p = JSON.parse(await Bun.file("package.json").text()); const dead = ["marketing:dev","marketing:build","marketing:preview","docs:dev","docs:build","docs:preview"].filter(k => k in p.scripts); if (dead.length) { console.error("DEAD STILL PRESENT:", dead); process.exit(1) } console.log("OK: package.json valid, no marketing/docs scripts")'
   ```
   Ожидаемо: `OK: package.json valid, no marketing/docs scripts`, exit 0.

2. Негативный grep — ни одного живого вхождения (остаются только трекерные доки):

   ```
   grep -rIn --exclude-dir=node_modules --exclude-dir=.git -E '\b(marketing|docs):(dev|build|preview)\b' . | grep -v '^./plans/' | grep -v '^./docs/repo-known-issues.md'
   ```
   Ожидаемо: **пустой вывод** (exit 1). Разрешённый остаток — только `plans/**` и `docs/repo-known-issues.md:7`.

3. Каталоги-цели по-прежнему отсутствуют (подтверждение, что удаление безопасно):

   ```
   ls -d apps/marketing apps/docs-site ; echo "exit=$?"
   ```
   Ожидаемо: два «No such file or directory», `exit=2` (ничего не появилось).

4. Диф ограничен одним файлом:

   ```
   git -C /Users/t/Projects/archive/rox-one-e01-wt status --short
   ```
   Ожидаемо: единственная модификация — `M package.json` (для плана 007). Никаких других изменённых/удалённых файлов.

## Test plan

Отдельные тесты **не нужны**, и это осознанно:

- Изменение чисто метаданных (`package.json`): удаляются записи, указывающие на несуществующие каталоги. Нет рантайм-поведения и нет шва для unit-теста — в репозитории нет и не должно быть теста «npm-поверхности» скриптов.
- Регрессионную защиту от повторного появления таких скриптов делать не нужно: это одноразовая гигиена (категория D-04 «честность дерева»), а S-плана достаточно машинно-проверяемых гейтов выше (grep + валидация JSON).
- Если ревьюер настаивает на гарде «скрипты не ссылаются на отсутствующие workspace-пути», это отдельная задача вне данного плана — не добавляй её здесь.

## Границы и escape hatch (STOP-условия)

Остановись и отчитайся, **не** импровизируя, если:

- Фрагмент `package.json:124-129` не совпадает с приведённым (дерево дрейфнуло с `3114264ee`).
- Loved-by-кода: обнаружен **живой** потребитель этих скриптов (ссылка в `.github/workflows/**`, `scripts/**` или `README*`), которого не было при написании плана.
- `apps/marketing` или `apps/docs-site` **существуют** (значит, скрипты не мёртвые — весь план неверен).
- Правка требует тронуть файл вне Scope (например, доки).

## Maintenance note

- После этого `package.json` соответствует `apps/` и строкам `docs/repo-known-issues.md:7`. Исторические записи в `plans/**` не переписываются — там `plans/next-program/README.md` уже служит «status of record».
- Ревьюеру проверить: удалены ровно 6 строк, JSON остался валидным, запятые вокруг `"server:dev:webui"`/`"build"` корректны, диф — только `package.json`.
- Если в будущем маркетинг/доксайт вернут как реальные приложения, скрипты добавляют заново вместе с каталогами — не «на всякий случай» заранее.