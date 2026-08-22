# Архитектурные свидетельства — четыре кандидата на углубление + Gate 0

**Дата:** 2026-08-13  
**Режим:** сбор свидетельств в режиме «только чтение» (без реализации)  
**Словарь:** модуль, интерфейс, шов, глубина, адаптер, рычаг, локальность  
**Файлы статусов:** G2 OPEN → `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md`; G1 TBD → `docs/specs/2026-08-07-siyuan-integration/g1-metrics.md`  
**Цель Gate 0 (ОТСУТСТВУЕТ):** `docs/security/external-access-deployment-contract.md` (запланирован; каталог создан только этой запиской)

---

## Краткие формулировки кандидатов

1. **Корневая политика — вычисление при загрузке модуля:** `CONFIG_DIR` — единственная константа, вычисляемая при загрузке модуля (`paths.ts:19`); локальность заметок воркспейса по умолчанию — `CONFIG_DIR/workspaces/{id}/notes` через `storage.ts` + опциональный шов `WorkspaceConfig.notesPath` — ни один модуль политики путей не оценивает намерения вызывающего до обращения к диску.
2. **knowledge:migrateNotes — удалённо допустимый локальный путь:** `MIGRATE_NOTES` имеет статус REMOTE_ELIGIBLE (`routing.ts:500`), при этом обработчик принимает абсолютный `sourceRoot` и пишет локальные заметки (`knowledge.ts:1620–1643`, `notes-migration.ts:505–511,1207–1212`) — удалённая глубина поверх адаптера импорта локальной файловой системы.
3. **Универсальный индекс Sources как точка входа контекста агента:** текст из локальных путей сохраняется целиком в SQLite FTS (`source-index.ts:body_text`) и внедряется в системный промпт агента при старте сессии (`SessionManager.ts:4158–4166` → `retrieveSourcesForPrompt` / `formatSourceRetrieveForPrompt`).
4. **Политика учётных данных/путей:** секреты живут только в `StoredCredential.value` (`types.ts:110–112`); identity хранит непрозрачный `credentialRef` (`identity/types.ts:50–51`), тогда как RPC принимает сырой `credentialValue` и немедленно вызывает `manager.set` (`identity.ts:37–42,171–200`).

---

## 1) Корневая политика — вычисление при загрузке модуля

### Модуль: `packages/shared/src/config/paths.ts` (весь модуль = 20 строк)

```1:19:packages/shared/src/config/paths.ts
/**
 * Centralized path configuration for Craft Agent.
 * ...
 * Default (non-numbered folders): ~/.craft-agent/
 */
import { homedir } from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.craft-agent/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent');
```

**Примечание о глубине:** единственная экспортируемая константа, вычисляемая при загрузке модуля. Нет интерфейса для списков разрешённых путей, нет адаптера для мультитенантной локальности. `CRAFT_CONFIG_DIR` — единственный шов переопределения.

### Кто импортирует `CONFIG_DIR` (пакеты — список не исчерпывающий, высокий рычаг)

| Импортёр | Использование |
|---|---|
| `packages/shared/src/workspaces/storage.ts:31,42` | `DEFAULT_WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces')` |
| `packages/shared/src/interceptor-common.ts:14,30,39` | `config.json`, логи под CONFIG_DIR |
| `packages/shared/src/release-notes/index.ts:14,16` | `join(CONFIG_DIR, 'release-notes')` |
| `packages/shared/src/docs/index.ts:15,17` | `join(CONFIG_DIR, 'docs')` |
| `packages/server/src/index.ts:41,224` | пути обмена сообщениями под CONFIG_DIR |
| `packages/server-core/src/handlers/rpc/identity.ts:9` | хранилище Identity + подключения knowledge под CONFIG_DIR |
| `apps/electron/src/main/index.ts` | ядро WorkGraph `configDir: CONFIG_DIR` |
| `apps/electron/src/main/window-state.ts` | `window-state.json` под CONFIG_DIR |
| `apps/electron/src/main/handlers/extension-host.ts` | локальность списка разрешённых URL под CONFIG_DIR |

Скрипты (`runtime-context-smoke.ts`, `marketplace-smoke.ts`, `toolchain-*-smoke.ts`) требуют внешнего `CRAFT_CONFIG_DIR` под `/tmp` до динамического импорта — это подтверждает, что CONFIG_DIR фиксируется при вычислении модуля.

