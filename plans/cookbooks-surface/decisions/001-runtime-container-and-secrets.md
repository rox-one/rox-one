# ADR 001 — Runtime, контейнер вида, секреты и персистентность «Cookbooks»

- **Status:** Proposed (в рамках программы `cookbooks-surface`)
- **Owner решения:** инженерное (агент); юридических/продуктовых решений не требует
- **Context:** контракт сайдкара (`apps/electron/resources/cookbooks/ELECTRON-CONTRACT.md`, §2–§7) оставляет хосту 16 открытых вопросов. Ниже — решения хоста (ROX desktop) на v1; каждое фиксирует, что именно выбрано и при каких условиях пересматривается.

## Решения

> **Amendment 1 (2026-10-14, директива владельца):** решения §1 (контейнер вида), §2 в части «вид», §9 (навигационная политика вида) **отменены** — интерфейс строится нативным React в дизайн-системе ROX; `WebContentsView` и `cookbooks-view.ts` удаляются. Токен-изоляция сохраняется и усиливается: main — единственный HTTP-клиент сайдкара (проксирует данные в renderer типизированным IPC; ни URL, ни токен в IPC не попадают). Детали контракта — `SPEC.md` §Amendment 1.

### 1. ~~Контейнер вида: собственный top-level `WebContentsView`~~ (ОТМЕНЕНО Amendment 1)
Сайдкар отвечает `X-Frame-Options: DENY` — `iframe`/`webview` невозможны. Хостим **top-level `WebContentsView`** в главном окне (как `browser-pane-manager`/`extension-surface`), с `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, отдельной партицией `persist:cookbooks-lab`.
**Не выбрано:** ослабление XFO на стороне сайдкара (изменение замороженного кода лаборатории), `<webview>`-тег (запрещён конфигурацией окна).

### 2. Аутентификация страницы и токен
- `GET /lab.html` остаётся без токена (loopback, страница не несёт данных, data-gate — на JSON-ручках: это уже так).
- **Токен не покидает main-процесс:** URL с `?token=` знает только `cookbooks-runtime.ts`; renderer получает лишь `{state, reasonCode?}`; вид создаётся и навигируется из main.
- Логи: печатается только `127.0.0.1:<port>`; подстрока `token=` в stdout/stderr main запрещена (тест).
- Ротация/ TTL: не вводим (процесс = сессия; см. контракт §3.1) — пересматривается при появлении multi-window сценариев.

### 3. Discovery: только stdout-строка
Парсим **одну** строку `http://127.0.0.1:<port>/lab.html?token=<t>` из stdout (спавн с `-u`), валидируем: схема `http`, host ∈ {`127.0.0.1`}, явный порт, path `/lab.html`, ровно один query-параметр `token` (base64url, ≥24 симв.). Файл-дискавери не вводим в v1 (нет сценария re-attach: хост и сайдкар рождаются и умирают вместе). Health: `GET /lab.html` (200) — liveness; `GET /catalog` с токеном — readiness (запускается после ready для верификации).

### 4. Shutdown: SIGINT → grace → kill
`stop()`: `child.kill('SIGINT')` (POSIX; сайдкар ловит `KeyboardInterrupt` и корректно гасит HTTP-сервер), ожидание до 5 с, затем `SIGKILL`. Вызывается из `performQuitCleanup()` (`apps/electron/src/main/index.ts:2365+`) — идемпотентно. **Windows v1:** graceful-путь недоступен (`SIGINT` не доставляется) — используется `kill()`, зафиксированное ограничение; см. §What would flip this.

### 5. Рестарт-политика: backoff + кап крашей, без relaunch приложения
Заимствуем `ServerSupervisor`-семантику: pre-ready 2 попытки (таймаут 10 с), после ready — backoff `min(500ms·2^(n-1), 30s)`, счётчик сбрасывается после 60 с стабильной работы, > 5 последовательных крашей → состояние `failed` (без `app.relaunch` — это пользовательская фича, а не носитель приложения). UI показывает `failed` + причину + «Повторить» (ручной `restart()`).

