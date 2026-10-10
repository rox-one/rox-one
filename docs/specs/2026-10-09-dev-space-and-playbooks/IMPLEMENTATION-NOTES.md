# IMPLEMENTATION-NOTES — отклонения и решения реализации (Developer Space + Playbooks)

Документ фиксирует решения, принятые **при реализации** волн В1–В5 (PR #1658, #1705, #1737, #1738,
#1739; фикс #1741), которые уточняют или расширяют фриз пака (`02-SPEC-foundations.md`,
`03-SPEC-features.md`, `05-PLAN.md`). Утверждения подкреплены фактическими путями в дереве на
2026-10-10.

---

## 1. Каналы сверх фриза

Фриз `02-SPEC-foundations.md` §5.1 объявлял для ингеста `devSpace:listRepositories … capabilities`
(+ pushes `cloneProgress/changed/runProgress`) и единственный job-канал `podcast:JOB`. Реализация
добавила точечные каналы, без которых заявленные сценарии не выражаются. Реестр каналов —
`packages/shared/src/protocol/channels.ts`; обработчики — `packages/server-core/src/handlers/rpc/dev-space.ts`,
`packages/server-core/src/playbooks/jobs.ts`, `packages/server-core/src/playbooks/codebook/index.ts`.

### 1.1 devSpace

| Канал | Зачем добавлен |
|---|---|
| `devSpace:startRun` | Фриз описал модель прогона `DevSpaceRun` (§6.2: идемпотентность по `snapshotId`, прогресс, отмена), но не канал старта. Отдельный вызов запускает пайплайн `reconcile → structural → llm → publish`; run-id детерминирован (`devSpaceRunId`) и повторный запуск по тому же снапшоту — no-op. |
| `devSpace:listArtifacts` | Поверхности репо-воркспейса читают манифест прогона (§7.3): список артефактов с counts/stale/snapshot. Фриз задал формат `manifest.json`, но не RPC чтения. |
| `devSpace:readArtifact` | Текстовое содержимое артефакта для рендера (wiki/md/json/svg/srt). Ограничение размера — `DEV_SPACE_READ_ARTIFACT_MAX_BYTES = 512 KiB`, допустимые форматы — `DEV_SPACE_TEXT_ARTIFACT_FORMATS = ['md','json','svg','srt']` (`packages/shared/src/dev-space/types.ts`). |
| `devSpace:generateQuestions` | Блоки вопросов (D8) пересчитываются по явной команде (политика dirty-snapshot O8), а не только как фоновая LLM-стадия. Хендлер возвращает `status:'denied'` при отсутствии/несовпадении model-consent, с записью в аудит-журнал. Реализация — `packages/server-core/src/devspace/questions/index.ts`. |

### 1.2 podcast

| Канал | Зачем добавлен |
|---|---|
| `podcast:start` | Регистрирует job и возвращает `{ jobId, episodeId }` немедленно; прогон следует на push `podcast:job`. `podcast:JOB` — только поток прогресса. |
| `podcast:cancel` | Прерывает `AbortController` прогона; отменённый прогон никогда не публикует эпизод (миксдаун остаётся в temp). |
| `podcast:episodes` | Список опубликованных эпизодов из append-only индекса `audio/index.json` (переживает пере-прогоны dev-space). |
| `podcast:audio` | Пофреймовое чтение mp3 для плеера и экспорта (окно 192 KiB на стороне рендера). |
| `podcast:audioUrl` | `data:` URL для плеера, когда эпизод помещается в один payload; потолок `PODCAST_AUDIO_URL_MAX_BYTES = 32 MiB` (`packages/server-core/src/playbooks/episodes.ts`). |

### 1.3 playbooks (кодбук)

Фриз §9 описывал кодбук только как модель ноутбука поверх job-движка, без каналов. Реализация ввела
RPC-поверхность `packages/server-core/src/playbooks/codebook/index.ts`:

