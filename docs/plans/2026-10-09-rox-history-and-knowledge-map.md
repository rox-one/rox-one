# Батч 2026-10-09 — «Rox History» (история буфера) и «Карта знаний» (OntoShip-визуал в профиле и контексте)

**Источник:** голосовое ТЗ пользователя 2026-10-09 (две ссылки-донора: `github.com/agisota/copyosity`, `github.com/agisota/ontoship`).
**Репозиторий-цель:** `rox-one/rox-one`.
**Ветка:** `feat/rox-history-and-knowledge-map`, изолированный ворктри `/Users/t/Projects/archive/rox-w-history` от `origin/main` (база `bec727f04`).
**Рабочее дерево `~/Projects/rox-one` НЕ трогается** — там 135 изменённых/новых файлов другой сессии (`memory-repo`, `browser-intel`, `product-tour`).
**Родительские документы:** `docs/plan.md` (канонический индекс планов), `docs/plans/2026-10-08-rox-user-batch.md` (стиль и гейты), `docs/specs/2026-08-07-unified-shell/10-anti-goals.md` (запреты оболочки).

---

## 0. Что просил пользователь (дословно) и во что это разворачивается

| # | Цитата ТЗ | Требование в терминах продукта |
|---|---|---|
| A1 | «в profile пользователя приложения либо в панельке с контекстом и с информацией должна генерироваться вот такая вот хуйня автоматически для каждого пользователя» | Автоматически генерируемая **визуальная карта знаний пользователя** (как `gitmark map` в OntoShip: дерево + рендер markdown + радиальный граф связей), живущая в **профиле** (Настройки → Аккаунт) и в **панели контекста** (Настройки → Контекст и предпочтения) |
| A2 | «чтобы они были в курсе, чтобы у них всегда это визуально красиво отображалось на русском языке» | Данные всегда актуальны (пересборка при изменении источников), визуал на токенах Rox, **весь текст — русский** (ru — дефолтная локаль) |
| B1 | «мы поставляем наше приложение с лончером. В этом лончере у нас отсутствовал клипборд… отсутствовало расширение клипборд» | Расширения буфера обмена нет; её нужно поставить внутрь Rox и сделать доступной из **лончера** (омнибокс ⌘K) |
| B2 | «Нужно адаптировать и интегрировать вот этот клипборд… полностью перебрендировать, перенаименовать. Это должен быть не CopioCity, а **Rox History**» | Полный ре-брендинг донора copyosity → «Rox History»; ни одной строки/идентификатора `copyosity`/`CopioCity` в поставке |
| B3 | «Нужна полная локализация на русский язык» | Все строки фичи — через `t()`, ru — дефолтный и полностью переведённый набор; ключи во всех 12 локалях (правило репозитория) |
| B4 | «это нужно встроить, соответственно, в версию для Mac» | Живая приёмка — на macOS-сборке приложения |
| B5 | «нужно точно исполнять Clipboard History функционал… и весь остальной функционал нужно оставить» | Паритет по истории буфера: захват, поиск, избранное, теги, фильтры, карточки, изображения, быстрый просмотр, действия, настройки (см. §1.1) |
| B6 | «вот этот вот типа минимизировать в плавающее окошечко — это нужно отключить» | Никакого плавающего окна/«блоба»/мини-режима: фича живёт **внутри оболочки Rox** (панель/экран). Floating-окно и NSMenu-меню трея донора не переносятся |
| B7 | «вставить весь функционал просто внутрь нашего расширения, которое мы поставляем и включаем по умолчанию вместе с нашим приложением» | Rox History появляется как **first-party расширение** в Центре расширений (runtime `craft-native`, статус «включено», показывается по умолчанию) |

---

## 1. Доноры и точный паритет

### 1.1 copyosity (Rust/Tauri 2 + Svelte 5, 33k LOC) → «Rox History»

Разведка источника (файлы/строки — в отчётах разведки, сохранены в логе сессии):

**Переносим (порт в Electron main + renderer):**

| Возможность донора | Источник | Как в Rox |
|---|---|---|
| SQLite-схема (entries/tags/settings), WAL, индексы | `src-tauri/src/db.rs:397-470` | `clipboard-history/history.db` в каталоге конфигурации профиля; точная схема — §3.1 |
| Дедуп по `content_hash` + «всплытие» записи (bump `created_at`) | `db.rs:900-957` | так же |
| Ретеншн по дням, избранное не истекает | `db.rs:1813-1825` | так же + лимит по числу записей |
| Поллинг-монитор с адаптивным интервалом 300→750 мс, пропуск собственных записей | `clipboard_monitor.rs:540-688` | `setInterval`-цикл, интервал 300→750 мс, подавление собственных записей |
| Захват текста + пропуск «имени файла-картинки» | `clipboard_monitor.rs:79-85,524-534` | так же |
| Захват растровой картинки (скриншоты) + PNG-миниатюра 240×160 | `clipboard_monitor.rs:37-45,107-126` | `clipboard.readImage()` + `NativeImage.resize()` (без новых зависимостей) |
| Поиск LIKE по предварительно приведённому к нижнему регистру зеркалу + пагинация по 50 + префетч | `db.rs:198-208`, `overlay-entries.svelte.ts` | так же, `LIMIT/OFFSET`, страница 50, префетч на 2 экрана |
| Вкладки «История»/«Избранное» | `overlay-entries.svelte.ts` | так же |
| Чипы тегов + чипы форматов + счётчики (скрытые теги `code/otp/token/log` не показываются) | `overlay-filters.ts:24-30,95-143`, `card-tag-label.ts` | так же + ручное проставление/снятие тегов |
| Карточки с превью, мета `W×H · размер`, дата | `ClipboardCard.svelte:528-540` | так же, на компонентах `@rox/ui` |
| Быстрый просмотр (полноразмерная картинка, ленивая загрузка) | `QuickLookPanel.svelte` | модальный просмотр: картинка + метаданные + теги |
| Клавиатура: ←/→/↑/↓, Enter = копировать, Space = просмотр, Esc, ⌘F | `quick-look-keyboard.ts` | так же (без «вставки в чужое приложение» — см. «Не переносим») |
| Действия: копировать, избранное, удалить; добавляем: тег, очистить историю | `ClipboardCard.svelte:479-516` | так же |
| Настройки: ретеншн (1/7/30/180 дней), авто-захват, изображения | `db.rs:624-897` | + лимит записей, «пропускать конфиденциальное», глобальный хоткей (выкл. по умолчанию) |

**Не переносим — с обоснованием (осознанные решения, не «потом»):**