### Шов пути заметок — первые 40 строк `storage.ts` + инициализация заметок

```1:42:packages/shared/src/workspaces/storage.ts
/**
 * Workspace Storage
 * ...
 * Default location: ~/.craft-agent/workspaces/
 */
// ...
import { CONFIG_DIR } from '../config/paths.ts';
// ...
const DEFAULT_WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces');
```

```395:399:packages/shared/src/workspaces/storage.ts
  // Seed credentialed API templates as disabled; they are never workspace defaults.
  ensureBuiltinSources(rootPath);

  // The default Notes source must exist before a session resolves these defaults.
  ensureLocalNotesSource(rootPath, join(DEFAULT_WORKSPACES_DIR, config.id, 'notes'));
```

### Интерфейс `WorkspaceConfig.notesPath`

```68:72:packages/shared/src/workspaces/types.ts
  /**
   * Custom notes storage path. When set, notes are stored here instead of the
   * default ~/.craft-agent/workspaces/{id}/notes/. Points at an Obsidian vault
   * or any existing markdown directory.
   */
  notesPath?: string;
```

### Адаптер локального источника Notes записывает путь в конфиг источника

```194:210:packages/shared/src/sources/builtin-sources.ts
export function ensureLocalNotesSource(workspaceRootPath: string, notesPath: string): void {
  // ...
  local: {
    path: toPortablePath(notesPath),
    format: 'craft-markdown',
  },
```

### Локальность разрешения (server-core, не shared)

| Модуль | Строки | Поведение |
|---|---|---|
| `handlers/rpc/notes.ts` | 81–88 | `config?.notesPath`, иначе `join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR)` |
| `handlers/rpc/sources.ts` | 29–30 | тот же дефолт; вызывает `ensureLocalNotesSource` |
| `handlers/rpc/settings.ts` | 144,159,192–197 | `notesPath` — ключ настройки воркспейса, доступный для записи |
| `knowledge/notes-migration.ts` | 505–511 | `resolveWorkspaceNotesRoot` дублирует приоритет из notes.ts |

**Разрыв рычага:** политика путей размазана между константой конфигурации + полем конфигурации воркспейса + несколькими хелперами разрешения; нет единого модуля корневой политики, который оценивал бы абсолютные пути до обращения к диску со стороны импорта/индексации/учётных данных.

---

## 2) `knowledge:migrateNotes` — удалённо допустимый локальный путь

### Шов маршрутизации — REMOTE_ELIGIBLE

```490:501:packages/shared/src/protocol/routing.ts
  // knowledge — P5 saved views + work envelopes ...
  RPC_CHANNELS.knowledge.WATCH,
  RPC_CHANNELS.knowledge.UNWATCH,
  RPC_CHANNELS.knowledge.MIGRATE_NOTES,
  RPC_CHANNELS.knowledge.METRICS_GET,
```

Идентификатор канала: `packages/shared/src/protocol/channels.ts:183` → `'knowledge:migrateNotes'`.

Ассерт в тесте:

```133:137:packages/shared/src/protocol/__tests__/routing.test.ts
  test('knowledge P4.4 migrateNotes is REMOTE_ELIGIBLE', () => {
    for (const ch of P4_MIGRATE_CHANNELS) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true)
      expect(LOCAL_ONLY_CHANNELS.has(ch)).toBe(false)
    }
  })
```

Для сравнения: `ENGINE_STATUS` / `DETECT_ENGINE` / `ENGINE_START` — LOCAL_ONLY (тот же тестовый файл:140–147).

### Обработчик — принимает абсолютный `sourceRoot`, локальное назначение

```1620:1643:packages/server-core/src/handlers/rpc/knowledge.ts
  // ——— MIGRATE_NOTES({workspaceId, sourceRoot, format?}) → MigrateNotesResult ———
  // User-initiated local import into the Markdown Notes store. It has no
  // knowledge-provider, credential, or network dependency.
  server.handle(
    RPC_CHANNELS.knowledge.MIGRATE_NOTES,
    async (_ctx, args: MigrateNotesArgs): Promise<MigrateNotesResult> => {
      // ...
      const rootPath = requireWorkspaceRoot(args.workspaceId)
      const notesRoot = resolveWorkspaceNotesRoot(args.workspaceId)
      try {
        const result = await importNotes({
          workspaceRoot: rootPath,
          sourceRoot: args.sourceRoot,
          destinationRoot: notesRoot,
          format: args.format,
        })
```

