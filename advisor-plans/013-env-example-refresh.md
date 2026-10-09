# План 013: Переработать корневой `.env.example` под реальный контур Rox

> **Инструкции исполнителю**: ты — edit-only агент. Выполняй шаги по порядку, правь **только** файлы из раздела «Scope». Команды верификации в этом плане прогоняет оркестратор, а не ты; тебе не нужно запускать тесты/линт/форматтер и не нужно ничего коммитить/пушить. Если сработал любой пункт из «Границы и escape hatch» — остановись и отчитайся, не импровизируй.
>
> **Drift check (сначала)**: `git -C /Users/t/Projects/archive/rox-one-e01-wt diff --stat 3114264ee..HEAD -- .env.example scripts/electron-build-main.ts`
> Если любой из этих файлов изменился с момента написания плана — сверь приведённые ниже фрагменты с живым файлом; при расхождении это STOP-условие.

## Шапка

- **Ревизия**: `3114264ee` (ветка `e01-decisions`, рабочее дерево `/Users/t/Projects/archive/rox-one-e01-wt`).
- **Находка**: DOC-02 (карточка `/tmp/improve-full.md:666-672`).
- **Impact**: низкий (первый шаг новичка ведёт к мёртвому доку и выдуманным «required»-переменным). **Effort**: S. **Risk**: LOW. **Confidence**: HIGH.

## Почему это важно

Корневой `.env.example` — отслеживаемый git-файл (не в `.gitignore`, проверено: `git check-ignore .env.example` → exit 1) и он публичен. Его содержимое описывает контур **pre-Rox / Craft**: обязательный Anthropic-ключ, MCP-сервер Craft и `CRAFT_MCP_TOKEN`, ссылку на несуществующий `README_FOR_OSS.md` и callback-хост `thecraftagents.com`. При этом `CRAFT_MCP_URL`/`CRAFT_MCP_TOKEN` **не читаются ни одним файлом кода** (0 совпадений вне самого `.env.example`), `README_FOR_OSS.md` в дереве отсутствует, а из всего блока реально живёт только `SENTRY_ELECTRON_INGEST_URL`. Файл заявляет «Required» там, где ничего не требуется, и молчит про OAuth-переменные, которые dev- и build-скрипты действительно читают. Задача — привести `.env.example` в соответствие с тем, что реально читает код, оставив **только плейсхолдеры без значений**.

## Текущее состояние

Все факты проверены на `3114264ee`.

### Файл-цель (корень)

- `.env.example` — 32 строки, отслеживается git, не игнорируется. Мёртвые части (verbatim):

```
# Required: Anthropic API Key for Claude
ANTHROPIC_API_KEY=sk-ant-...

# Required: Craft MCP Server URL
# Format: http://localhost:3000/v1/links/{secretLinkId}/mcp
CRAFT_MCP_URL=http://localhost:3000/v1/links/YOUR_SECRET_LINK_ID/mcp

# Required: Bearer token for MCP authentication
CRAFT_MCP_TOKEN=your-bearer-token-here
```

```
# See README_FOR_OSS.md for setup instructions.          ← .env.example:14, файла нет
# (register https://thecraftagents.com/auth/callback as an authorized redirect URI)   ← .env.example:16
```

- Доказательства «мёртвости»:
  - `grep -rn "CRAFT_MCP" .` (без `node_modules`/`.git`) → **только** `.env.example:6`, `.env.example:9`. В коде — 0.
  - `ls README_FOR_OSS.md` → «No such file or directory». Второе вхождение строки `README_FOR_OSS` — в комментарии `scripts/electron-build-main.ts:67` (см. ниже).
  - `SENTRY_ELECTRON_INGEST_URL` — живой: `apps/electron/src/main/index.ts:37` (`dsn: process.env.SENTRY_ELECTRON_INGEST_URL,`) и `:42` (`enabled: !!process.env.SENTRY_ELECTRON_INGEST_URL,`); также в build-defines `scripts/electron-build-main.ts:74`.

### Что реально читается кодом (живой контур)

