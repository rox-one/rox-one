# 02-SPEC-foundations — платформенные основы Developer Space + Playbooks

Статус: **DRAFT для ревью**. Источник истины — `00-BRIEF.md` (решения D1–D14, карта фактов, O1–O8).
Документ покрывает платформенный слой обеих поверхностей: гейтинг роли, IA, ингест, пайплайн джобов,
артефакты/хранение, эгресс, агентский доступ, флаги/настройки, i18n, телеметрию, безопасность.
Новые сущности помечены **«новое»**/**«расширение»**; открытые выборы — `TODO(open)` (O-номер).
**Обновление 2026-10-10:** все `TODO(open)` O1–O11 закрыты (см. `07-DECISIONS.md`); маркеры в тексте
оставлены как исторические.

Соглашение о путях: пути существующих файлов даны от корня монорепо `rox-one`. Часть путей брифа
записана от корня пакета приложения (`shared/...`); ниже используется точный фактический путь
(`apps/electron/src/shared/...`).

---

## 1. Архитектурная рамка

### 1.1 Что переиспользуем без изменений

| Подсистема | Точка входа (существующее) | Роль в Dev Space / Playbooks |
|---|---|---|
| Онбординг | `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx`, `apps/electron/src/renderer/hooks/useOnboarding.ts`, `apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx`, `onboarding-username.ts`, `rox-runtime-default.ts` | новый шаг роли (D1) |
| Мастер-флаги | `packages/core/src/platform/workbench/flags.ts` (`WORKBENCH_FLAG`, `WORKBENCH_FEATURE_FLAGS`) | гейт поверхности |
| Extra screens | `packages/core/src/platform/workbench/extra-screen-flags.ts` (`EXTRA_SCREEN_FLAG`) | референс паттерна флага экрана |
| Рендер-атомы флагов | `apps/electron/src/renderer/atoms/{mode-flags,extra-screens,unified-shell}.ts`, ключи `apps/electron/src/renderer/lib/local-storage.ts` (`KEYS`) | хранение пользовательского гейта и напоминаний |
| Настройки | `apps/electron/src/shared/settings-registry.ts` (`SETTINGS_PAGES`), `apps/electron/src/renderer/pages/settings/settings-pages.ts` (`SETTINGS_PAGE_COMPONENTS`), `apps/electron/src/shared/menu-schema.ts` (`SETTINGS_ITEMS`); примеры тумблеров `pages/settings/ExtraScreensSettings.tsx`, `WorkbenchChromeSettings.tsx` (`SettingsToggle`) | страница «Разработчикам» |
| Навигация | `apps/electron/src/renderer/components/app-shell/nav-destinations.ts` (`APP_NAV_DESTINATIONS`, «add once»), потребители `AppShell.tsx` (`links[]`), `platform/ActivityRail.tsx` (rail groups); рендер `MainContentPanel.tsx`; маршруты `apps/electron/src/shared/routes.ts`, типы `apps/electron/src/shared/types` | новый верхнеуровневый пункт (D2) |
| Product-tour | `apps/electron/src/renderer/features/product-tour/` — `contracts/index.ts` (`TourDefinition`, `TourStep`, `TourId/StepId/TargetId/SignalName/CapabilityId/TriggerId/RouteKey`), `catalogue/product-tour-catalogue.ts`, `catalogue/validate.ts`, `core/index.ts`, `runtime/ProductTourProvider.tsx`, `runtime/routes.ts`, `runtime/hooks.tsx` (`useTourTarget`, `useTourSignals`), `ui/SpotlightOverlay.tsx`, `ui/TourPopover.tsx`, `ui/target-registry.ts`, `ui/geometry.ts` | динамические туры (D9, D10) |
| Чат | `apps/electron/src/renderer/pages/ChatPage.tsx`, `components/app-shell/ChatDisplay.tsx`, `components/app-shell/input/{ChatInputZone,InputContainer,FreeFormInput,CompactModelSelector}.tsx`, `hooks/useSessionModelCatalog.ts` | «свой вопрос» (D11) |
| Code Intelligence | `packages/shared/src/code-intelligence/{types,provider,refs,sbom,explainer,local-adapter}.ts`, `packages/server-core/src/handlers/rpc/code-intelligence.ts` | модель репо/снапшота, freshness, SBOM |
| Источники/vault | `packages/server-core/src/sources/source-index.ts` (+facade/watch), `packages/server-core/src/knowledge/vault-index.ts` | retrieval Playbooks, поиск артефактов |
| Документы | `content:*` RPC (`packages/shared/src/protocol/channels.ts`), `packages/server-core/src/docs/markdown-commit.ts`, `packages/core/src/docs/*` | публикация страниц |
| Голос | `packages/shared/src/voice/{types,capabilities,contracts}.ts`, `handlers/rpc/system-tts.ts`, `shared/src/voice/adapters/edge-tts.ts`, `shared/src/voice/job-machine.ts`, `host.ts` | подкаст (D13) |
| Процессы/спавн | `apps/electron/src/main/handlers/system.ts:314` (`shell:exec`), `main/extension-host/*`, `packages/server-core/src/services/privileged-execution-broker.ts`, `handlers/rpc/toolchain.ts`, `packages/shared/src/agent/*`, `packages/cloud-runner/src/local-provider.ts`, `packages/server-core/src/handlers/rpc/automations.ts`, `packages/server-core/src/workflows/*` (RPC-каналов `workflows:*` нет) | пайплайн джобов (§6) |
| GitHub | `workgraph:startGithubDeviceLogin|pollGithubDeviceLogin|cancelGithubDeviceLogin` (`packages/shared/src/protocol/channels.ts`, `packages/server-core/src/workgraph/github-oauth-import.ts`), токены в credential store | приватный клон (D3) |
| Агентский доступ | `packages/session-tools-core/src/handlers/{knowledge-read,knowledge-search,knowledge-propose,knowledge-backlinks}.ts` | session-tools Dev Space (§9) |
| Локальная аналитика | `apps/electron/src/renderer/features/product-tour/analytics/{events,index,metrics,diagnostics}.ts` (`sanitizeLearningEvent`, opt-in) | телеметрия (§12, локальная, allowlist) |

### 1.2 Границы слоя

- Dev Space и Playbooks — **две независимые поверхности одного приложения**; общий — только платформенный слой
  (репо/снапшот, джобы, артефакты, эгресс-consent, session-tools, i18n).
- Провайдеры инструментов анализа (шесть, D4) подключаются как адаптеры поверх
  `CodeIntelligenceProviderRegistry`-подобного реестра (§6); фундамент не выбирает инструменты — это `03-SPEC-features.md`.

---

## 2. Гейтинг роли (D1)

### 2.1 Шаг онбординга «Кто вы?»

Порядок первого запуска: `welcome` (имя) → **`role` (новое)** → {`rox-connect` | `git-bash` | `finish`}.
Шаг вставляется **после имени**, до существующих гейтов; существующие ветки `git-bash`/`rox-connect`
и терминальный `finishFirstRun` не меняют семантику.

Изменения:

- **новое** `apps/electron/src/renderer/components/onboarding/RoleStep.tsx` — компонент шага:
  вопрос «разработчик — да/нет» + смежные роли (аналитик/дизайнер/продакт/др.); множественный выбор;
  кнопка «Пропустить» (скип безопасен).
- **расширение** `OnboardingWizard.tsx` — в union `OnboardingStep` добавляется `'role'`; в `renderStep()`
  добавляется `case 'role': return <RoleStep .../>` (по образцу существующих кейсов, строки `renderStep`).
- **расширение** `apps/electron/src/renderer/hooks/useOnboarding.ts` — в `handleContinue()` добавляется
  `case 'role'`; логика «куда дальше» делегируется новому модулю (см. ниже). Существующий `case 'welcome'`
  меняет цель перехода: вместо прямого вызова `nextStepAfterUsername(...)` сначала идёт шаг `role`
  (шаг показывается всегда, гейта-флага у него нет; см. §2.3).
- **новое** `apps/electron/src/renderer/components/onboarding/onboarding-role.ts`:
  - `OnboardingRoleAnswer = { isDeveloper: boolean; relatedRoles: string[]; skipped: boolean }`;
  - `nextStepAfterRole(ctx)` — сохраняет прежние решения (`rox-connect` при `applyRoxConnectGate`,
    `git-bash` при `gitBashMissing`, иначе `finish`), т.е. дублирует контракт существующего
    `nextStepAfterUsername(ctx: UsernameAdvanceContext)` из `onboarding-username.ts`, но вызывается после роли;
  - `persistOnboardingRole(api, answer)` — запись ответа.
- Имя пользователя и его персистентность (`persistOnboardingUsername`, `parseOnboardingUsername`,
  `ONBOARDING_USERNAME_MAX`, `ONBOARDING_USERNAME_MAX`-валидация) **не трогаем**.

### 2.2 Хранение ответа и дефолт фичи

- **расширение** `packages/shared/src/environment/types.ts` / `storage.ts` (`EnvironmentPrefs`, `QUESTION_IDS`):
  новый `QUESTION_ID` профиля (предлагается `'role'`, значение — `{ isDeveloper, relatedRoles }`).
  Это канонический профиль онбординга, к которому привязывается персонализация вопросов (D8).
- **новое** ключ `KEYS.onboardingRole` (`'onboarding-role'`) в `apps/electron/src/renderer/lib/local-storage.ts` —
  быстрый ответ рендеру до/без загрузки `EnvironmentPrefs` (по образцу существующего
  `KEYS.onboardingUsernameConfirmed`).
- **расширение** `rox-runtime-default.ts` **не меняется**; включение Dev Space — **явная** запись
  `devspace.v1=true` при выборе «разработчик» в шаге роли (D1; §2.3/§2.4) — отдельный побочный эффект
  завершения онбординга, чтобы не ломать гарантии `finishFirstRun`.

### 2.3 Флаг Dev Space и запись в настройках

- **новое** мастер-флаг `WORKBENCH_FLAG.devSpaceV1 = 'devspace.v1'` + суб-флаги `devspace.ingest.v1`,
  `devspace.tools.v1`, `devspace.questions.v1`, `devspace.tours.v1`, `devspace.ask.v1` в
  `packages/core/src/platform/workbench/flags.ts`; все — в `WORKBENCH_FEATURE_FLAGS` с `defaultValue: false`
  (зависимости: суб-флаги — от своего master (`dependencies: ['devspace.v1']` для
  `devspace.ingest.v1`/`devspace.tools.v1`/`devspace.questions.v1`/`devspace.tours.v1`/`devspace.ask.v1`;
  `dependencies: ['playbooks.v1']` для `playbooks.knowledge.v1`/`playbooks.codebook.v1`),
  master-флаги `devspace.v1` и `playbooks.v1` — без зависимостей),
  `rollbackSafe: true`. Устаревшие `workbench.dev-space.v1` / `workbench.onboarding.role.v1` **не вводятся**.
  `defaultValue: false` — источник истины; «включён у разработчика» реализуется **явной** записью
  `devspace.v1=true` при выборе «разработчик» в шаге роли (D1, §2.1/§2.4), а не дефолтом флага (иначе молчаливое
  автовключение для всех). Ручное выключение пользователем **никогда** не перезаписывается.
- **новое** атом `apps/electron/src/renderer/atoms/dev-space.ts` (`atomWithStorage`) +
  `KEYS.devSpaceV1` (`'dev-space-v1'`), по образцу `atoms/{mode-flags,extra-screens}.ts`.
- **расширение** `SETTINGS_PAGES` (`apps/electron/src/shared/settings-registry.ts`) — запись
  `{ id: 'developers', labelKey: 'settings.developers.title', descriptionKey: 'settings.developers.description' }`
  (раздел «Разработчикам», D1/D2).
- **расширение** `SETTINGS_PAGE_COMPONENTS` (`apps/electron/src/renderer/pages/settings/settings-pages.ts`) →
  **новое** `apps/electron/src/renderer/pages/settings/DeveloperSettingsPage.tsx` (карточка-тумблер Dev Space,
  статус репозиториев, ссылки на consent — по образцу `ExtraScreensSettings.tsx`).
- **расширение** `SETTINGS_ITEMS` (`apps/electron/src/shared/menu-schema.ts`) — пункт меню для `developers`.

### 2.4 «Мягкие сигналы» (только напоминание)

- Источники сигналов: (а) пользователь вставил git-ссылку репозитория; (б) подключён git/CLI/локальная папка.
- Правило: сигнал **никогда** не включает Dev Space молча. Максимум — баннер-напоминание
  «Включить экран разработчика?» с кнопкой (переход в `DeveloperSettingsPage`).
- События: **новое** `devSpace:softSignal` (push, локальный, allowlist §12) с `kind: 'repo-link-pasted'|'git-detected'`.
- Состояние напоминания: **новое** ключ-напоминание `rox.devspace.nudge.v1` (одноразовое напоминание при
  мягком сигнале) + **новое** `KEYS.devSpaceReminderState` (`'dev-space-reminder-state'`) —
  `{ dismissedUntil?: number; lastShownAt?: number; count: number }`, чтобы напоминание не было навязчивым.
  Персистентность — рендер-атом, по образцу `sidebarDismissedGuidance`.
- Автовключение запрещено на уровне кода: единственная запись `devspace.v1=true` — явное действие
  пользователя (онбординг-шаг/настройки), не обработчик сигнала.

### 2.5 Совместимость веток онбординга

- `git-bash` (Windows) и `rox-connect` (Rox Cloud) остаются терминально-ветвящимися: шаг `role` только
  отвечает на вопрос и вызывает `nextStepAfterRole`, который возвращает те же решения, что и
  `nextStepAfterUsername`; проверка `state.gitBashStatus?.platform === 'win32' && !found`
  (`useOnboarding.handleContinue`, `case 'welcome'`) переносится в `nextStepAfterRole`.
- Скип шага (`skipped: true`) эквивалентен «не разработчик» для дефолтов, но **не** помечает профиль
  как «ответ дан» (напоминания продолжают работать).

---

## 3. IA: навигация, маршрут, deep-link (D2)

- **расширение** `APP_NAV_DESTINATIONS` (`nav-destinations.ts`): новая запись (идёт один раз, «add once»):
  - `id: 'developers'` (расширение union `AppNavDestinationId`), `linkId: 'nav:developers'`,
    `icon` из `lucide-react` (предлагается `FolderGit2`), `labelKey: 'sidebar.developers'`,
    `railGroup: 'more'`, `contextLinkIds: ['nav:developers']`,
    `route: () => routes.view.developers()`, `isActive: isDevelopersNavigation`.
- **расширение** `apps/electron/src/shared/types` — `isDevelopersNavigation(navState)` (по образцу
  `isKnowledgeNavigation`), поле `tab`/repo-id в `NavigationState`.
- **расширение** `apps/electron/src/shared/routes.ts` — `routes.view.developers(repoId?: string)` →
  `'developers'` либо `'developers?repo=<id>'` (через `toQueryString`), тип в union `ViewRoute`.
- **расширение** потребителей (только аддитивная регистрация пункта/флагов; поведение существующих пунктов
  не меняется — канон 6): `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
  (`links[]` — identity meta `icon`/`labelKey`), `apps/electron/src/renderer/platform/ActivityRail.tsx`
  (rail group `more`), `MainContentPanel.tsx` (`case 'developers'` → хост поверхности).
- **новое** `apps/electron/src/renderer/pages/dev-space/DevSpaceHomePage.tsx` — каталог репо;
  **новое** `apps/electron/src/renderer/pages/dev-space/DevSpaceRepoPage.tsx` — репо-воркспейс по `repo`-параметру.
- **Deep-link из проекта (D2, «одно ядро, две точки входа»):** в `apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx`
  (там где сейчас встроена панель `components/code-intelligence/RepositorySnapshotPanel.tsx`) добавляется
  кнопка «Открыть в пространстве разработчика» → `navigate(routes.view.developers(config.id))`.
  Оба входа ведут к одному ядру (`DevSpaceHomePage`/`DevSpaceRepoPage`), различаясь лишь начальным фокусом.
- **Сосуществование с реестром extra screens:** Dev Space — **верхнеуровневый nav destination**, а не extra screen;
  реестр `apps/electron/src/renderer/pages/extra-screens/registry.ts` (`EXTRA_SCREEN_FLAG`, «Ещё») не изменяется.
  Причина: D2 требует отдельного пункта rail; extra-screen реестр предназначен для экранов группы «Ещё» с
  флагом `workbench.mode.<id>.v1`. Дублирования записи в обоих реестрах быть не должно.

---

## 4. Каталог репозиториев и репо-проект: модель данных

### 4.1 Переиспользуемые сущности code-intelligence

- `RepositoryBinding` (`packages/shared/src/code-intelligence/refs.ts`, `schemaVersion:1`, поля
  `repositoryId`, `workspaceId`, `projectId`, `canonicalRoot`, `providerPolicyId`, `policy`, `createdAt`);
  идентификаторы: `repositoryId = repo_<sha256(root)>`, `id = binding_<sha256([ws,project,repo,source])>`.
- `RepositorySnapshot` (`schemaVersion:1`, `bindingId`, `parentCommitSha`, `treeSha`, `dirty`,
  `dirtyWorkingCopyDigest?`, `policyHash` (значение = `repositoryPolicyFingerprint(policy)`), `coverage`, `files[]`); идентификатор `snapshot_<digest>`.
- `RepositoryFreshness = 'current'|'stale'|'unavailable'` + `assessSnapshotFreshness(...)`.
- `RepositoryConnectionConfiguration` / `RepositoryConnection` / `RepositoryPreview` —
  `repositoryConnection`/`repositoryBindings` в конфиге проекта (`ProjectConfig`); PREVIEW/BIND-гейт.

### 4.2 Новое: каталог репозиториев Dev Space

**новое** `packages/shared/src/dev-space/types.ts`:

```
DevSpaceRepositoryRecord {
  schemaVersion: 1
  id: string                 // 'devrepo_<sha256([workspaceId, projectId, repositoryId])>'
  repositoryId: string       // = code-intel repositoryId (repo_<sha256>)
  workspaceId: string
  projectId: string          // проект-контейнер (projects/<slug>)
  projectSlug: string
  bindingId?: string         // code-intel binding_<...> (появляется после BIND)
  origin:
    | { kind: 'git-url'; url: string; provider: 'github'; defaultBranch?: string }
    | { kind: 'local-folder'; path: string }
  displayName: string
  status: DevSpaceRepositoryStatus
  createdAt: number
  updatedAt: number
  lastSnapshotId?: string
  lastAnalyzedSnapshotId?: string   // для правила «устарело» (§7)
  lastError?: { code: string; at: number }
}

DevSpaceRepositoryStatus =
  | 'unbound'   // запись создана, репо ещё не клонировано/не привязано
  | 'cloning'   // идёт клон (git-url)
  | 'cloned'    // клон готов, BIND/PREVIEW не пройден
  | 'bound'     // binding есть, анализа не было
  | 'analyzing' // активный прогон (§6)
  | 'ready'     // артефакты есть и актуальны
  | 'stale'     // есть новый снапшот, артефакты устарели (§7)
  | 'error'     // последняя операция упала (lastError)
```

- Каталог хранится в конфиге workspace/проекта: **новое** `dev-space-repositories.json`
  под workspace root (аналог реестра, читается сервером); источник истины — сервер, рендер получает список
  через `devSpace:listRepositories` (read-only, без секретов).
- **Связь с code-intelligence:** запись каталога — тонкая обёртка над `RepositoryBinding` +
  `RepositorySnapshot`; сами снапшоты/политики не дублируются (живут в
  `projects/<slug>/code-intelligence/<bindingId>/<policyFingerprint>/snapshot_*.json`, существующая раскладка).
  `lastSnapshotId`/`lastAnalyzedSnapshotId` ссылаются на code-intel снапшоты.

### 4.3 Проект-контейнер (O4)

**РЕШЕНО 2026-10-10 (O4):** клон в **`projects/<slug>/<repo-dir>`** (ADR-0022) как репо-проект
(согласуется с тем, что handler code-intel уже ожидает путь `resolve(workspaceRoot, 'projects', slug)` и
folder `project.folderPath`; см. `code-intelligence.ts:89-93`). Отдельный корень `repos/` потребовал бы
правок резолва проекта и нового класса владения — отклоняется для v1.

---

## 5. Ингест репозитория

### 5.1 Новый RPC-контур (**все — новое**)

**расширение** `packages/shared/src/protocol/channels.ts` — блок `devSpace` (по образцу `codeIntelligence`):

| Канал (новое) | Назначение |
|---|---|
| `devSpace:listRepositories` | каталог (read-only, без секретов) |
| `devSpace:addRepository` | создать запись: `{ source: {kind:'git-url', url} \| {kind:'local-folder', path}, projectSlug? }` |
| `devSpace:startClone` | запустить клон git-url в управляемое пространство |
| `devSpace:removeRepository` | удалить запись + (опц.) рабочий каталог, с подтверждением |
| `devSpace:refreshRepository` | «проверить свежесть/обновить» (pull + новый снапшот) |
| `devSpace:cancel` | отмена по `requestId` (как `codeIntelligence:cancel`) |
| `devSpace:capabilities` | доступность git, GitHub device-login, движков анализа |

Push-события (**новые**): `devSpace:cloneProgress` (`{ repositoryId, phase, receivedBytes?, totalBytes? }`),
`devSpace:changed` (`{ repositoryId, status }`).

**новый job-канал** `podcast:JOB` — прогон генерации подкаста (заменяет `voice:JOB` именно для подкаста;
`voice:JOB` остаётся для диктовки/ASR).

**новое** `packages/server-core/src/handlers/rpc/dev-space.ts` — регистрация хендлеров
(`registerDevSpaceHandlers`), `access: 'localElectron'`, `assertWindow` и tenant-проверки — по образцу
`packages/server-core/src/handlers/rpc/code-intelligence.ts`.

### 5.2 Клон по ссылке

- Только `https://github.com/...` (D3). Клон выполняется серверным процессом в
  `projects/<slug>/` с ограничениями: глубина — full по умолчанию (`CLONE_DEPTH`, O9 решено 2026-10-10); здесь фиксируется
  требование «осуществлять клон вне рендера, с прогрессом и отменой».
- Транспорт git — через существующий паттерн `execFile('git', …)` (используется в
  `refs.ts:225-234`), но с бóльшим таймаутом/прогрессом (см. §6). `shell:exec` не используется (см. §6.3).

### 5.3 Приватные репозитории — GitHub device-login

- Переиспользуем существующий поток: `workgraph:startGithubDeviceLogin|pollGithubDeviceLogin|cancelGithubDeviceLogin`
  (`github-oauth-import.ts`), токен остаётся в credential store и **не отдаётся рендеру** (D3; явно в брифе).
- Клон использует токен внутри серверного процесса (credential store → env/`GIT_ASKPASS`-эквивалент);
  в событие прогресса/ошибку токен не попадает (маскирование §8).

### 5.4 Локальная папка как альтернатива

- `source: {kind:'local-folder', path}` → **новое** использует существующий `bindRepository(...)` +
  PREVIEW/BIND (без клонирования); проект-контейнер создаётся/переиспользуется существующим
  `saveProjectConfig` (см. `code-intelligence.ts` BIND).

### 5.5 Лимиты, отмена, очистка

- Лимиты заимствуются из code-intel policy: `maxFileBytes` (256 KiB, `refs.ts:11`), `maxBytes` (16 MiB, `:12`),
  `maxFiles` (10 000, `:13`); `MAX_HISTORY=100` снапшотов, `MAX_REQUESTS_PER_CLIENT=8`
  (`code-intelligence.ts:33-34`). Для клона — **новое** ограничение размера: `MAX_REPO_BYTES` = 2 ГиБ, гард после clone/pull (O9 решено 2026-10-10).
- Отмена — через `AbortController` + реестр активных запросов (по образцу `requests` в
  `code-intelligence.ts`).
- Очистка `removeRepository`: удаляет запись каталога, при подтверждении — рабочий каталог и
  `code-intelligence/<bindingId>/`; аудит-запись в журнал (§8.4).

### 5.6 Freshness/обновление и бейдж «устарело»

- Периодичность: **только по кнопке** «Проверить свежесть / Обновить» (D3); авто-watch/pull не в v1.
- Реализация: `assessSnapshotFreshness(snapshot, binding, scope)` (`refs.ts:519`) → `current`/`stale`/`unavailable`.
- `refreshRepository`: `git pull` (или повторный snapshot при local-folder) → новый `RepositorySnapshot`
  → проверка, изменился ли `lastAnalyzedSnapshotId` → перевод записи в `stale`.
- Бейдж «устарело»: рендер-индикатор на карточке репо и на поверхностях артефактов; условие —
  `record.lastSnapshotId !== record.lastAnalyzedSnapshotId`.
- Правило «устарело» распространяется и на опубликованные страницы Notes/Pages (§7.4).

---

## 6. Пайплайн анализа (джобы)

### 6.1 Стадии

`reconcile → structural tools → LLM-слой → publish`.

1. **reconcile** — разрешить репо/снапшот: `captureRepositorySnapshot(...)` (существующее) или
   переиспользовать неизменный снапшот (идемпотентность по `snapshot.id`).
2. **structural tools** — детерминированные артефакты локально: граф кода, диаграммы, knowledge-graph,
   C4/OKF (адаптеры D4; см. `03-SPEC-features.md`).
3. **LLM-слой** — wiki, «понимание», блоки вопросов (D5, D8); фоном с прогрессом, UI показывает скелет сразу.
4. **publish** — публикация человекочитаемых страниц в Notes/Pages через `content:*` (§7.4).

### 6.2 Модель прогона

**новое** `DevSpaceRun`:

```
DevSpaceRun {
  schemaVersion: 1
  id: string                 // 'devrun_<sha256([repositoryId, snapshotId, planHash])>'
  repositoryId: string
  snapshotId: string         // идемпотентность: тот же снапшот → тот же run-id
  stages: readonly DevSpaceRunStage[]
  status: 'queued'|'running'|'succeeded'|'failed'|'cancelled'|'partial'
  progress: { stage: DevSpaceRunStage; done: number; total: number }
  startedAt: number; finishedAt?: number
  error?: { code: string; stage: DevSpaceRunStage }
  artifacts?: readonly string[]   // id артефактов (§7)
}

DevSpaceRunStage = 'reconcile'|'structural'|'llm'|'publish'
```

- **статусы/прогресс/возобновление/отмена:** прогресс — push `devSpace:runProgress`;
  отмена — `devSpace:cancel` (AbortController); возобновление — повторный запуск с тем же `snapshotId`
  продолжает только незавершённые стадии (журнал прогона хранит выполненные).
- **идемпотентность/кэш по snapshot:** `run-id` детерминирован от `(repositoryId, snapshotId, planHash)`;
  успешный прогон для данного снапшота делает повторный запуск no-op (кэш-хит), пока `planHash` не изменён
  (смена набора инструментов/версий → новый `planHash`).
- **журнал прогонов:** **новое** `projects/<slug>/dev-space/runs/<runId>.json` (история, до
  128 записей — `MAX_RUNS_PER_PROJECT`, O10 решено 2026-10-10); читается `devSpace:listRuns` (**новое**).

### 6.3 Движок исполнения (O3)

**РЕШЕНО 2026-10-10 (O3):** локальный in-process job-runner по spawn-паттерну `omp-agent.ts`
(ADR-0021); automations/workflows, extension-host и второй рантайм отвергнуты; cloud-runner — резерв.

**Почему не `shell:exec`:** `apps/electron/src/main/handlers/system.ts:314` задаёт
`/bin/zsh -lc` с **таймаутом 20 с** и лимитом вывода **1 MiB** — длинные пайплайны (загрузка/парсинг
репозитория, tree-sitter, генерация wiki) гарантированно не укладываются (риск брифа №1).

**Критерии выбора:**

| Критерий | Требование |
|---|---|
| длительность/прогресс | > 20 c, потоковый прогресс, возобновление, отмена |
| локальность | без обязательного облачного эгресса (D6); локальный прогон по умолчанию |
| изоляция | cwd = рабочий каталог репо; запрет выхода за `allowedRoots` |
| переиспользование | существующие spawn/аудит-паттерны; минимум нового кода |
| платформы | macOS + Windows (D14) |

**Кандидаты:** (а) agent SDK subprocess `packages/shared/src/agent/*`; (б) automations
`packages/server-core/src/handlers/rpc/automations.ts` + workflows-движок `packages/server-core/src/workflows/*`
(RPC-каналов `workflows:*` нет); (в) cloud-runner local `packages/cloud-runner/src/local-provider.ts`;
(г) extension host `main/extension-host/*`.

**Рекомендация:** **(а) локальный job-runner на базе паттерна agent SDK subprocess (`shared/src/agent/*`)
с job-machine/push-моделью по образцу `voice:JOB`/`voice:OVERLAY` (`shared/src/voice/{job-machine,host}.ts`)
и аудитом по паттерну `privileged-execution-broker.ts`.** Обоснование: критерий длительности/прогресса
покрывается существующей job-machine; изоляция — cwd + policy `allowedRoots`; эгресс отсутствует;
audit/sandbox переиспользуются. Cloud-runner-local — резерв при потребности в сильной изоляции;
automations отклоняется (пользовательский граф, не инфраструктурный пайплайн); extension-host — лишняя
UI-расширяемость.

### 6.4 Параллелизм, таймауты, лимиты

- **Параллелизм инструментов:** structural-стадия допускает параллельный запуск независимых адаптеров;
  LLM-стадия — bounded-параллелизм `LLM_STAGE_CONCURRENCY`=2 (O10 v1.x, внедрено 2026-10-10;
  артефакты и журнал детерминированы порядком адаптеров).
  Общий примитив — пул задач job-runner.
- **Таймауты:** per-инструмент явный таймаут (больше `shell:exec`); общий дедлайн стадии; при превышении —
  `status:'partial'` с указанием незавершённых артефактов.
- **Лимиты ресурсов:** наследуются от code-intel policy и лимитов снапшота; для субпроцессов — тот же
  broker/permissions режим, что и для прочих спавнов.

---

## 7. Артефакты: хранение, форматы, публикация

### 7.1 Раскладка каталога

```
projects/<slug>/
  dev-space/
    manifest.json                 # манифест всех артефактов (новое)
    consent.json                  # per-repo согласие (§8)
    audit.jsonl                   # аудит-журнал (§8.4)
    runs/<runId>.json             # журнал прогонов (§6.2)
    wiki/            …            # md (+ Mermaid) — openwiki
    understanding/   …            # понимание/туры — Understand-Anything
    code-graph/      …            # граф кода/символы — codegraph
    diagrams/        …            # схемы — archify (svg/json)
    knowledge-graph/ …            # graph.json/graph.html — graphify
    c4/              …            # OKF/C4 markdown — Groma.md
    questions/       …            # блоки вопросов (json/md)
    tours/           …            # динамические TourDefinition-структуры (json)
    security/        …            # SBOM/CVE (sbom.* / cve.*) — syft/OSV
    audio/           …            # подкаст (mp3/srt) — Playbooks
  code-intelligence/<bindingId>/<policyFingerprint>/snapshot_*.json   # существующая раскладка (не дублируется)
```

### 7.2 Форматы

- `md` — человекочитаемые артефакты (wiki, understanding, c4; Mermaid/диаграммы inline),
  источник публикации страниц.
- `json` — машинные модели (граф кода, knowledge-graph, блоки вопросов, туры, манифест/прогоны).
- `svg` — схемы (archify PNG/SVG export).
- `audio` (`mp3`, `srt`) — подкаст Playbooks (D13); контейнер `audio/`.

### 7.3 Манифест, provenance, версии

**новое** `manifest.json`:

```
DevSpaceManifest {
  schemaVersion: 1
  repositoryId: string
  snapshotId: string            // снапшот, из которого построено
  runId: string
  entries: ReadonlyArray<{
    id: string                  // 'artifact_<sha256([repositoryId, snapshotId, kind, path])>'
    kind: 'wiki'|'understanding'|'code-graph'|'diagram'|'knowledge-graph'|'c4'|'questions'|'tour'|'sbom-cve'|'audio'
    path: string                // относительный от projects/<slug>/dev-space/
    format: 'md'|'json'|'svg'|'mp3'|'srt'
    producedBy: { providerId: string; version: string }   // provenance, аналог provider.sourceRevision/artifactDigest
    sourceRevision?: string     // sha родительского коммита (как refs.ts SourceVersion)
    createdAt: number
  }>
}
```

- **provenance** повторяет модель code-intel: `providerId`+`version` (+ `sourceRevision`/`artifactDigest`,
  как `CodeIntelligenceProvider` в `provider.ts`).
- **версии/регенерация:** артефакты именуются по `snapshotId`; при новом снапшоте — новый набор
  (старый не перезаписывается, пока не подтверждена публикация), регенерация — прогон (§6.2) по кнопке.

### 7.4 Публикация в Notes/Pages (D7)

- Человекочитаемые страницы (wiki/understanding/c4) публикуются через **существующий** `content:*`
  RPC (`content:resolve|describe|adoptDescriptor|commitMarkdown|getCommitReceipt|getBlockTree`) и commit-store
  `packages/server-core/src/docs/markdown-commit.ts`.
- **receipts:** durable receipts commit-store (HASH_CONFLICT/DOCUMENT_BUSY) используются как есть; при
  `HASH_CONFLICT` публикация помечается конфликтом и показывает diff.
- **конфликты:** пользовательская правка опубликованной страницы → повторная публикация не перетирает
  молча; предлагается merge/replace.
- **Поиск:** опубликованные страницы попадают в vault-index (`packages/server-core/src/knowledge/vault-index.ts`).
- **Правило «устарело»:** при `lastSnapshotId !== lastAnalyzedSnapshotId` опубликованные страницы и
  артефакты помечаются stale; авто-регенерации нет — кнопка (D7).

---

## 8. Эгресс и приватность (D6)

### 8.1 Consent-модель per-repo

**новое** `projects/<slug>/dev-space/consent.json`:

```
DevSpaceConsent {
  schemaVersion: 1
  repositoryId: string
  items: {
    modelConnectors: boolean   // вызовы настроенных модельных коннектов
    cveNetwork: boolean        // сеть для OSV
    toolUpdates: boolean       // сеть для обновления инструментов
  }
  grantedAt: number
  updatedAt: number
}
```

- Аналог гейта PREVIEW/BIND (D6); молчаливого эгресса нет — при `false` соответствующая операция
  блокируется (аналог `provider-egress-denied` в `provider.ts:95`).

### 8.2 UI-шаг согласия

- При первом анализе репо — шаг/диалог согласия с явными пунктами (модель, CVE, обновления инструментов);
  дефолт — как в §10.

### 8.3 Маскирование секретов и исключения

- Дефолтные исключения (D6): `.env*`, `**/*.pem`, `**/*.key`, `**/.codegraph/**` — поверх
  существующего механизма секретов: `isSafeToIngest(...)` в `local-adapter.ts` (skip-reason `'secret'`,
  `refs.ts:392`) и `isRepositoryPathExcluded(...)` (`refs.ts:289`).
- Перед LLM-эгрессом — дополнительный маскирующий проход (секреты не уходят в модель); при `modelConnectors:false`
  LLM-стадия недоступна, structural-стадия работает локально.

### 8.4 Аудит-журнал

- **новое** `projects/<slug>/dev-space/audit.jsonl` — append-only JSONL (по образцу аудита
  `privileged-execution-broker.ts`): запись на consent-grant, эгресс (модель/CVE/update), клон, publish,
  remove. Поля без секретов (маскирование §8.3).

### 8.5 OSV / syft

- CVE — через **OSV** под `cveNetwork` consent (сеть); SBOM — `runSyftSbom` (`packages/shared/src/code-intelligence/sbom.ts`,
  optional runner, «никогда не устанавливает») — **optional** (D8), также под consent.

---

## 9. Агентский доступ (session-tools)

- Паттерн — существующие `packages/session-tools-core/src/handlers/{knowledge-read,knowledge-search,knowledge-propose,knowledge-backlinks}.ts`.
- **новое** `packages/session-tools-core/src/handlers/`:
  - `dev-space-read.ts` — чтение артефактов репо (wiki/понимание/граф/схемы/вопросы) по `artifact id`.
  - `dev-space-search.ts` — поиск по артефактам (FTS5 vault-index/source-index).
  - `dev-space-propose.ts` — propose/approve-изменений (запись только через подтверждение).
- Имена инструментов (канон 5): `devspace.read`, `devspace.search`, `devspace.propose`.
- **Права по уровням:**
  - уровень «чтение» — `devspace.read`, `devspace.search`;
  - уровень «предложение» — `devspace.propose` (запись только через подтверждение/approve).
- Записи в Notes/Pages агент выполняет исключительно через `devspace.propose`→approve
  (propose/approve, D7; аналог `knowledge:applyProposal`); прямых мутаций нет.

---

## 10. Флаги и настройки

| Имя | Тип | Дефолт | Видимость |
|---|---|---|---|
| `devspace.v1` (**новое**, master, `WORKBENCH_FLAG`) | workbench flag | `false` | rail-пункт + Settings → Разработчикам |
| `devspace.ingest.v1` (**новое**, суб-флаг) | workbench flag | `false` | наследует master |
| `devspace.tools.v1` (**новое**, суб-флаг) | workbench flag | `false` | наследует master |
| `devspace.questions.v1` (**новое**, суб-флаг) | workbench flag | `false` | наследует master |
| `devspace.tours.v1` (**новое**, суб-флаг) | workbench flag | `false` | наследует master |
| `devspace.ask.v1` (**новое**, суб-флаг) | workbench flag | `false` | наследует master |
| `playbooks.v1` (**новое**, master, `WORKBENCH_FLAG`) | workbench flag | `false` | поверхность Playbooks |
| `playbooks.knowledge.v1` (**новое**, суб-флаг) | workbench flag | `false` | наследует Playbooks master |
| `playbooks.codebook.v1` (**новое**, суб-флаг) | workbench flag | `false` | наследует Playbooks master |
| `settings.developers.*` (**новое**, не флаг) | предпочтения | — | Settings → Разработчикам |
| `devSpaceConsent.items.modelConnectors` (**новое**) | consent per-repo | `false` | диалог согласия + DeveloperSettings |
| `devSpaceConsent.items.cveNetwork` (**новое**) | consent per-repo | `false` | диалог согласия |
| `devSpaceConsent.items.toolUpdates` (**новое**) | consent per-repo | `false` | диалог согласия |
| `KEYS.devSpaceV1` (**новое**) | renderer atom | — | внутренний |
| `KEYS.onboardingRole` (**новое**) | renderer atom | — | внутренний |
| `KEYS.devSpaceReminderState` (**новое**) | renderer atom | `{count:0}` | внутренний (напоминание §2.4) |
| `rox.devspace.nudge.v1` (**новое**) | renderer atom | — | внутренний (одноразовое напоминание при мягком сигнале, §2.4) |

- Устаревшие `workbench.dev-space.v1` и `workbench.onboarding.role.v1` **не вводятся**; шаг роли — не флаг,
  показывается всегда (канон 1).
- Общие правила: все флаги `defaultValue:false` и rollback-safe; тумблер лишь скрывает rail-пункт/поверхность,
  данные сохраняются (паттерн extra screens). «Включён у разработчика» — **явная** запись `devspace.v1=true`
  при выборе «разработчик» в шаге роли (D1); ручное выключение пользователем **никогда** не перезаписывается.

---

## 11. i18n-план

- 12 локалей `ar de en es fr hu ja ko pl ru zh-Hans zh-Hant`; файлы `packages/shared/src/i18n/locales/*.json`;
  ключи — плоские ASCII-sorted; RU-дефолт.
- **Новые префиксы ключей:** `sidebar.developers`, `settings.developers.*`, `onboarding.role.*`,
  `devSpace.*` (каталог/воркспейс/статусы/бейдж «устарело»/согласие), `devSpaceQuestions.*`, `devSpaceTour.*`,
  `playbooks.*` (для §Playbooks, пересекается с `03-SPEC-features.md`).
- Объёмы: бюджет 12 000 ключей en, гейт `lint:i18n:budget` в `validate:ci` (O11 решено 2026-10-10); каждая новая строка — во все 12 локалей.
- Гейты: `lint:i18n:parity`, `lint:i18n:sorted`, `lint:i18n:coverage`, `lint:i18n:budget` (все входят в `validate:ci`).
- Проверка до PR: ни одна строка не хардкодится в компонентах; ключи добавляются во все локали одновременно.

---

## 12. Телеметрия

- Модель — **локальная, opt-in, allowlist** по образцу product-tour:
  `apps/electron/src/renderer/features/product-tour/analytics/{events,index,metrics,diagnostics}.ts`
  (`sanitizeLearningEvent` отбрасывает контент, корреляционные id, пути, URL). Никаких удалённых отправок
  по умолчанию; эгресс телеметрии не вводится.
- **Волны (канон 10):** инфраструктура телеметрии вводится в волне **В1** (по 02 §12); сами события —
  по волнам соответствующих фич (см. `05-PLAN.md`).
- **Новые события (name, параметры):**
  - `devspace.repo-added` — `{ sourceKind: 'git-url'|'local-folder' }`
  - `devspace.clone-finished` — `{ ok: boolean }`
  - `devspace.analysis-run` — `{ stage: '', status: '' }` (без repo/путей)
  - `devspace.artifact-published` — `{ kind }`
  - `devspace.question-opened` — `{ block: 'learn'|'features'|'security' }`
  - `devspace.tour-start` / `devspace.tour-finish` — `{ tourId, stepCount }`
  - `devspace.own-question-asked` — `{ hasAttachments: boolean }`
  - `playbooks.source-added` — `{ kind }`
  - `playbooks.preset-question-opened` — `{ index }`
  - `playbooks.podcast-generated` — `{ voiceCount, hasSrt: boolean }`
- Все значения — enum/числа/булевы; контент, имена репо/файлов, id сессий/воркспейсов в события не попадают.

---

## 13. Безопасность (threat-заметки)

1. **Чужой код.** Клонированный/привязанный код недоверенный. Запрещено исполнять его (build/test/hooks) в
   рамках анализа: git вызывается с `-c core.hooksPath=/dev/null`, `GIT_TERMINAL_PROMPT=0` (существующее,
   `refs.ts:228-231`); анализаторы — только чтение файлов из снапшота.
2. **Prompt-injection из файлов репо → правило «данные не инструкции».** Любой текст из репозитория,
   артефактов, README, комментариев, названий файлов — **данные**, не инструкции для LLM/агента. Инструкции
   приходят только от пользователя/системного промпта; содержимое репо не может менять план, права,
   consent, вызывать инструменты или публиковать. Правило фиксируется в системных промптах LLM-стадии и в
   описаниях session-tools (§9).
3. **Изоляция процессов.** Анализ — в субпроцессах job-runner (O3) с cwd = рабочий каталог репо и
   ограничением `allowedRoots` (как `enforceLiveRoot`, `refs.ts:244`); никакого доступа за пределы проекта.
4. **Сетевые разрешения.** По умолчанию сеть запрещена; разрешается per-repo через consent (§8):
   модельные коннекты, OSV, обновления инструментов. Молчаливый эгресс отсутствует (D6).
5. **Секреты.** Токен GitHub живёт только в credential store и не отдаётся рендеру (D3); `.env*`, ключи,
   pem — исключаются механизмом секретов (`isSafeToIngest`, `refs.ts:392`) до любого эгресса (§8.3).
6. **Публикация.** Запись в Notes/Pages — только через `content:*` с receipt/конфликтами (§7.4); агент —
   только propose/approve (§9).
7. **Приёмка.** Native-гейты macOS/Windows (Linux = NOT_RUN, риск брифа №9); затронутые изменения renderer
   прогоняют `product-tour-native.yml` (D14).

---

## Открытые вопросы этого документа — закрыты 2026-10-10

- O3 — движок джобов (§6.3): локальный in-process job-runner, ADR-0021.
- O4 — место хранения клонов (§4.3): `projects/<slug>/<repo-dir>`, ADR-0022.
- O9 — лимиты клона и глубина истории (§5.2, §5.5): full history + `MAX_REPO_BYTES` = 2 ГиБ.
- O10 — параллелизм LLM-слоя и лимит журнала прогонов (§6.2, §6.4): 128/200 записей; LLM-слой — bounded-параллелизм =2 (v1.x, внедрён 2026-10-10).
- O11 — бюджет i18n-строк (§11): 12 000 ключей en, гейт `lint:i18n:budget`.