| Не переносим | Причина |
|---|---|
| Плавающее окно-оверлей, NSMenu трея, «минимизация в блоб» | ТЗ (B6): фича живёт внутри оболочки; в Rox нет второго рельса/палитры (S-10 anti-goals #1/#2) |
| Панельная физика macOS (`HIDDEN_AUXILIARY_LEVEL=3`, `FULLSCREEN_AUXILIARY_LEVEL=24`) | Не нужна: нет отдельного окна |
| Авто-вставка в активное приложение (Accessibility + ⌘V), восстановление фокуса | Нет нативного хелпера в Rox; в приложении нормальный путь — «Скопировать» (запись в системный буфер), вставку делает пользователь. Копирование остаётся |
| OCR (Apple Vision) и AI-тегирование изображений | В Rox нет OCR-пайплайна; тащить нативный модуль/сервис ради тега — за пределами задачи. Вместо OCR — теги вручную, метаданные изображения сохраняются |
| Голосовая транскрибация, whisper, ollama, hub, агент-палитра, сниппеты, коллекции | Не относятся к истории буфера; в Rox есть свои диктовка/агент. Коллекции в доноре фактически мертвы (`collection_id` никогда не пишется) |
| Нативные UTI `com.compuserve.gif`, file-URL Finder, changeCount, исключение приложений по frontmost bundle id, мессенджеры паролей | Часть переносится через `clipboard.availableFormats()`/`readBuffer()` (GIF-байты и `org.nspasteboard.ConcealedType`), часть требует нативного хелпера — фиксируем как ограничение с fail-soft поведением, без ложных обещаний |

### 1.2 ontoship (`gitmark map`) → «Карта знаний»

Донор — Python-стандартная библиотека без зависимостей: `skills/kb-search/gitmark.py:448-547` строит **самодостаточный HTML**: дерево файлов + отрендеренный markdown + **радиальный граф связей** (BFS-уровни от точки входа, угловая развёртка по весу поддерева, `area::`-узлы, статистика files/refs/unreached). Переносим **алгоритм и смысл**, не HTML: рендер — нативный React/SVG внутри приложения, данные — из Rox.

| Элемент донора | Как в Rox |
|---|---|
| Узлы = документы + `area::`-группы, ребра = `ref` (ссылки) + `own` (принадлежность области) | То же: узлы `doc` + `area`, ребра `link` + `member` |
| BFS-уровни и углы от корневой точки | Чистая функция `radialLayout()` в renderer (`angle = середина сектора`, размер сектора ∝ числу листьев) |
| Статистика `files/areas/refs/bytes/unreached → truncated` | `stats { files, links, areas, bytes, truncated, skipped }` — числа честные |
| Три режима: дерево, markdown-просмотр, граф | То же: «Граф / Дерево / Документ» |
| `serve`/FTS5-поиск/int/`lint` | Не переносим: поиск по узлам — клиентский фильтр; индексация/FTS — не нужна (корпус мал, данные derived) |
| Источники KB = `CLAUDE.md`/`README.md`/`docs/**` | Источники Rox: **контекст** (`<CONFIG_DIR>/context/*.md`), **память** (`<CONFIG_DIR>/memory/*`), **заметки** (markdown рабочего пространства) |

---

## 2. Ограничения и политика

- Git: только merge, никогда rebase/force. Работа — в отдельном ворктри; чужой dirty tree и параллельные сессии не трогаются.
- S-10 anti-goals: никакой второй палитры/рельса; **никакого стороннего кода в Electron main** (только first-party Rox-код); расширения получают только capabilities брокера.
- i18n: все пользовательские строки — через `t()` из react-i18next; ru — дефолт; ключи добавляются во **все 12** локалей; ASCII-сортировка; паритет проверяется тестом.
- UI: русский, светлая компактная компоновка, токены Rox (`--fg/--muted/--border/--surface/--accent`), motion-переходы, справка/подсказки там, где нужны.
- Один прогон форматтеров/линтеров/тестов — лидом, на объединении изменений (субагенты гейты не запускают).
- Черновики/скрипты — `/tmp` или `~/Projects`; ничего в `~/Desktop`/`~/Documents`; скриншоты — `~/Pictures/Shots`.
- Наблюдаемая приёмка — на живом macOS-бандле (`apps/electron/release/mac-arm64/Rox.app` или локальная сборка + Electron) с изолированным `ROX_CONFIG_DIR`.
- Ключи локалей, `packages/shared/src/protocol/channels.ts`, `apps/electron/src/shared/types.ts`, `apps/electron/src/transport/channel-map.ts`, снапшот IPC, `main/handlers/index.ts`, роуты/навигация/омнибокс — **один владелец** (W0), чтобы не было гонок по общим файлам.

---

## 3. Архитектура и контракты (точные имена)

### 3.1 Rox History — хранилище и захват (Electron main)

- Каталог: `<CONFIG_DIR>/clipboard-history/`; файл БД `history.db` (SQLite, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`), картинки — `images/<content_hash>.<ext>` (файлы, не BLOB), миниатюры — BLOB в строке.
- Драйвер: **`DatabaseSync` из `@rox/shared/utils/sqlite-runtime`** — рантайм-нейтральный адаптер (под Bun — `bun:sqlite`, под Electron/Node — `node:sqlite`; esbuild-алиас `bun:sqlite` → `apps/electron/src/main/shims/node-sqlite.cjs`), открытие в try/catch: при недоступности фича сообщает «недоступно» (fail-soft), приложение не падает. Миграции: PRAGMA-блок → `PRAGMA user_version` (чужая версия — отказ), `CREATE TABLE IF NOT EXISTS …`, запись новой версии (идиома `packages/shared/src/account-replica/outbox.ts`).
- Схема (точная; миграции — по `PRAGMA user_version`):

```sql
CREATE TABLE IF NOT EXISTS clip_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                       -- 'text' | 'image'
  text_content TEXT,
  text_search TEXT,                         -- text_content в нижнем регистре (LIKE-поиск)
  image_path TEXT,                          -- относительный путь в <config>/clipboard-history
  image_thumb BLOB,                         -- PNG ≤ 240×160
  image_format TEXT,                        -- 'png' | 'gif' | 'jpg'
  image_width INTEGER, image_height INTEGER, image_byte_size INTEGER,
  content_hash TEXT NOT NULL,
  char_count INTEGER,
  created_at TEXT NOT NULL,                 -- ISO-8601 UTC
  is_starred INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clip_entries_created ON clip_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clip_entries_hash ON clip_entries(content_hash);
CREATE INDEX IF NOT EXISTS idx_clip_entries_starred ON clip_entries(is_starred);
CREATE TABLE IF NOT EXISTS clip_tags (
  entry_id INTEGER NOT NULL REFERENCES clip_entries(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_clip_tags_tag ON clip_tags(tag);
CREATE TABLE IF NOT EXISTS clip_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

- Дедуп: `content_hash = sha256(kind + '\u0000' + payload)`; попадание в существующий хеш — обновление `created_at` (запись всплывает), без новой строки.
- Настройки (ключи в `clip_settings`, дефолты): `captureEnabled=true`, `captureImages=true`, `retentionDays=30` (принимаются 1/7/30/180; иначе 30), `maxEntries=2000`, `hideSensitive=true`, `globalShortcutEnabled=false`, `globalShortcut='CommandOrControl+Shift+V'`.
- Уборка: при старте и после каждых 200 захватов — удаление не-избранных старше `retentionDays` и «сверх лимита» `maxEntries` (сначала самые старые не-избранные), с удалением файлов картинок.
- Монитор (интервал 300 мс первые 30 с после активности, затем 750 мс): 
  1. `availableFormats()` — дешёвая проверка; 
  2. если есть текстовые форматы — `readText()`, хеш, при изменении — захват (пропуск однострочного «имени файла-картинки»); 
  3. если текста нет и изменилась сигнатура форматов с графическим типом — `readImage()` → PNG + миниатюра; 
  4. при `hideSensitive` и наличии формата `org.nspasteboard.ConcealedType`/`TransientType`/`AutoGeneratedType` (или `com.compuserve.gif` → GIF-байты через `readBuffer`) — пропуск/GIF-захват соответственно; недоступность формата — не ошибка (fail-soft);
  5. собственные записи (действие «Скопировать») не захватываются: счётчик собственных записей гасит следующий тик.
- Текст > 1 МиБ не захватывается (запись пропускается целиком, без обрезки).

**Каналы** (`RPC_CHANNELS.clipboard`, строки — как указано):

| Канал | Аргументы → результат |
|---|---|
| `clipboard:list` | `ClipListQuery → ClipListResult` |
| `clipboard:get` | `(id: number) → ClipEntryDetail \| null` |
| `clipboard:star` | `(id: number, starred: boolean) → { ok: true }` |
| `clipboard:tags` | `(id: number, tags: string[]) → { ok: true }` |
| `clipboard:delete` | `(id: number) → { ok: true }` |
| `clipboard:clear` | `(keepStarred: boolean) → { removed: number }` |
| `clipboard:copy` | `(id: number) → { ok: true }` — запись в системный буфер; `access: 'write'`, `nativeAction: 'write'`, владелец окна проверяется как в `main/handlers/voice-clipboard.ts` |
| `clipboard:settingsGet` | `() → ClipSettings` |
| `clipboard:settingsSet` | `(Partial<ClipSettings>) → ClipSettings` |
| `clipboard:tagCounts` | `() → ClipTagCount[]` |
| `clipboard:stats` | `() → ClipStats` |
| `clipboard:changed` (push) | `ClipChangedPayload` |

**Типы** — `packages/shared/src/clipboard-history/types.ts` (browser-safe, без node-импортов), реэкспорт через `packages/shared/package.json` (exports) как `@rox/shared/clipboard-history`:

```ts
export type ClipEntryKind = 'text' | 'image'
export interface ClipEntrySummary {
  id: number; kind: ClipEntryKind; preview: string; text: string | null
  charCount: number | null; imageFormat: 'png' | 'gif' | 'jpg' | null
  imageWidth: number | null; imageHeight: number | null; imageByteSize: number | null
  thumbDataUrl: string | null; tags: string[]; starred: boolean
  createdAt: string; sourceApp: string | null
}
export interface ClipEntryDetail extends ClipEntrySummary { imageDataUrl: string | null }
export interface ClipCounts { total: number; starred: number; text: number; image: number }
export interface ClipListQuery { q?: string; kind?: ClipEntryKind | 'all'; starredOnly?: boolean; tag?: string; limit?: number; offset?: number }
export interface ClipListResult { entries: ClipEntrySummary[]; total: number; counts: ClipCounts; hasMore: boolean }
export interface ClipTagCount { tag: string; count: number }
export interface ClipSettings { captureEnabled: boolean; captureImages: boolean; retentionDays: number; maxEntries: number; hideSensitive: boolean; globalShortcutEnabled: boolean; globalShortcut: string }
export interface ClipStats { total: number; starred: number; text: number; image: number; bytes: number; storageBytes: number; oldestAt: string | null }
export interface ClipChangedPayload { reason: 'captured' | 'updated' | 'cleared' | 'settings' }
```

**Файлы (владельцы в §5):**
- `apps/electron/src/main/clipboard-history/store.ts` — `ClipboardHistoryStore` (открытие/миграции/запросы/уборка; без `electron`, принимает каталог — тестируется на временном каталоге).
- `apps/electron/src/main/clipboard-history/monitor.ts` — `ClipboardMonitor` (инъекция адаптера `ClipboardAdapter { availableFormats(), readText(), readImage(), readBuffer(fmt), writeText(), writeImage() }`, таймеры/часы инъектируемы).
- `apps/electron/src/main/handlers/clipboard-history.ts` — `registerClipboardHistoryGuiHandlers(server, deps)` + `startClipboardMonitor(deps)` + `HANDLED_CHANNELS` (лейаут `main/handlers/*.ts` как у `voice-clipboard.ts`; имя экспорта обязательно для W0).

### 3.2 Карта знаний — сбор, канал, рендер

- Канал: `RPC_CHANNELS.knowledgeMap.GET = 'knowledgeMap:get'` → `KnowledgeMapDto`; push `knowledgeMap:changed` (после пересборки источников, если включён watcher-режим).
- Сбор — **server-core** (`packages/server-core/src/knowledge/knowledge-map.ts`, чистые функции, без sqlite: сканирование fs): 
  - `context` — `<CONFIG_DIR>/context/*.md` через `@rox/shared/context-docs`;
  - `memory` — `<CONFIG_DIR>/memory/*.md` + `history/*.md` (верхний уровень + история, лимит 50 последних);
  - `notes` — markdown рабочего пространства (тот же корень, что у notes-хендлеров), рекурсивно, с исключением `assets/`, `templates/`, `.craft/`, `.git/`, лимит 400 документов и 2 МиБ на файл.
  - Узлы: `doc` (id = `<area>:<relativePath>`, `label` = заголовок H1 или имя файла, `size` = байты, `linkCount`), группы `area` (`context`/`memory`/`notes`), корень `root` (имя пользователя или «Профиль»).
  - Рёбра: `link` — `[[викиссылка]]` и относительные markdown-ссылки, разрешённые в пределах корпуса; `member` — area → документ; дедупликация, само-ссылки отбрасываются.
  - Статистика: `files`, `links`, `areas`, `bytes`, `truncated` (упёрлись в лимит), `skipped` (нечитаемые файлы).
- Раскладка и взаимодействие — **renderer** (чистые функции, юнит-тестируемые): BFS-уровни от корня, радиальные позиции (угол = середина сектора, сектор ∝ числу листьев, как `_asn` в `gitmark.py`), оборванные узлы (не связанные с корнем) — на внешнем кольце; зум/панорама/«вписать»; клик по узлу — предпросмотр документа.
- Предпросмотр документа использует **существующие** API: контекст — `readContextDoc`, заметки — `notes:read`, память — чтение файла памяти; новых каналов для чтения не добавляем.
- Автоактуальность: пересборка при открытии экрана + подписка на существующие события изменений (`onContextDocsChanged`, `onMemoryChanged`, `notes:changed` set/watched) + кнопка «Перестроить»; троттлинг 500 мс.
- Точки входа: секция в `ContextSettingsPage` (полная карта: Граф/Дерево/Документ) и секция-карточка в `AccountSettingsPage` (статистика + мини-граф + кнопка «Открыть полную карту» → Контекст). Сессионный инспектор не трогаем (S-10: не плодим поверхности; «либо… либо» из ТЗ закрыто двумя точками).

```ts
export type KnowledgeMapArea = 'context' | 'memory' | 'notes'
export interface KnowledgeMapNode { id: string; label: string; area: KnowledgeMapArea | 'root'; kind: 'doc' | 'area' | 'root'; size: number; linkCount: number; relPath: string | null }
export interface KnowledgeMapEdge { source: string; target: string; kind: 'link' | 'member' }
export interface KnowledgeMapStats { files: number; links: number; areas: number; bytes: number; truncated: boolean; skipped: number }
export interface KnowledgeMapDto { generatedAt: string; rootLabel: string; nodes: KnowledgeMapNode[]; edges: KnowledgeMapEdge[]; stats: KnowledgeMapStats }
```

### 3.3 Расширение в Центре расширений (B7) — точная механика по разведке

Разведка установила: **производителя записей `craft-native` в «установленных» сейчас нет** (Центр расширений собирает строки только из проекций сущностей на диске — skills/sources/automations/SiYuan — и из `marketplace/lock.json`; статический каталог — только подписанный `resources/marketplace/catalog.json`, и `context-doc`-записи устанавливают markdown-документы, а не код). Поэтому для B7 вводится **минимальный first-party реестр**:

- Новый файл `packages/shared/src/extensions/builtin-features.ts`: `BUILTIN_FIRST_PARTY_RECORDS: ExtensionRecord[]` — две записи (`builtin:clipboard-history`, `builtin:knowledge-map`), собранные через `parseExtensionManifest({ id, name, version, runtime: 'craft-native', permissions })`; поля записи: `category: 'apps'`, `providerId: 'installed'`, `status: 'enabled'`, `worksIn: ['Командная палитра', 'Панели']`, `description` — русским текстом (по образцу marketplace: RU-текст как данные, не i18n-ключ), `manifest.permissions: ['ui.panel','ui.command']` (высокорисковые не нужны: `craft-native` — наш код; доступ к буферу/ФС внутри приложения не требует декларации).
- Слияние — в `packages/server-core/src/handlers/rpc/extensions.ts` (обработчик `extensions:listInstalled`): базовые записи добавляются к результату, дедупликация по `id` (существующие записи приоритетнее), порядок стабилен.
- Группа в едином центре (`center-groups.ts`) не меняется: id без префиксов `skill:`/`source:`/`automation:` попадает в группу `marketplace` — так запись и отобразится (статус «включено»), без правок UI.
- Тест: `packages/shared/src/extensions/__tests__/builtin-features.test.ts` (обе записи валидны по `parseExtensionManifest`, `status==='enabled'`, уникальные id) + тест хендлера `extensions:listInstalled` (обе записи присутствуют и включены при пустом state).
- Ключи локалей для записи расширения не добавляются (название — бренд «Rox History», описание — русский текст в данных, как у marketplace-записей).

---

## 4. Инвентарь i18n-ключей (единый владелец — W0; тексты ru/en пишет W0, прочие локали получают английский текст — существующая конвенция)

**`clipboard.*`** (Rox History): `title`, `subtitle`, `tab.history`, `tab.starred`, `search.placeholder`, `search.clear`, `filter.all`, `filter.text`, `filter.image`, `filter.tags`, `filter.reset`, `empty.title`, `empty.body`, `empty.search`, `empty.searchBody`, `counts.summary`, `action.copy`, `action.star`, `action.unstar`, `action.tags`, `action.delete`, `action.preview`, `action.clearAll`, `action.clearUnstarred`, `action.settings`, `action.refresh`, `copied`, `deleted`, `cleared`, `image.label`, `image.meta`, `time.justNow`, `time.minutesAgo`, `time.hoursAgo`, `time.daysAgo`, `quickLook.title`, `quickLook.close`, `quickLook.details`, `tag.add`, `tag.placeholder`, `tag.remove`, `tag.empty`, `settings.title`, `settings.captureEnabled`, `settings.captureEnabledHint`, `settings.captureImages`, `settings.captureImagesHint`, `settings.retention`, `settings.retentionHint`, `settings.retention.1d`, `settings.retention.7d`, `settings.retention.30d`, `settings.retention.180d`, `settings.maxEntries`, `settings.maxEntriesHint`, `settings.hideSensitive`, `settings.hideSensitiveHint`, `settings.hotkey`, `settings.hotkeyHint`, `settings.saved`, `unavailable`, `error`, `a11y.list`, `a11y.card`.

**`knowledgeMap.*`**: `title`, `description`, `view.graph`, `view.tree`, `view.doc`, `refresh`, `generatedAt`, `area.context`, `area.memory`, `area.notes`, `area.other`, `stats.summary`, `stats.files`, `stats.links`, `stats.areas`, `stats.bytes`, `empty.title`, `empty.body`, `truncated`, `search.placeholder`, `node.links`, `node.open`, `legend.hint`, `fit`, `zoomIn`, `zoomOut`, `unavailable`, `error`, `profile.sectionTitle`, `profile.sectionHint`, `profile.openFull`, `context.sectionTitle`, `context.sectionHint`.

Правило для исполнителей A2/B2/B1: **использовать только эти ключи**; недостающую строку не изобретать — перечислить в отчёте (лид добавит централизованно).

---

## 5. Граф задач

| ID | Deliverable | Владелец | Зависит от | Файлы (границы) | Верификация |
|---|---|---|---|---|---|
| **W0** | Проводка: каналы, DTO-экспорты, `electronAPI`, channel-map, снапшот IPC, регистрация хендлеров, роут/панель/навигация/омнибокс-команда, first-party реестр расширений, ключи 12 локалей | worker | — | `packages/shared/src/protocol/channels.ts`, `packages/shared/src/clipboard-history/types.ts`, `packages/shared/src/knowledge/knowledge-map-types.ts`, `packages/shared/src/extensions/builtin-features.ts` + `packages/server-core/src/handlers/rpc/extensions.ts`, `apps/electron/src/shared/types.ts`, `apps/electron/src/transport/channel-map.ts`, `apps/electron/src/shared/__tests__/ipc-channels.test.ts`, `apps/electron/src/main/handlers/index.ts` + `apps/electron/src/main/handlers/__tests__/registration.test.ts`, `apps/electron/src/shared/routes.ts`+`route-parser.ts`, `renderer/components/app-shell/{MainContentPanel.tsx,AppShell.tsx,nav-destinations.ts}`, `renderer/atoms/panel-stack.ts`, `renderer/platform/omnibox-bootstrap.ts`+`omnibox-clipboard-history.ts`, 12×`packages/shared/src/i18n/locales/*.json` | `bun run typecheck:all` (или затронутые пакеты); `bun test packages/shared/src/i18n apps/electron/src/shared/__tests__/ipc-channels.test.ts apps/electron/src/main/handlers/__tests__/registration.test.ts packages/shared/src/extensions`; `bun run lint:i18n:parity`; `bun run lint:i18n:sorted`; `bun run lint:i18n:coverage` |
| **A1** | Ядро карты знаний: сканер корпуса + RPC + тесты | worker | — | `packages/server-core/src/knowledge/knowledge-map.ts`, `packages/server-core/src/handlers/rpc/knowledge-map.ts`, `packages/server-core/src/handlers/rpc/index.ts` (только регистрация), `packages/server-core/src/knowledge/__tests__/knowledge-map.test.ts` | `bun test` новых файлов: разрешение ссылок, лимиты/truncated, пустой корпус, нечитаемый файл (skipped), детерминизм (два прогона — одинаковый DTO) |
| **A2** | UI карты: граф/дерево/документ + интеграция в Контекст и Профиль + тесты | worker | W0 (типы/канал), A1 (DTO) | `apps/electron/src/renderer/components/knowledge-map/**`, правки `renderer/pages/settings/ContextSettingsPage.tsx` и `renderer/pages/settings/AccountSettingsPage.tsx` | `bun test` новых тестов модели/раскладки; `bunx tsc --noEmit` electron; живой прогон — L2 |
| **B1** | Ядро Rox History: store + monitor + GUI-хендлеры + тесты | worker | W0 (контракт) | `apps/electron/src/main/clipboard-history/{store.ts,monitor.ts,index.ts}`, `apps/electron/src/main/clipboard-history/__tests__/**` | `bun test` store (темп-каталог: вставка/дедуп+всплытие/поиск/теги/ретеншн/лимит/удаление файлов), монитор (инъекция адаптера: захват текста, пропуск conceal, GIF-путь, собственные записи, адаптивный интервал) |
| **B2** | UI Rox History: экран, карточки, быстрый просмотр, настройки + тесты | worker | W0, B1 | `apps/electron/src/renderer/pages/ClipboardHistoryPage.tsx`, `apps/electron/src/renderer/components/clipboard-history/**` | `bun test` модели (фильтры/скрытые теги/метки времени/мета картинок) и сценарных тестов DOM; живой прогон — L2 |
| **L1** | Гейт: типы всех затронутых пакетов, целевые тесты, i18n (паритет/сортировка/покрытие), снапшот IPC, линт на объединении | lead | W0,A1,A2,B1,B2 | — | команды из §8.1, вывод — в «Прогресс» |
| **L2** | Живой прогон macOS: сборка, запуск с изолированным конфигом, `pbcopy`, скриншоты обоих экранов, проверка записи в истории и узлов карты | lead | L1 | — | CDP-скриншоты + OCR/текст DOM (§8.2) |
| **L3** | Независимый ревью (reviewer) + фиксапы | lead | L2 | — | отчёт ревьюера, фиксапы, повтор L1 |
| **L4** | Документация + коммиты + PR + merge в `main` + readback | lead | L3 | `docs/plans/2026-10-09-rox-history-and-knowledge-map.md`, `docs/plan.md` | подпись merge-коммита, `git log origin/main`, зелёный `git status` |

Параллельность: W0, A1, B1 — стартуют сразу и параллельно (disjoint-файлы); A2 и B2 — сразу после W0/A1/B1 (или параллельно, если исполнители пишут под зафиксированные в §3 контракты; конфликтов файлов нет). Лид держит интеграцию и гейт.

---

## 6. Задачи детально

### W0 — Проводка (owner: worker `wiring`)

- **Inputs:** контракты §3–§4 этого плана; существующие паттерны: `main/handlers/voice-clipboard.ts` (владелец/`access`), `main/handlers/index.ts` (`registerGuiRpcHandlers`), `transport/channel-map.ts` (`invoke`/`listener`), `shared/types.ts` (интерфейс `electronAPI`), `shared/__tests__/ipc-channels.test.ts` (снапшот строк), `renderer/pages/FeedPage.tsx` + `MainContentPanel.tsx` (образец view-экрана), `renderer/platform/omnibox-bootstrap.ts` (образец команды), `packages/shared/src/extensions/adapters/marketplace.ts` (форма `ExtensionRecord`), `scripts/sort-locales.ts`.
- **Produces:** каналы `clipboard:*` и `knowledgeMap:get`/`knowledgeMap:changed`; DTO-модули shared с реэкспортами; методы `electronAPI` (§3.3) с точными именами; записи в channel-map; строки в снапшоте IPC; регистрация `registerClipboardHistoryGuiHandlers`; роут `/clipboard-history` + панель + ленивый импорт страницы `pages/ClipboardHistoryPage.tsx` (default export) + пункт рейла «История буфера» (group `more`); команда омнибокса «История буфера» (открывает панель/роут); запись расширения `builtin:clipboard-history`; все ключи §4 во всех 12 локалях.
- **Acceptance:** `window.electronAPI.listClipboardEntries` и `buildKnowledgeMap` типизированы и существуют; снапшот IPC содержит все новые строки (и обновлённый счётчик); Центр расширений отдаёт `builtin:clipboard-history` со статусом `enabled`; локали: ключи есть во всех 12 файлах, отсортированы, паритет зелёный; команда видна в омнибоксе и ведёт на экран.
- **Work:** (1) каналы; (2) DTO-модули; (3) `electronAPI`-типы; (4) channel-map; (5) снапшот; (6) регистрация хендлеров (импорт модуля B1 — он появится у B1; имя экспорта зафиксировано); (7) роут/панель/навигация/омнибокс; (8) запись расширения + тест; (9) локали скриптом из `/tmp` (после — удалить скрипт).
- **Verification:** см. таблицу §5 (W0).
- **Integration:** A2/B2 используют только эти API/ключи; лид проверяет отсутствие «сырых» ключей в UI на живом прогоне.

### A1 — Ядро карты знаний (owner: worker `km-core`)

- **Inputs:** §3.2; `@rox/shared/context-docs` (`listContextDocs`/`readContextDoc`/`getContextDocsDir`), `MemoryFileStore`/пути памяти, notes-корень (как в `packages/server-core/src/handlers/rpc/notes.ts`), `pushTyped`/`RpcServer` (пример: `handlers/rpc/context-docs.ts`), `@rox/shared/protocol`.
- **Produces:** `buildKnowledgeMap({ configDir, notesRoot, workspaceId? }) → KnowledgeMapDto` (чистая, детерминированная, без записи на диск) + RPC-хендлер `knowledgeMap:get` (+ push `knowledgeMap:changed` при пересборке, если триггерится из watcher-пути; минимум — GET).
- **Acceptance:** пустой корпус → DTO с `stats.files=0` и валидным корнем; документы с `[[wikilink]]` и markdown-ссылками дают рёбра `link` только внутри корпуса; лимиты дают `truncated=true` и честные счётчики; нечитаемый файл → `skipped+1`, без исключения; два прогона на неизменных данных → идентичный DTO (кроме `generatedAt`).
- **Work:** сканер → нормализация (NFC, срез frontmatter), извлечение заголовка/ссылок, построение узлов/рёбер, статистика, регистрация хендлера.
- **Verification:** `bun test packages/server-core/src/knowledge/__tests__/knowledge-map.test.ts` + тест хендлера; сравнение с эталонным поведением `gitmark map` на фикстуре (те же узлы/рёбра на маленьком корпусе).
- **Integration:** A2 потребляет `KnowledgeMapDto` через `window.electronAPI.buildKnowledgeMap()`.

### A2 — UI карты знаний (owner: worker `km-ui`)

- **Inputs:** §3.2, §4 (ключи), `@rox/ui` `Markdown` (`mode="minimal"`), токены Rox, образцы секций `SettingsSection`/`SettingsCard`, существующие страницы `ContextSettingsPage.tsx`/`AccountSettingsPage.tsx`.
- **Produces:** `renderer/components/knowledge-map/{KnowledgeMapPanel.tsx,KnowledgeMapGraph.tsx,KnowledgeMapTree.tsx,KnowledgeMapDocView.tsx,radial-layout.ts,knowledge-map-model.ts}` + интеграция: секция «Карта знаний» в `ContextSettingsPage` (полная карта с режимами Граф/Дерево/Документ, поиск, «Перестроить», «Вписать», зум) и карточка в `AccountSettingsPage` (статистика + мини-граф + «Открыть полную карту»).
- **Acceptance:** карта строится автоматически при открытии; при изменении контекст-документа (событие `onContextDocsChanged`) обновляется; клик по узлу открывает документ; пустой корпус показывает пустое состояние с текстом из ключей; все строки — из §4; никаких новых зависимостей; SVG статичен и доступен с клавиатуры (фокус-узлы, Enter = открыть).
- **Work:** чистая раскладка (юнит-тесты: уровни BFS, сумма углов = 2π, оборванные узлы на внешнем кольце, один узел, пустой граф), компонент графа (зум/панорама/подписи/легенда областей), дерево (сворачиваемые группы областей), просмотр документа, интеграция в две страницы.
- **Verification:** `bun test` новых тестов; `cd apps/electron && bunx tsc --noEmit`; живой прогон L2 (скриншот обеих точек входа, проверка узлов/связей).
- **Integration:** обе страницы остаются единственными потребителями компонента.

### B1 — Ядро Rox History (owner: worker `clip-core`)

- **Inputs:** §3.1; образцы: `main/handlers/voice-clipboard.ts` (фенсинг владельца, `access:'write'`), `main/browser-cookie-auto-import.ts` (ленивый `node:sqlite`), `main/meetings/local-store.ts` (структура модуля-стора без electron), `packages/shared/src/protocol` (push).
- **Produces:** `ClipboardHistoryStore`, `ClipboardMonitor`, `registerClipboardHistoryGuiHandlers(server, deps)` + `startClipboardMonitor(deps)`; DDL, миграции `user_version`, дедуп-всплытие, поиск, теги, счётчики тегов, удаление/очистка с удалением файлов картинок, уборка по ретеншну и лимиту, настройки (чтение/запись с валидацией значений), статистика; монитор с адаптером буфера.
- **Acceptance:** все каналы §3.1 отвечают по контракту; дедуп не создаёт вторую строку, а обновляет `created_at`; избранное не удаляется уборкой; удаление записи удаляет файл картинки; `clipboard:copy` пишет текст/картинку в системный буфер и требует владельца окна; монитор: захват текста, всплытие, пропуск conceal-форматов, GIF по `readBuffer`, игнор собственных записей, интервал 300→750 мс; при отсутствии `node:sqlite` — фича отключается fail-soft (каналы возвращают пустой результат/ошибку «недоступно»), процесс жив.
- **Work:** store → монитор → хендлеры → юнит-тесты на временном каталоге и фейковом адаптере.
- **Verification:** `bun test apps/electron/src/main/clipboard-history/__tests__` (store/monitor/handlers), включая негативные: битый `history.db` (пересоздание), превышение лимитов, пустой `q`, изображение без формата, отсутствие `readBuffer` в адаптере.
- **Integration:** W0 регистрирует хендлеры; B2 потребляет через `electronAPI`.

### B2 — UI Rox History (owner: worker `clip-ui`)

- **Inputs:** §3.1, §4 (ключи), образцы плотного списка (`components/memory/repo/MemoryRepoFilesPanel.tsx`), модальный просмотр (`components/...` quick look-аналог), токены/motion Rox.
- **Produces:** `pages/ClipboardHistoryPage.tsx` + `components/clipboard-history/{ClipboardHistoryPanel.tsx,ClipboardCard.tsx,ClipboardQuickLook.tsx,ClipboardTagBar.tsx,ClipboardHistorySettings.tsx,clipboard-history-model.ts,useClipboardHistory.ts}`.
- **Acceptance:** список с пагинацией 50 + префетч; вкладки «История»/«Избранное»; поиск с debounce 150 мс; фильтры типа и тегов; карточки текста/изображений с миниатюрой, мета `W×H · размер`, тегами, датой, звёздочкой; действия копировать/избранное/теги/удалить/просмотр; быстрый просмотр (полное изображение/полный текст, метаданные, Esc); настройки (захват, изображения, ретеншн, лимит, конфиденциальное, хоткей) с сохранением и тостом; клавиатура ←/→/↑/↓, Enter, Space, ⌘F, ⌫; пустые состояния и состояния ошибки; всё — из ключей §4; никаких плавающих окон/мини-режима.
- **Work:** модель (чистые функции) → хук (запросы + `onClipboardChanged` + debounce) → карточки/список → быстрый просмотр → настройки → клавиатура/доступность.
- **Verification:** `bun test` новых тестов (модель + сценарные DOM), `tsc --noEmit`; живой прогон L2.
- **Integration:** экран открывается из рейла и из омнибокса; панель — обычная панель стека (можно держать рядом с чатом).

---

## 7. Решения и альтернативы

1. **Место карты знаний.** Рассматривались: сессионный инспектор (новая секция), отдельный экран, страницы «Аккаунт»/«Контекст». Выбрано: **профиль + контекст** (дословная формулировка ТЗ «либо… либо»); инспектор не трогаем — S-10 запрещает плодить поверхности, а инспектор требует 5 правок швов и даёт мало пользы для «быть в курсе».
2. **Источник данных карты.** Рассматривались: notes-индекс (`vault-index`, нужен `bun:sqlite`, в Electron main недоступен — fail-soft), отдельная БД, сканирование fs. Выбрано: **чистое fs-сканирование** в server-core — детерминировано, без новых зависимостей, работает и в headless-сервере, и в приложении.
3. **Раскладка графа.** Рассматривались: существующий `SvgMindMapView` (LR-дерево; радиального варианта нет) и `@xyflow/react` (сила/сетка). Выбрано: **свой радиальный SVG** по алгоритму донора (BFS-уровни + веса поддеревьев) — это ровно тот визуал, который просил пользователь, и он тестируется как чистая функция.
4. **Хранилище истории буфера.** Рассматривались: server-core (Bun, `bun:sqlite`) и Electron main (`node:sqlite`). Выбрано: **Electron main** — монитору нужен `clipboard`, а гонять каждый тик через RPC в сервер бессмысленно; `node:sqlite` в main уже используется (`browser-cookie-auto-import.ts`), доступ ленивый.
5. **Изображения.** Рассматривались: BLOB в SQLite (как у донора) и файлы на диске + миниатюра в БД. Выбрано: **файлы + миниатюра-BLOB** — БД остаётся маленькой, экспорт/уборка прозрачны.
6. **Глобальный хоткей.** Оставлен настройкой, **по умолчанию выключен** (`⌘⇧V` занят в браузерах/терминалах; глобальный перехват ломает чужие приложения). Основной путь запуска — омнибокс (лончер) и пункт рейла.
7. **Что «остальной функционал» донора.** Явно исключены голос/hub/агент/OCR/сниппеты/коллекции: они либо требуют внешних рантаймов и нативных хелперов, либо дублируют уже существующие возможности Rox. Это записанное решение, а не «отложено».
8. **Расширение vs отдельное приложение.** Донор — отдельное Tauri-приложение; по ТЗ фича встраивается в Rox. Поэтому — first-party `craft-native`-запись в Центре расширений + экран внутри оболочки; отдельного процесса/окна нет.
9. **Совместимость с «Mac».** Захват и копирование — через Electron `clipboard` (macOS: работает; скрытые типы через `availableFormats`/`readBuffer` с fail-soft). Вставка в чужое приложение не автоматизируется (нужен Accessibility-хелпер) — копирование в системный буфер вместо авто-вставки.

---

## 8. Верификация поставки

### 8.1 Гейты (лид, один прогон на объединении)

1. `bun run lint:i18n:sorted` (`scripts/sort-locales.ts --check`) → EXIT=0.
2. `bun run lint:i18n:parity` (`scripts/check-i18n-parity.ts`) → паритет 12 локалей (11 не-en против en), 0 fail.
3. `bun run lint:i18n:coverage` (`scripts/check-i18n-coverage.ts`) → 0 отсутствующих ключей.
4. `bun test packages/shared/src/i18n` → 311+ pass / 0 fail.
5. `bun test apps/electron/src/shared/__tests__/ipc-channels.test.ts apps/electron/src/main/handlers/__tests__/registration.test.ts` → снапшот и паритет регистрации совпадают.
6. `bun test packages/server-core/src/knowledge/__tests__ packages/shared/src/extensions apps/electron/src/main/clipboard-history apps/electron/src/renderer/components/clipboard-history apps/electron/src/renderer/components/knowledge-map` → 0 fail.
7. `bun run typecheck:all` → 0 ошибок (или, минимум: `packages/shared`, `packages/server-core`, `apps/electron`, `packages/core`, `packages/ui`).
8. Линт на изменённых не-тестовых файлах (`cd apps/electron && bun run lint`, при новых токенах — `bun run lint:ui-tokens --check`) → без новых нарушений бакета.
9. `git diff --stat origin/main..HEAD` — ревизия границ (только ожидаемые файлы).

### 8.2 Живая приёмка (macOS, изолированный профиль)

1. Сборка: `cd apps/electron && bun run build && bun run build:renderer` (при необходимости — `bun run dist:mac`), запуск с `ROX_CONFIG_DIR=<tmp>` и `--remote-debugging-port`.
2. **Rox History:** `printf 'rox-history-smoke-<ts>' | pbcopy` → подождать 1.5 с → открыть экран «История буфера» → в DOM присутствует текст записи; скриншот; затем `clipboard:copy` из карточки и проверка содержимого системного буфера (`pbpaste`) + негативные: поиск несуществующей строки → пустое состояние, удаление записи убирает её из списка, «Избранное» сохраняет после удаления обычных.
3. **Карта знаний:** подготовить `<tmp>/context/{soul.md,rules.md,user-notes.md}` со ссылками `[[...]]` и рабочее пространство с 2–3 заметками → открыть «Настройки → Контекст» → узлы/рёбра видны, статистика ненулевая; изменить документ и убедиться, что карта пересобралась; скриншот; карточка в «Настройки → Аккаунт» ведёт на полную карту.
4. **Расширение:** «Настройки → Расширения» содержит «Rox History» со статусом включено (скриншот).
5. Все скриншоты — в `~/Pictures/Shots/rox-history-20261009-<...>/`; текстовые доказательства (DOM-выдержки, `pbpaste`) — в лог сессии.

### 8.3 Документация и поставка

- Этот план + запись-указатель в `docs/plan.md`; краткая справка `docs/clipboard-history.md` (что хранится, где лежит БД, приватность, как очистить) и раздел про карту знаний в том же документе либо отдельным файлом.
- Коммиты: W0 → `feat(wiring): ...`, A1/A2 → `feat(knowledge-map): ...`, B1/B2 → `feat(rox-history): ...`, фиксапы — отдельными коммитами; PR в `main`, merge; readback `git log origin/main` + `git status`.

### 8.4 Failure modes, которые обязаны быть покрыты

| Риск | Проверка |
|---|---|
| `node:sqlite` недоступен в Electron | Фейковый отказ импорта → фича fail-soft, приложение работает |
| Битый/старый `history.db` | Тест пересоздания схемы по `user_version` |
| Огромный текст/картинка | Пропуск (>1 МиБ текста; 20 МиБ картинки), метрики без падения |
| Конфиденциальные записи | Формат `ConcealedType` → запись не создаётся |
| Гонка «своя запись → захват» | После `clipboard:copy` следующая запись не дублируется |
| Отсутствующие заметки/контекст | Пустая карта + пустое состояние (не ошибка) |
| Гигантский vault | `truncated=true`, лимит 400 документов, UI сообщает «Показаны N из M» |
| Сырые i18n-ключи в UI | `check-i18n-coverage` + живой прогон |

---

## 9. Прогресс и восстановление

- [x] W0 — проводка (channels/DTO/electronAPI/channel-map/снапшот/регистрация/роут-панель-навигация/омнибокс/реестр расширений/97 ключей × 12 локалей)
- [x] A1 — ядро карты знаний (чистый сканер + RPC + 14→16 тестов)
- [x] A2 — UI карты знаний (радиальная раскладка/дерево/документ + профиль + контекст)
- [x] B1 — ядро Rox History (store/monitor/хендлеры; 24→39 тестов)
- [x] B2 — UI Rox History (экран/карточки/быстрый просмотр/настройки/пейджинг)
- [x] L1 — гейт (см. «Доказательства»)
- [x] L2 — живой прогон (обнаружил и закрыл блокер Electron 44; см. ниже)
- [x] L3 — состязательный ревью (2 линзы: корректность и безопасность/приватность) + фиксапы F1–F6
- [ ] L4 — документация, коммиты, PR, merge

### Доказательства (по ревизии дерева на момент прогона)

**Функциональные гейты**

| Гейт | Команда | Наблюдение |
|---|---|---|
| Типы (shared/server-core) | `cd packages/{shared,server-core} && bun run tsc --noEmit` | 0 ошибок (после починки тест-фикстуры `total` и вызова `registerKnowledgeMapHandlers(server)`) |
| Целевые тесты (объединение) | `bun test apps/electron/src/main/clipboard-history apps/electron/src/main/openclaw-host-control.test.ts apps/electron/src/renderer/components/{clipboard-history,knowledge-map} packages/server-core/src/knowledge/__tests__ packages/shared/src/extensions apps/electron/src/shared/__tests__/ipc-channels.test.ts packages/shared/src/protocol/__tests__` | **430 pass / 0 fail** (51 файл) |
| i18n | `bun run lint:i18n:sorted` / `:parity` / `:coverage` | EXIT=0; parity 11 локалей × 9940 ключей; coverage 8811 ссылок / 6266 уникальных ключей |
| Рейтинг eslint (server-core) | `bun run scripts/eslint-workspace-ratchet.ts --check` | OK — нет новых нарушений |
| UI-токены (ратчет) | `bun run lint:ui-tokens` | после чистки F4/R1/R2 — без роста (см. журнал прогона) |
| Живой прогон Electron | `electron apps/electron` c `ROX_CONFIG_DIR` + CDP | окно поднимается, оболочка рендерится; хранилище `history.db` создано (таблицы, `user_version=1`, WAL) |

**Живой прогон нашёл блокер, который не видели юнит-тесты (закрыт):** в этой сборке Electron (44.7.0) модуль `clipboard` — **асинхронный W3C-подобный**: есть только `readText/writeText/read/has/write/clear`; легаси-методы `availableFormats/readImage/readBuffer/writeBuffer` **отсутствуют**. Монитор падал каждый тик (`clipboard.availableFormats is not a function`). Ядро переписано на реальный API (асинхронный адаптер: `readText/readTypes/hasRawFormat/readTypeBytes/writeText/writeTypeBytes/decodeImage`), миниатюры — через `nativeImage` (не `sharp`). Отдельным скриптом-зондом на реальном Electron подтверждено: `has('electron application/osclipboard;format="org.nspasteboard.ConcealedType"')` возвращает `true` после нашей «скрытой» записи, а `clipboard.write([new ClipboardItem({...})])` переносит и текст, и маркер конфиденциальности (это же делает `conceal.ts`).

**Второй блокер живого прогона (закрыт):** `ClipboardItem` в main-процессе — **не глобал, а экспорт модуля** (`typeof globalThis.ClipboardItem === 'undefined'`, `typeof require('electron').ClipboardItem === 'function'` — проверено зондом). Из-за использования глобала «скрытая» запись молча падала в fallback `writeText` (и история её сохраняла), а копирование изображения из истории бросало исключение. Исправлены `conceal.ts` и адаптер записи; добавлен регрессионный тест (`conceal.test.ts`, мок `electron` без глобала), который падал бы до фикса.

### Итоговая живая приёмка (изолированный профиль, macOS, `ROX_CONFIG_DIR` + CDP)

`bash ~/Projects/archive/rox-verify-history/live-launch.sh` → `bash …/live-accept.sh` — **RESULT: PASS** (все 9 сценариев):

| # | Проверка | Наблюдение |
|---|---|---|
| 1 | Захват текста | `pbcopy 'rox-history-smoke-<ts>'` → запись в истории (`clipboard:list`) |
| 2 | Экран «История буфера» | запись видна в DOM; окно-скриншот + OCR: «История буфера 10 записей», вкладки «История»/«Избранное», «Поиск по истории», фильтры «Все/Текст/Изображения», карточка изображения «4112×2658 • 2.5 MB» |
| 3 | Поиск/избранное/копирование | поиск несуществующего → 0; избранное читается обратно; `clipboard:copy` → `pbpaste` содержит запись; теги нормализуются (`['demo','привет']`) |
| 4 | Захват изображения | `screencapture` → `set the clipboard to PNGf` → запись с форматом, размерами и миниатюрой |
| 5 | Конфиденциальность | `clipboard:writeConcealed` → запись **не** попадает в историю (`hideSensitive=true`) |
| 6 | Карта знаний (Контекст) | секция «Карта знаний», режимы Граф/Дерево/Документ, статистика «Документы: 7 · Связи: 11 · Области: 2 · Объём: 1 165», узлы `soul`/`rules`/`user-profile` |
| 7 | Карта знаний (Профиль) | секция «Карта знаний», «7 документов · 11 связей · 2 областей», кнопка «Открыть полную карту» |
| 8 | Центр расширений | записи `builtin:clipboard-history` и `builtin:knowledge-map` — «Rox History v1.0.0 · Включено · Приложения · installed» и «Карта знаний v1.0.0 · Включено» (DOM + OCR + `extensionsListInstalled`) |
| 9 | Настройки | сохранение/чтение настроек истории (ретеншн/лимит/хоткей), статистика и счётчики тегов |

Артефакты живого прогона: `~/Pictures/Shots/rox-history-20261009/` (PNG + OCR-выгрузки), дампы и логи — `~/Projects/archive/rox-verify-history/out/`.

**Состязательный ревью (2 линзы, 0 блокеров / 6 major / 9 minor) — все findings закрыты:**

| Finding | Фикс |
|---|---|
| Захват изображений гейтился по списку форматов (второй скриншот не захватывался) | F3: контентный отпечаток (`lastImageHash`, только после успешного захвата) + троттлинг 1200 мс |
| Пустая середина-навигатор рядом с экраном Rox History | F4: `hideModuleMiddleNav` + убран `clipboard-history` из `serviceHasNavigator` |
| `clipboard:copy` молча писал пусто (GIF/отсутствующие байты) | F3: GIF — сырые байты через `writeTypeBytes`, пустая картинка/нет байтов — явная ошибка |
| Все текстовые карточки с бейджем «Изображение» | F4: бейдж только для изображений |
| Быстрый просмотр мог показать предыдущую запись | F4: guard по id + сброс `detail` |
| `writeText` не ожидался (конвенция Electron 44) | F3: `await` |
| Кэш монитора не сбрасывался после «Очистить»/удаления | F3: `resync()` |
| Английские id областей в графе карты | F5: `t(AREA_LABEL_KEYS[area])` |
| Панель подписывалась «Панель» | F4: `resolveRouteTitle` для нового типа панели |
| Список молча ограничивался 500 строками | F4: пейджинг по `offset` |
| Секреты Rox (токен OpenClaw, invite-токен) попадали в историю | F5: примитив `writeClipboardTextConcealed` + канал `clipboard:writeConcealed`, оба места переведены |
| Неограниченный LIKE-запрос (синхронный main-поток) | F3: обрезка `q` до 256 символов |
| Документация не упоминала, что удаление не стирает байты | F5: раздел «Удаление» в `docs/clipboard-history.md` |
| «Осиротевшие» файлы картинок при сбое INSERT | F3: unlink при ошибке |
| Настройка глобального хоткея была инертной | F6: реальная регистрация через `globalShortcut` + навигация через `handleDeepLink('rox://clipboard-history', …, 'app')` |

**Известные ограничения и решения (записаны осознанно):**
- Каналы фичи классифицированы как `LOCAL_ONLY` (routing) и обслуживаются локальным Electron-сервером; `clipboard:copy`/`writeConcealed` дополнительно требуют `access: 'localElectron'` и владельца окна. Явный `access: 'localElectron'` на все каналы не ставился: на десктопе `requireAuth` уже включает локальный гейт (`shouldEnforceLocalOnly()`), а фактические данные лежат в профиле пользователя.
- `sourceApp` всегда `null`, список исключённых приложений не реализован: у Electron-клипа нет доступа к активному приложению (осознанное ограничение донорского паритета).
- Глобальный хоткей по умолчанию выключен (⌘⇧V занят другими приложениями), основной путь — омнибокс/рейл.
- Текстовые карточки не имеют бейджа типа: под подходящее значение нет i18n-ключа, а выдумывать строки запрещено правилами репозитория.

**Предсуществующая краснота (не наш дефект, подтверждена на чистой базе `bec727f04` в отдельном ворктри):** `apps/electron/src/main/handlers/__tests__/registration.test.ts` падает и на базе — 18 «unexpected» каналов (`commands:*`, `directory:exportDossier`, `voice:*`) и таймаут 5 с. Два `react-hooks/rules-of-hooks` в тест-харнессах `useDomForFile()` воспроизводятся на существующих файлах репозитория (`BrowserIntelOptIn.test.tsx`, `mention-roundtrip.test.ts`); тесты исключены из UI-ратчета.