Комментарий обработчика заявляет семантику «только локально»; маршрутизация классифицирует канал как удалённую глубину уровня владельца воркспейса.

### Входной модуль — `notes-migration.ts`

Заголовок + локальность карты:

```1:19:packages/server-core/src/knowledge/notes-migration.ts
/**
 * Local Craft Markdown Notes import.
 *
 * Import state is stored at `{workspaceRoot}/.craft/notes-migration-map.json`.
 * The importer only reads the selected source vault and writes into the existing
 * local Markdown Notes root. ...
 */
export const NOTES_MIGRATION_MAP_RELATIVE = join('.craft', 'notes-migration-map.json')
export const CRAFT_MARKDOWN_IMPORT_FORMAT = 'craft-markdown' as const
```

Интерфейс аргументов (на этапе разрешения требуется абсолютный путь):

```115:121:packages/server-core/src/knowledge/notes-migration.ts
export interface MigrateNotesArgs {
  workspaceId: string
  /** Absolute source vault root chosen by the user. */
  sourceRoot: string
  /** Defaults to the only supported local format, `craft-markdown`. */
  format?: string
}
```

Разрешение назначения (шов переопределения notesPath):

```505:511:packages/server-core/src/knowledge/notes-migration.ts
export function resolveWorkspaceNotesRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.notesPath) return config.notesPath
  return join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR)
}
```

Проверка абсолютного пути у корня импорта:

```513:527:packages/server-core/src/knowledge/notes-migration.ts
async function resolveSelectedImportRoot(sourceRoot: string): Promise<string> {
  if (!sourceRoot || !isAbsolute(sourceRoot)) {
    throw new NotesImportError('Selected notes import root must be an absolute path')
  }
  // realpath + isDirectory ...
}
```

Публичная точка входа:

```1203:1212:packages/server-core/src/knowledge/notes-migration.ts
/**
 * Generic import entry point. It deliberately accepts only Craft Markdown;
 * unsupported formats fail before the filesystem is touched.
 */
export async function importNotes(options: ImportNotesOptions): Promise<MigrateNotesResult> {
  const format = options.format?.trim() || CRAFT_MARKDOWN_IMPORT_FORMAT
  if (format !== CRAFT_MARKDOWN_IMPORT_FORMAT) {
    throw new NotesImportError(`Unsupported notes import format: ${format}`)
  }
  return importCraftMarkdownNotes(options)
}
```

Ограничения (граница глубины обхода, а не удалённая политика): `NOTES_IMPORT_LIMITS` на строках 37–45 (`maxTraversalEntries: 10_000`, `maxDepth: 64` и т.д.).

**Риск углубления:** REMOTE_ELIGIBLE + абсолютный `sourceRoot` означают, что адаптером выступает локальная файловая система хоста-владельца воркспейса; удалённый клиент может запустить импорт по путям хоста, если транспортная аутентификация проверяет только владение воркспейсом.

---

## 3) Универсальный индекс Sources как точка входа контекста агента

### Модуль хранения — полный текст в SQLite

```1:8:packages/server-core/src/sources/source-index.ts
/**
 * source-index — per-workspace SQLite FTS index for local source folders.
 *
 * Path: {workspaceRoot}/.craft/source-index.sqlite
 * Table files(path UNIQUE, hash, chars, tokens, mtime, body_text)
 * Optional FTS5 virtual table files_fts when available; LIKE fallback otherwise.
 */
```

Схема + upsert полного текста:

```172:180:packages/server-core/src/sources/source-index.ts
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY NOT NULL,
        hash TEXT NOT NULL,
        chars INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        mtime INTEGER NOT NULL DEFAULT 0,
        body_text TEXT NOT NULL DEFAULT ''
      )
```

```291:336:packages/server-core/src/sources/source-index.ts
/**
 * Index one root directory into the workspace source index.
 * Paths are stored as `{sourceSlug}/{relPath}` when sourceSlug is provided, ...
 */
export function indexSourceTree(...) {
  // walkSourceTree reads file bodies; upsert:
  INSERT INTO files (path, hash, chars, tokens, mtime, body_text)
  VALUES (?, ?, ?, ?, ?, ?)
  // body_text = f.body
}
```