| Канал | Зачем добавлен |
|---|---|
| `playbooks:runCodebook` | Валидирует ноутбук, регистрирует job, возвращает `{ jobId, runId, notebookId }` немедленно. |
| `playbooks:cancelCodebook` | Прерывает прогон; отменённый прогон журналируется как `cancelled`, не как успех. |
| `playbooks:codebookRuns` | Читает durable-журнал прогонов проекта. |
| `playbooks:codebookJob` | Push прогресса с монотонным `seq` (дисциплина `voice/job-machine.ts`). |

**Фикс #1741:** push-канал `playbooks:codebookJob` не был перечислен в compile-time реестре
`BROADCAST_EVENT_CHANNELS` (`packages/shared/src/protocol/catalog.ts`) — гвард `MissingEventChannels`
падал на post-merge `tsc`. Канал добавлен; также добавлены `devSpace:{cloneProgress,changed,runProgress,softSignal}`
и `podcast:JOB`. Заодно пере-записаны бюджеты бандла (`perf-baselines/bundle-size.json`).

---

## 2. Адаптация к обновлённому примитиву Tabs (W1.1)

В `main` появился единый примитив вкладок — `apps/electron/src/renderer/components/ui/tabs.tsx`
(`Tabs({items, activeId, onSelect})`, варианты `surface|segmented|browser`; коммит W1.1
`74b55fa4b`). Волна В2 стартовала на старой (несуществующей) Radix-обёртке `TabsList/TabsTrigger/TabsContent`,
которой `components/ui/tabs.tsx` не экспортирует → сборка падала на `TabsList`.

Решение:

- `apps/electron/src/renderer/pages/dev-space/DevSpaceRepoPage.tsx` переведён на
  `<Tabs variant="segmented" density="compact" tone="accent">` c `items/activeId/onSelect`; активная
  панель рендерится напрямую (без `TabsContent`), **testid'ы секций сохранены** (коммиты `547a3eb75`,
  `7667f1d66`, RX-FEA-0034).
- В том же catch-up merge восстановлен экспорт `UsernameAdvanceContext` из
  `apps/electron/src/renderer/components/onboarding/onboarding-username.ts` (его потребляет шаг роли).
- Бюджеты бандла пере-записаны после слияния.

---

## 3. node-builtin shim в C2-фикстуре `product-learning-input`

Фикстура `apps/electron/src/renderer/components/app-shell/input/__tests__/fixtures/product-learning-input/`
(кейс C2 проверки product-learning input) собирается esbuild'ом в браузерный бандл. Реальные модули
рендера тянут серверные модули через баррели (`@rox/core/platform`), транзитивно доходя до `node:*`;
без шима esbuild помечает `node:*` внешними, фикстура не собирается и тест падает таймаутом.

Решение (`4f2f1b80f`, RX-FEA-0034): изолированный esbuild-плагин в тесте
`apps/electron/src/renderer/components/app-shell/input/__tests__/product-learning-input.browser.test.ts`
резолвит `/^node:/` в тот же инертный `apps/electron/src/renderer/shims/node-stub.ts`, что и сборка
рендера (`apps/electron/vite.config.ts`) и соседние product-tour browser-харнессы. Тест входит в
скрипт `bun run test:product-tour` (`package.json`).

---

## 4. Каталог `ipc-channels.generated` и генератор

Волны добавили много channel-id, поэтому контракт wire-format заморожен артефактом:

- Генератор — `scripts/ipc-inventory.ts`: собирает `getAllChannelValues()` (сортированный список) и
  пишет `apps/electron/src/shared/__tests__/ipc-channels.generated.ts`
  (`EXPECTED_CHANNELS`, `EXPECTED_CHANNEL_COUNT`). Режим `--check` возвращает exit 1 при устаревшем
  артефакте (для CI), без флага — пере-записывает.
- Тест — `apps/electron/src/shared/__tests__/ipc-channels.test.ts`: сверяет точный набор и количество
  строк `RPC_CHANNELS` с артефактом, так что дрейф wire-format невозможен «руками». Тест входит в
  `bun run test:product-tour`.

---

## 5. Дефолтный контейнер `projects/playbooks` для подкаста/кодбука без репо

Подкаст и кодбук могут запускаться из ноутбука Playbooks, не привязанного к репозиторию. Чтобы такие
прогоны всё же имели место хранения, сервер создаёт на месте контейнер-проект:

- `packages/server-core/src/playbooks/jobs.ts` — `DEFAULT_PODCAST_PROJECT_SLUG = 'playbooks'`,
  `DEFAULT_PODCAST_PROJECT_NAME = 'Playbooks'`; `resolveProject(..., create:true)` создаёт
  `projects/playbooks/` по паттерну `ensureContainerProject` из `dev-space.ts`; артефакты ложатся в
  `projects/playbooks/dev-space/`.
- `packages/server-core/src/playbooks/codebook/index.ts` — `DEFAULT_CODEBOOK_PROJECT_SLUG = 'playbooks'`
  (аналогично).
- Рендер (`apps/electron/src/renderer/pages/playbooks/podcast/podcast-client.ts`) отправляет
  `projectSlug` только когда ноутбук реально привязан к проекту; отсутствие slug = серверный дефолт,
  рендер не выдумывает slug.

---

## 6. Рекомендации (пост-медиа, подкаст)

По итогу реализации медиа-стадии подкаста (В4):

- **O5 (Kokoro)** — решено 2026-10-10: остаётся целиком в v1.x. `TtsEngine` = `system|edge`
  (значение `'kokoro'` не добавлялось — движка нет, и тип не должен обещать несуществующий рунтайм);
  при включении Kokoro тип расширяется первым шагом вместе с реальной интеграцией.
- **O9 (лимиты клона)** — решено 2026-10-10: полная история по умолчанию (`CLONE_DEPTH='full'`),
  таймаут 30 мин, гард размера `MAX_REPO_BYTES` = 2 ГиБ после clone/pull (`clone-too-large`).
- **O10 (капы и параллелизм)** — решено 2026-10-10: 128 прогонов на проект / 200 кодбук-прогонов,
  LLM-слой последовательный by design (bounded-параллелизм — рычаг v1.x).
- **O11 (бюджет i18n)** — решено 2026-10-10: 12 000 ключей en (11 286 на закрытии), гейт
  `lint:i18n:budget` в `validate:ci`.
- **O6 (srt)** — «да» и реализовано: сегментные тайминги TTS дают `.srt`; экспорт плеера — `srt` через
  `devSpace:readArtifact` + диалог текстового сохранения, `mp3` — конкатенацией фреймового чтения
  (`podcast:audio`) в Blob-загрузку (существующий паттерн экспорта рендера).
- **N-агентный подкаст** — реализовано (v1.x-рычаг): `PodcastRoleTemplate[]` принимает 2..6 ролей
  (`id`: `host` первым, `expert` вторым, далее `guest1`..`guest4`; уникальность обязательна; порядок массива
  = порядок представления, первую роль (`host`) открывает и закрывает итогом). Промпт сценария перечисляет
  все роли, парсер матчит `speaker` по `id` или ярлыку (было). Границы: голоса берутся циклично из
  `PODCAST_VOICE_REGISTRY` по полу роли (по умолчанию первая female, вторая male, далее чередование; только
  RU-голоса) — при ролей больше голосов они **переиспользуются** (честный хинт в студии); порядок ролей
  фиксирован (`host` первым), `MAX_PODCAST_SEGMENTS` не менялся.
- **v1 (базовый)** — два голоса (ведущий + эксперт) остаются дефолтом `DEFAULT_PODCAST_ROLES` и формой
  запуска без `roles` (D13).
- **Post-media потолки** — оставлены явными: `data:` URL ≤ 32 MiB (`PODCAST_AUDIO_URL_MAX_BYTES`),
  окно `podcast:audio` 192 KiB, лимиты эпизода/манифеста в `episodes.ts`. Для эпизодов свыше 32 MiB
  плеер обязан идти фреймовым чтением, а не `audioUrl`.

---

## 7. Прочие решения catch-up merge

- Бюджеты бандла пере-записаны после каждого merge волны (`perf-baselines/bundle-size.json`).
- Восстановлены `shell:action` и `appearance:accentChanged` в `BROADCAST_EVENT_CHANNELS` при
  фикс-форвардах `main` (коммит `2002c3ff4`).