Корневой `.env` грузится `scripts/electron-dev.ts:101-122` (`loadEnvFile()` читает `<root>/.env` в `process.env`), а build-defines задаёт `scripts/electron-build-main.ts` (`getBuildDefines()`, `:68-82`). Читатели переменных (проверено grep'ом по `scripts`, `apps/electron/src/main`, `packages/*/src`):

| Переменная | Читатель (file:line) | Обязательна? |
|---|---|---|
| `SENTRY_ELECTRON_INGEST_URL` | `apps/electron/src/main/index.ts:37,42`; build-define `scripts/electron-build-main.ts:74` | нет |
| `ANTHROPIC_API_KEY` | `packages/shared/src/agent/backend/internal/drivers/anthropic.ts:136` | нет |
| `ROX_API_KEY` | `packages/shared/src/config/storage.ts:3935` (сид ключа дефолтного LLM-соединения) | нет |
| `GOOGLE_OAUTH_CLIENT_ID` | `packages/shared/src/auth/google-oauth.ts:29` (fallback) | нет |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `packages/shared/src/auth/google-oauth.ts:30` (fallback) | нет |
| `SLACK_OAUTH_CLIENT_ID` | `packages/shared/src/auth/slack-oauth.ts:27` | нет |
| `SLACK_OAUTH_CLIENT_SECRET` | `packages/shared/src/auth/slack-oauth.ts:28`; `apps/electron/src/main/extension-host/protocol.ts` | нет |
| `MICROSOFT_OAUTH_CLIENT_ID` | `packages/shared/src/auth/microsoft-oauth.ts:32` | нет |

`scripts/electron-dev.ts:272-279` (`getOAuthDefines()`) и `scripts/electron-build-main.ts:69-76` (`getBuildDefines()`: `definedVars`) перечисляют дополнительно `MICROSOFT_OAUTH_CLIENT_SECRET`, но **рантайм-читателя у него нет**: Microsoft-флоу — чистый PKCE (`microsoft-oauth.ts:30` «no client_secret needed for public clients»), и ни один `.ts` вне этих двух скриптов его не читает. Поэтому в честный файл он **не попадает** (см. «Почему это важно» и Maintenance note).

### Второй файл с тем же призраком

`scripts/electron-build-main.ts:66-67`:

```ts
// NOTE: Google OAuth credentials are NOT baked into the build - users provide their own
// via source config. See README_FOR_OSS.md for setup instructions.
```

`README_FOR_OSS.md` не существует — это тот же мёртвый указатель, что и в `.env.example:14`.

### Бэкенд-ключи сервисов — НЕ сюда

`DEEPGRAM_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `BRAVE_API_KEY`, `E2B_API_KEY`, `TAVILY_API_KEY` читает бэкенд из `<config-dir>/service-secrets.env` (переопределение `ROX_SERVICE_SECRETS_FILE`), см. `packages/shared/src/config/server-services.ts:3-12` и `docs/development/default-service-connections.md` («The backend reads … from its environment, or from `ROX_SERVICE_SECRETS_FILE`… Do not include this file in desktop bundles, Git, source configs or renderer state»). В публичный `.env.example` они попадать не должны — только комментарий-указатель.

## Scope

**In scope** (единственные файлы, которые ты правишь):

- `.env.example` (корень) — полностью заменить содержимое на целевой файл из шага 1.
- `scripts/electron-build-main.ts` — заменить только строку комментария `:67` (шаг 2).

**Out of scope** (не трогать, даже если выглядит связанным):

- `services/rox-maild/.env.example` — отдельный сервис, своя контурная конфигурация (явно вне scope).
- `packages/shared/src/auth/*-oauth.ts` — источники значений OAuth (в этом плане не меняем; Google/Microsoft/Slack-переменные остаются как есть).
- `scripts/electron-dev.ts` — только читает `.env`; не менять.
- Любые `docs/**`, `plans/**`, `README.md`, `package.json`, `.gitignore`.
- Значения каких-либо ключей: плейсхолдеры и комментарии — только.

## Executor steps (только правки файлов)

1. Открой `/Users/t/Projects/archive/rox-one-e01-wt/.env.example` и **полностью замени** его содержимое на следующий текст (ровно как есть; ни одного реального значения — только пустые плейсхолдеры):

```
# Rox — шаблон окружения для локальной разработки.
# Скопируй в `.env` (он в .gitignore) и подставь реальные значения.
# Этот файл отслеживается git и публичен: реальные значения сюда не попадают.

# --- Sentry (main-процесс Electron) ---
# Читают apps/electron/src/main/index.ts и scripts/electron-build-main.ts.
# Необязательно; при пустом значении отправка ошибок выключена.
SENTRY_ELECTRON_INGEST_URL=

# --- Ключи агентных моделей ---
# Читает packages/shared/src/agent/backend/internal/drivers/anthropic.ts (необязательно).
ANTHROPIC_API_KEY=
# Читает packages/shared/src/config/storage.ts (сид ключа дефолтного LLM-соединения; необязательно).
ROX_API_KEY=

# --- OAuth-клиенты (необязательно) ---
# Читают scripts/electron-dev.ts (dev-запуск) и scripts/electron-build-main.ts (build-time defines).
# Пользователь может вместо этого задать свои креды через source config в приложении.
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
SLACK_OAUTH_CLIENT_ID=
SLACK_OAUTH_CLIENT_SECRET=
MICROSOFT_OAUTH_CLIENT_ID=

# --- Бэкенд-ключи сервисов: здесь НЕ задаются ---
# DEEPGRAM_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY, BRAVE_API_KEY, E2B_API_KEY,
# TAVILY_API_KEY бэкенд читает из `<config-dir>/service-secrets.env`
# (переопределение: ROX_SERVICE_SECRETS_FILE). См. docs/development/default-service-connections.md.
```

   Важно: `CRAFT_MCP_URL`, `CRAFT_MCP_TOKEN`, `README_FOR_OSS.md`, `thecraftagents.com` и `MICROSOFT_OAUTH_CLIENT_SECRET` в файл **не входят**. Старое содержимое `.env.example` удаляется целиком, а не дополняется.

2. В `/Users/t/Projects/archive/rox-one-e01-wt/scripts/electron-build-main.ts` замени ровно строку комментария `:67`:

   было:
   ```ts
   // via source config. See README_FOR_OSS.md for setup instructions.
   ```
   стало:
   ```ts
   // via source config in the app.
   ```

   Ничего больше в файле не меняй (соседнюю строку `:66` (первый NOTE), список build-defines `:69-76` и функции вокруг — не трогать).

## Verification gates (оркестратор)

Все команды — с абсолютным cwd `/Users/t/Projects/archive/rox-one-e01-wt`.

1. **Призраки удалены (негативный grep).**

   ```
   grep -rn "CRAFT_MCP\|README_FOR_OSS\|thecraftagents" .env.example scripts/electron-build-main.ts ; echo "exit=$?"
   ```
   Ожидаемо: **пустой вывод**, `exit=1`.

2. **Ключи живой части действительно читаются кодом (выборочная сверка).** Для каждой переменной из целевого файла — непустое совпадение вне `.env.example`:

   ```
   for v in SENTRY_ELECTRON_INGEST_URL ANTHROPIC_API_KEY ROX_API_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET SLACK_OAUTH_CLIENT_ID SLACK_OAUTH_CLIENT_SECRET MICROSOFT_OAUTH_CLIENT_ID; do
     echo "== $v"; grep -rn "$v" scripts apps packages --include='*.ts' 2>/dev/null | grep -v node_modules | grep -v '/\.env' | head -3;
   done
   ```
   Ожидаемо: у **каждой** переменной ≥1 живой читатель (для `SENTRY_ELECTRON_INGEST_URL` — `apps/electron/src/main/index.ts:37,42`; остальные — по таблице выше). Ни одной пустой секции.

3. **Мёртвый `MICROSOFT_OAUTH_CLIENT_SECRET` отсутствует, а `MICROSOFT_OAUTH_CLIENT_ID` — присутствует.**

   ```
   grep -c "MICROSOFT_OAUTH_CLIENT_ID=" .env.example ; echo "---"
   grep -c "MICROSOFT_OAUTH_CLIENT_SECRET" .env.example
   ```
   Ожидаемо: `1`, затем `0`.

4. **В файле нет реальных значений — только пустые правые части.** Каждая непустая, не-комментарийная строка должна заканчиваться `=`:

   ```
   awk 'NF && $0 !~ /^#/' .env.example | grep -vE '^[A-Z][A-Z0-9_]*=$' ; echo "exit=$?"
   ```
   Ожидаемо: **пустой вывод**, `exit=1` (нет строк с непустым значением).

5. **Файл по-прежнему отслеживается git и не игнорируется.**

   ```
   git ls-files --error-unmatch .env.example >/dev/null && echo tracked ; git check-ignore -v .env.example ; echo "ignore_exit=$?"
   ```
   Ожидаемо: `tracked`, затем `ignore_exit=1` (не игнорируется).

6. **Диф ограничен двумя файлами.**

   ```
   git status --short
   ```
   Ожидаемо: ровно `M .env.example` и `M scripts/electron-build-main.ts`.

## Test plan

Отдельные тесты **не нужны** и не создаются — осознанно:

- Изменение чисто документационное: шаблон env-файла и строка комментария. Рантайм-поведения нет, шва для unit-теста нет; в репозитории нет и не должно быть теста «текста `.env.example`».
- Регрессионный риск («призрак вернулся») закрывается машинно-проверяемым негативным grep-гейтом №1 выше, а не тестом.
- Гейты №2/№4 (каждый ключ имеет читателя; нет непустых значений) — это и есть проверка «честности файла»; отдельный гард-скрипт в CI — отдельная задача и в этот план не входит.

## Границы и escape hatch (STOP-условия)

Остановись и отчитайся, **не** импровизируя, если:

- Содержимое `.env.example` или строка `scripts/electron-build-main.ts:67` не совпадает с приведённым выше (дерево дрейфнуло с `3114264ee`).
- Обнаружен **живой** читатель `CRAFT_MCP_URL`/`CRAFT_MCP_TOKEN` (значит, находка устарела — файл не мёртвый; весь план неверен).
- Обнаружен читатель `MICROSOFT_OAUTH_CLIENT_SECRET` в рантайме (вне `scripts/electron-dev.ts`/`scripts/electron-build-main.ts`) — тогда его нужно вернуть в файл; остановись и сообщи.
- `README_FOR_OSS.md` **существует** (значит, указатель живой — правку комментария отменяем).
- Правка требует тронуть файл вне Scope (например, `services/rox-maild/.env.example` или исходники OAuth).

## Maintenance note

- **Правило для `.env.example`:** в нём перечисляются только переменные, у которых есть живой читатель в `scripts`/`apps/electron/src/main`/`packages/*/src`, и **только пустые плейсхолдеры**. Бэкенд-секреты (Deepgram/Exa/Firecrawl/Brave/E2B/Tavily) сюда не попадают никогда — они живут в `<config-dir>/service-secrets.env` (см. `docs/development/default-service-connections.md`).
- **Ревьюеру проверить:** (а) ни одного реального значения в правых частях; (б) каждая перечисленная переменная имеет читателя по таблице выше; (в) удалены именно призраки Craft, а не живые переменные; (г) диф — только два файла.
- **Осознанно исключён `MICROSOFT_OAUTH_CLIENT_SECRET`** (PKCE, нет рантайм-читателя) — если Microsoft когда-нибудь перейдёт на confidential-клиент, переменную вернут в файл вместе с читателем в `microsoft-oauth.ts`.
- **Связь с планом 014:** `scripts/verify-service-keys.ts` и `packages/shared/src/config/server-services.ts` — контур тех самых бэкенд-ключей, которые здесь только упомянуты комментарием; их значения не должны попадать ни в `.env.example`, ни в доки.