Лимиты: `MAX_FILES=2000`, `MAX_FILE_BYTES=512KiB`, `MAX_TOTAL_BYTES=32MiB`, `MAX_BODY_CHARS=200_000` (строки 77–80). Текстовые расширения включают исходники и конфигоподобные файлы (исключение среди скрытых — `.env.example`; строки 32–62, 244–246).

### Интерфейс извлечения для внедрения в промпт

```116:134:packages/server-core/src/sources/source-index.ts
/** Retrieved hit with a budgeted excerpt for system-prompt injection. */
export interface SourceRetrieveHit {
  path: string
  excerpt: string
  rank: number
  tokens: number
}
/** Default token budget for source docs injected into the agent system prompt. */
export const SOURCE_RETRIEVE_MAX_TOKENS = 2000
```

```551:571:packages/server-core/src/sources/source-index.ts
/**
 * Ranked source retrieve for agent system-prompt injection.
 * Greedy-fills hit excerpts by search rank until SOURCE_RETRIEVE_MAX_TOKENS
 * ... Fail-soft: missing index / blank query / errors → empty hits
 */
export function retrieveSourcesForPrompt(
  workspaceRoot: string,
  query: string,
  options: { limit?: number; maxTokens?: number } = {},
): SourceRetrieveResult {
```

### Шов SessionManager (~4161 всё ещё на месте)

```4155:4169:packages/server-core/src/sessions/SessionManager.ts
      let memoryBlocks = managed.memoryMode === 'temporary'
        ? undefined
        : await this.memoryServiceFor(managed.workspace)?.buildMemoryBlocks(...)
      // P2.7: FTS-retrieve local source docs into the same memoryBlocks payload
      // (sourcesBlock). Same memoryQuery as lessons; fail-soft on missing index.
      if (memoryQuery && managed.workspace?.rootPath) {
        try {
          const retrieved = retrieveSourcesForPrompt(managed.workspace.rootPath, memoryQuery)
          const sourcesBlock = formatSourceRetrieveForPrompt(retrieved.hits)
          if (sourcesBlock) {
            memoryBlocks = { ...(memoryBlocks ?? {}), sourcesBlock }
          }
        } catch (err) {
          sessionLog.warn(`Failed to retrieve sources for prompt (${managed.id}):`, err)
        }
      }
```

Адаптер форматирования:

```566:583:packages/shared/src/prompts/system.ts
/**
 * Format FTS-retrieved source docs for system-prompt injection.
 */
export function formatSourceRetrieveForPrompt(hits: SourceRetrieveHit[]): string {
  // emits "[Retrieved source docs]" + "### {path}" + excerpt
}
```

`memoryBlocks` (включая `sourcesBlock`) передаётся в `createBackendFromResolvedContext` на `SessionManager.ts:4189–4194`.

**Рычаг:** один модуль индекса + один шов старта сессии; любой проиндексированный локальный путь становится видимым агенту контекстом без отдельного интерфейса согласия.

---

## 4) Политика учётных данных / путей

### Интерфейс get/set менеджера

```108:142:packages/shared/src/credentials/manager.ts
  /**
   * Get a credential by ID, trying all backends.
   */
  async get(id: CredentialId): Promise<StoredCredential | null> {
    await this.ensureInitialized();
    for (const backend of this.backends) {
      // backend.get(id) → return first hit
    }
    return null;
  }

  /**
   * Set a credential using the write backend.
   */
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    await this.ensureInitialized();
    if (!this.writeBackend) {
      throw new Error('No writable credential backend available');
    }
    await this.writeBackend.set(id, credential);
  }
```

Бэкенд: только `SecureStorageBackend` (manager.ts:55–60, 68–70) — зашифрованный файл в локальности craft-конфига, а не связка ключей ОС.

### Поле секрета — `StoredCredential.value`

```110:112:packages/shared/src/credentials/types.ts
export interface StoredCredential {
  /** The secret value (API key, access token, or primary credential) */
  value: string;
```

Типы учётных данных включают `source_*`, `service_oauth`, `ssh_managed_token`, `openclaw_gateway_token` (types.ts:19–42). Комментарий о формате ключа: `"{type}::{scope...}"` (types.ts:7–14). Комментарий о пути source-учётных данных: `~/.craft-agent/workspaces/{ws}/sources/{slug}/` (types.ts:30).