### 6. Секреты: v1 — не передаются; Срез 2 — `POST /store` из креденшел-стора
- v1 НЕ передаёт секреты сайдкару вовсе: клетки без ключей получают встроенную дружелюбную ошибку лаборатории. Env-пrobрос запрещён и не нужен (блок-лист `packages/core/src/env/blocked-subprocess-env.ts:14-38` не ослабляется).
- Срез 2 (отдельный PR, security-ревью обязательно): main резолвит значения через `CredentialManager`/`resolveSecretsForSpawn` и отправляет их сайдкару **`POST /store` в память** (никаких файлов на диске); маппинг lab-ключей (`openai.api_key`, `anthropic.api_key`, `pinecone.api_key`, `weaviate.api_key`, `langfuse.public_key/secret_key`) → креденшелы ROX фиксируется таблицей в SPEC Среза 2; обновление — пуш при открытии поверхности и на `focus` окна (вотчеров у креденшелов нет — `config/watcher.ts:388-406`).
- Запрещено: писать стор-файл на диск, логировать значения, отдавать значения renderer.

### 7. Данные и ERD-срез (персистентность)
Канон продукта — local-first: файлы canonical, БД — rebuildable (`docs/superpowers/specs/2026-09-02-rox-local-first-platform-epic.md:10-33`). Поэтому:

- **Каталог** — read-only снапшот в ресурсах приложения (`apps/electron/resources/cookbooks/resources/cookbooks/`): 13 позиций, обновляется только синком вендора.
- **Личные копии и журнал запусков** — целиком во владении лаборатории: `<configDir>/cookbooks/workspace/cookbooks/<copyId>/` (документ, `origin.json`, `.venv`, персистенные выводы). Причина выбора `configDir` (а не workspace-каталога): `.venv` машинно-специфичен и не должен попадать в переносимый workspace-экспорт; копии — личный кэш+работа пользователя.
- **Продукт в v1 не добавляет ни одной таблицы и ни одной миграции** (workspace-service 553+ не трогаем); никакого серверного состояния у фичи нет. Фаза 2 (при требовании мультидевайса/индексации) — read-model коллекция по образцу `server-core/src/work/reference` (вариант C recon-отчёта E), не раньше.
- **ERD-срез v1:** `configDir ──< cookbooks/workspace ──< cookbooks/<copyId>/{notebook,origin.json,.venv} ──< runs (внутри документа)`, связь с продуктом — единственная точка: `LAB_SIDECAR` (127.0.0.1 + токен из main) и (Срез 2) `CREDENTIAL_STORE → POST /store`.

### 8. Флаг
`cookbooks.v1` — **defaultValue `true`**, `rollbackSafe: true` (kill-switch): выключение скрывает пункт навигации; поверхность недоступна. Не «пилот», а рабочая фича с рубильником.

### 9. Навигационная политика вида
`will-navigate`/`will-redirect`: разрешён только origin `http://127.0.0.1:<port>` текущей сессии; всё прочее — `preventDefault`. `setWindowOpenHandler` → `deny`. Разрешения (camera/mic/geolocation…) — `deny`. DevTools в packaged — закрыты. Партиция `persist:cookbooks-lab` отдельная от браузера (cookie-изоляция; у лаборатории cookies нет, но принцип сохраняем).

## Considered options (not chosen)

- **iframe + ослабление XFO** — отвергнуто: изменение замороженного сайдкара и потеря security-заголовка.
- **Открытие во внешнем браузере** — отвергнуто: теряется интеграция с продуктом (сайдбар, локали, будущие секреты), нарушает цель «UI/UX-консистентность».
- **Порт/токен в renderer** — отвергнуто (§2): расширяет поверхность утечки без выгоды.
- **Таблицы в workspace-service** — отложено до фазы 2 (§7): противоречит local-first канону для v1.

## What would flip this

1. Требование мультиоконного re-attach → файл-дискавери (контракт §2.2).
2. Windows-приоритет с graceful-стопом → `POST /shutdown` в сайдкаре (изменение лаборатории) или `taskkill`-каскад.
3. Требование облачной синхронизации копий → миграция на вариант B/C (workspace-service), отдельным тикетом с ADR.
4. Новое решение владельца по хранению вендорского контента (лицензии) — вне инженерных решений.

## Evidence

- Контракт: `apps/electron/resources/cookbooks/ELECTRON-CONTRACT.md` (§2.2, §2.5, §3.1–3.3, §4.2, §5.2, §7).
- Recon A–E (5 скаутов, 2026-10-14): пути и симы — в [SPEC](../SPEC.md) §Implementation Decisions.
- Local-first канон: `docs/superpowers/specs/2026-09-02-rox-local-first-platform-epic.md:10-33`.