### Identity RPC — вход сырого `credentialValue`

```37:42:packages/server-core/src/handlers/rpc/identity.ts
export interface IdentityConnectArgs {
  provider: ServiceProvider
  workspaceId: string
  accountLabel?: string
  credentialValue?: string
  connectionId?: string
}
```

```169:200:packages/server-core/src/handlers/rpc/identity.ts
    const requiresCredential = args.provider === 'siyuan-cloud'
    const credentialValue = args.credentialValue?.trim()
    if (requiresCredential && !credentialValue) {
      throw new Error('identity.connect: credentialValue is required for siyuan-cloud')
    }
    // ...
    if (credentialValue) {
      const manager = getCredentialManager()
      await manager.set(
        {
          type: 'service_oauth',
          workspaceId: args.workspaceId,
          name: connection.id,
        },
        {
          value: credentialValue,
          tokenType: 'Bearer',
        },
      )
```

Использует `CONFIG_DIR` для локальности хранилища identity (`identity.ts:9,86`).

### Доменный интерфейс — непрозрачный `credentialRef` (без секрета)

```1:6:packages/core/src/platform/identity/types.ts
/**
 * Identity Center domain contracts (S-07).
 * ...
 * Cloud) attach as ServiceConnection via credentialRef. Secrets never live here.
 */
```

```45:51:packages/core/src/platform/identity/types.ts
export interface ServiceConnection {
  id: string;
  workspaceId: string;
  provider: ServiceProvider;
  accountLabel?: string;
  /** Opaque ref into CredentialManager — never a secret value. */
  credentialRef?: string;
```

Адаптер хранилища выставляет `credentialRef = connection id`, когда присутствует `credentialValue` (`store.ts:212–230`); секрет никогда не сохраняется в identity JSON.

**Итог по швам:** секрет может единожды пройти по проводу RPC (`credentialValue`); персистентный identity хранит только `credentialRef`; глубина секрета — зашифрованное хранилище CredentialManager. Связи с политикой путей нет, кроме локальности CONFIG_DIR для файла identity.

---

## Gate 0 — Безопасность / внешний доступ (ЕСТЬ vs ОТСУТСТВУЕТ)

**Запланированный путь контракта (ОТСУТСТВУЕТ на диске):**  
`docs/security/external-access-deployment-contract.md`  
Указан как цель создания в `docs/superpowers/plans/2026-08-11-security-external-access-implementation-plan.md:36–45` и как задача B0 в `docs/superpowers/plans/2026-08-13-post-research-program-plan.md:74–76`.

**Документы дизайна/планов (ЕСТЬ — но не факты развёртывания):**

| Артефакт | Путь | Роль |
|---|---|---|
| Дизайн | `docs/superpowers/specs/2026-08-11-security-external-access-design.md` | логические истоки, microVM, WebAuthn, набросок DeviceRecord |
| План реализации | `docs/superpowers/plans/2026-08-11-security-external-access-implementation-plan.md` | шаги Gate 0 не отмечены выполненными |
| Программа | `docs/superpowers/specs/2026-08-13-post-research-program.md:15,51` | Gate 0 указан как «сначала спросить» |

### Поиск фактов

| Термин | ЕСТЬ (код) | ЕСТЬ (только в доках) | ОТСУТСТВУЕТ (код + контракт) |
|---|---|---|---|
| `APP_ORIGIN` | — | design:24; plan:14 | Совпадений в `.ts`/`.tsx`/конфигах нет |
| `SHARE_ORIGIN` | — | design:25; plan:14 | Совпадений в коде нет |
| `app.rox.one` | — | design:24 (таблица целей v1) | Совпадений в коде нет |
| `share.rox.one` | — | design:25 | Совпадений в коде нет |
| microVM | — | design:98–117; plan:7,17,31,85–87,398–404 | Нет модуля `SandboxExecutionRunner` / `microvm-runner` в packages |
| Firecracker | — | (в дизайне не назван; стек плана — Docker/VF) | Совпадений в коде нет |
| WebAuthn | — | design:155–163; plan:9,511–540 | Нет модуля WebAuthn в packages |
| DeviceRecord / device store | — | design:160; plan:52–63,470–485 | `packages/server-core/src/webui/` содержит только парольную JWT-аутентификацию (`auth.ts:1–8,18–22`); нет `device-store.ts` |
| SPKI pin | **ДА** — `packages/shared/src/config/remote-tls-trust.ts:41–83`; тип `RemoteTlsTrust` в `packages/core/src/types/workspace.ts:18–35`; тесты + нормализация в storage | дизайн §3 remote trust | Глубина UI регистрации/handshake на стороне приложения может быть частичной; **модуль политики пина существует** для TLS удалённого воркспейса |
| дайджест sandbox-образа | — | план, шаг 3 Gate 0 (image digest/signer) | Нет константы дайджеста образа или модуля верификации |
| Catalog SPKI (не относится) | **ДА** — SPKI подписи каталога маркетплейса (`catalog-signing.ts:14–21`) | — | Не device/TLS-пин для Gate 0 |

### Существующая глубина аутентификации webui (не DeviceRecord)

```1:8:packages/server-core/src/webui/auth.ts
/**
 * Web UI session authentication.
 * Cookie-based JWT session auth for the browser-served web UI.
 * - Login: verify password → issue signed JWT → set HttpOnly cookie
 */
```

Клеймы JWT: только `sub`, `iat`, `exp` (`auth.ts:18–22`) — нет `deviceId` / `sessionVersion` из дизайна Gate 0.

### Рантайм песочницы сегодня

`packages/session-tools-core/src/runtime/` содержит `filesystem-isolation`, `network-isolation`, `path-security`, `sandbox-env`, `resolve-script-runtime` — **нет** `sandbox-execution.ts` / `microvm-runner.ts` (это цели создания по плану: plan:346–403).

---

## Статусы G2 / G1 (обязывающие продуктовые блокировки)

| Гейт | Путь | Цитата статуса |
|---|---|---|
| **G2** | `/Users/marklindgreen/Projects/craft-agents/docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md` | L3: `Статус: OPEN — заблокировано ожиданием юридического/коммерческого решения`; L33: `До тех пор **P7 managed не стартует.**` |
| **G1** | `/Users/marklindgreen/Projects/craft-agents/docs/specs/2026-08-07-siyuan-integration/g1-metrics.md` | L66–73: все пороги **TBD**; L75: `P7 managed заблокирован`, пока пороги не заполнены **и** G2 не получит ACCEPTED |

Кросс-ссылка: `docs/specs/2026-08-10-rox-notes-root-imports-design.md:20` — G2 OPEN + G1 TBD блокируют дистрибуцию движка.

---

## Список отсутствующего для Gate 0 (компактно)

1. `docs/security/external-access-deployment-contract.md` — не заполнен (артефакт Gate 0 отсутствует).  
2. Именованный владелец персистентного **хранилища device-record** + модель транзакций — отсутствуют в репозитории.  
3. Владение **APP_ORIGIN / SHARE_ORIGIN** + привязка к живым hostname — только дизайн; ноль кода.  
4. **app.rox.one / share.rox.one** — только целевые значения дизайна; ноль кода.  
5. Модули **WebAuthn** / сопряжения passkey — только дизайн/план.  
6. Реализация интерфейса **DeviceRecord** + адаптер `device-store` — путей из плана нет под `webui/`.  
7. Раннер **microVM** / **Firecracker** / Virtualization.framework + **дайджест/подписант sandbox-образа** — только план; в рантайме есть изоляция env/путей, а не microVM.  
8. Модуль интерфейса **SandboxExecutionRunner** — цель создания из плана отсутствует.  
9. Эмитент capability управления share / публичные материалы верификации — шаг 2 Gate 0 не отмечен выполненным.  
10. Записи о владении reverse-proxy / службой выдачи секретов — шаги 1–4 Gate 0 не отмечены выполненными.

**Частично ЕСТЬ (не выдавать за полноту):** политика нормализации/сохранения **SPKI pin** удалённого воркспейса (`remote-tls-trust.ts`); SPKI каталога маркетплейса (ортогонально); парольная JWT webui (`webui/auth.ts`).

---

## Итоговое резюме

**4 краткие формулировки кандидатов:** см. начало записки.  
**Список отсутствующего для Gate 0:** пункты 1–10 выше.  
**Путь G2:** `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md` (OPEN).  
**Путь G1:** `docs/specs/2026-08-07-siyuan-integration/g1-metrics.md` (пороги TBD).
