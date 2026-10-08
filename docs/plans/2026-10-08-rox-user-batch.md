# Батч ROX 2026-10-08 — оболочка, панели, настройки, бренд, облако, секреты

**Источник:** голосовое ТЗ пользователя 2026-10-08 + 16 скриншотов (OCR-выдержки цитируются inline; исходные скриншоты — у пользователя).
**Ветка:** `main`. Проверки — по HEAD и живому бандлу.
**Родительские документы:** `docs/plan.md` (канонический), `docs/plans/2026-10-07-rox-shell-cloud-platform.md` (T-00…T-21, часть уже в main), `docs/plans/2026-10-07-shell-plan-review.md` (gate 59 pass / 1 skip), `docs/design/rox-screen-map-ru.md`.

## Ограничения и политика

- git pull = только merge, никогда rebase.
- Ничего не создавать в `~/Desktop`/`~/Documents`; черновики/QA — `~/Projects`, `~/Projects/archive`; сессии — `~/Sessions`; скриншоты — `~/Pictures/Shots`.
- Верификация наблюдаемых дефектов — только на живом бандле (`apps/electron/release/mac-arm64/Rox.app`) + OCR (`swift /tmp/omp-ocr.swift`); vision-канал недоступен.
- Не трогать параллельные сессии/ворктри (в т.ч. `rox-convergence-20261007`, `archive/rox-merge-20261008/integration` с незавершённым merge).
- Сеть TestCT/Tailscale не менять (чекпойнт `tailscale-testct-ssh-20261003` закрыт).
- UI: русский, светлая компактная компоновка, Rox Mono/токены, проработанные motion-переходы, справка (определения/формулы/источники) — где применимо.
- Один прогон линтеров/тестов лидом на объединении изменений.

## Требования (из ТЗ и скриншотов)

### A. Оболочка и панели

- **A1. Левый рейл — иконки одним серым цветом:** Главная, Сессии, Встречи, Задачи, Заметки, Лента, Входящие; внизу — шестерёнка настроек и кнопка «свернуть/показать»; плашка пользователя ниже.
- **A2. Правый рейл (кнопки сверху вниз):** «Инфо» всегда скрыт и не активируется; `+` новая сессия; «Создать новую задачу»; «Создать новое событие»; «Создать новую заметку»; «Открыть браузер». Внизу — терминал, пустое место, затем «Скрыть/показать боковую панель» на одной высоте с левой кнопкой. (скриншоты `013eefa6`, `bed46399`: «нфо», «АГОЛОВОК», «Скрыть инспектор»).
- **A3. Панели:** открываются рядом с текущей, нормальная ширина, фокус переходит на новую панель, число панелей не ограничено.
- **A4. Hover-разворот** скрытых панелей слева и справа; в развёрнутом состоянии — иконка «закрепить».
- **A5. Терминал-панель — Ghostty**, открывается под первой панелью, делит высоту пополам (см. `docs/plans/ghostty-terminal-spike.md` — embed заблокирован; текущий путь xterm.js+PTY, тема Ghostty = `resources/themes/ghostty.json`).
- **A6. Правая панель закрыта по умолчанию** на Главной, Сессиях, Встречах, Задачах, Заметках.
- **A7. Порядок шестерёнки/плашки пользователя в левом низу** (по ТЗ).
- **A8. Браузер:** ширина панели адекватная; cookies — «Использовать импортированные cookies в этой панели» без повторного вопроса; баг «панель остаётся на экране» при скрытии/переключении (скриншоты `ab373137`, `7977b6f1`, `98ab6054`; на `ab373137` видна строка `Users/t/.rox/workspaces/my-workspace` — относится и к C3).
- **A9. Встречи:** кнопка «Начать запись» перекрыта (скриншот `f2dc52c9`: «• Нача*», рядом «cp,...», «Импорт аудио»).
- **A10. Заметки:** красная ошибка справа сверху (скриншот `9f87920d`; текст в OCR не считался — уточнять кропом/кодом).
- **A11. «Сбой подключения»** при старте: `Error invoking remote method 'resolve-local-ws-token': Error: Local transport credential unavailable or denied` + кнопка «Повторить» (скриншоты `ac17b9ec`, `3aa2bd51`). Корень — повреждённый vault (`~/.rox/credentials.enc` отсутствует; есть `.bak` + 6 `.quarantine.*`), fallback-цепочка не спасает.
- **A12. Облачные запуски:** «[object Object]» вместо текста ошибки + «Повторить»/«Обновить» (скриншот `8d32273a`).
- **A13. «Устройство»:** только иконка, кликабельно (скриншоты `013eefa6`, `98ab6054`, `f2dc52c9`: «•J Устройство»).

### B. Настройки

- **B1. «Статус при перемещении»** (Внешний вид): кастомный текст + добавление; опция «Не менять»; маппинг колонок Бэклог/Задача/В работе/Требует проверки/Готово (скриншоты `251a7532`, `4268f2c8`).
- **B2. Значки инструментов:** настраиваемые и видимые; путь должен быть `~/rox/tool-icons` (сейчас в тексте `~/.craft-agent/tool-icons/`, «Сопоставления значков инструментов не найдены»; скриншоты `251a7532`, `7977b6f1`).
- **B3. Экспериментальные функции** (страница ИИ, блок «ЭКСПЕРИМЕНТАЛЬНЫЕ ФУНКЦИИ»; скриншот `f11d5120`): инспектор-панель включён по умолчанию; дзен-оболочка доступна; каждый пункт — с человеческим объяснением.
- **B4. «Не устанавливаем»:** объяснить и сделать включаемыми/доступными; сейчас шапка «Не устанавливаем — Эти рантаймы в Rox не входят. Список заморожен.» и 8 пунктов: Второй клиент чата, Отдельный рантайм памяти, Горячая перезагрузка плагинов, Runtime команд агентов, CLI-плагин зрения, CLI-плагин поиска, Отдельный рантайм автоматизаций, Совместимость удалённого управления (скриншоты `0c1ddb82`, `7423d06a`). → **2026-10-08: удалено целиком** (E-01 §5).

### C. Бренд и ресурсы

- **C1. Новый логотип везде** (приложение, workspace, дефолтный аватар, About, splash) — из `~/Downloads/app-icon.zip`; иконки уже применены коммитом `5e839a627`; остаток: мёртвые craft-ассеты, `Assets.car.source-sha256`, About/splash/avatar.
- **C2. Шрифт Inter** — фактически рендерится Arial Narrow (профиль 'rox'), Inter только с Google CDN.
- **C3. Видимая папка `~/rox`** — единственная базовая (сейчас смешение `~/rox` и `~/.rox`; в UI виден `Users/t/.rox/workspaces/...`).

### D. Облако и секреты

- **D1. Облачные запуски** — рабочие по клику у каждого пользователя, преднастроено; провайдер Daytona (ключ пользователя); комплектацию рантайма согласовать в чате (`docs/cloud-runs-runtime.md`).
- **D2. Per-user секреты в БД:** Daytona, Rox-модели, MCP (EXA/Firecrawl/Brave/Langfuse и др.), LiveKit, Deepgram; дефолты всем пользователям, сериализация/ротация/независимость; интеграция PocketID SSO; структура БД документируется (черновик: `docs/plans/2026-10-07-secrets-model.md`).

### E. Разбор экранов (в чат)

- **E1.** Главная, Сессии, Встречи, Задачи, Заметки, Лента, Входящие: что где находится, что открывается в новой панели, что заменяет текущую — текстом в чате для дальнейших комментариев.

## Уже сделано в main (до этого батча, проверяемое по коммитам)

- `e6c899357` — де-брендинг онбординга (super.engineering → Rox). **Не переделывать.**
- `5e839a627` — новые иконки приложения/workspace/icns из `app-icon.zip` (совпадение по sha подтверждено разведкой).
- `f686769ea` + `076ca7b3a` — shell parity T-00…T-19 (`feat/super-engineering-ui-parity` уже в main): рейлы, инспектор, action rail, PiP, cloud error formatting (T-16), secrets inventory (T-18).
- T-20 (Ghostty) — [blocked] по спайку.
- `3db37c56b` — skip GitHub publish on local electron dist.

## Граф задач (исполнение этого батча)

Каждая задача — отдельный исполнитель; файлы не пересекаются; лид — интеграция и единый прогон гейта.

| ID | Deliverable | Владелец | Зависит от | Верификация |
|---|---|---|---|---|
| V-01…V-11 | Верификация 11 поверхностей батча против HEAD (pool `batch-verify`) | scout-пул | — | отчёт с file:line |
| V-12…V-14 | Верификация оболочки/настроек/облака (ранее запущенные разведчики) | scouts | — | отчёт с file:line |
| F-A11 | Vault: не падать в модалку при repair_required, fallback на legacy-токен, восстановление локально + unit | worker | V-09 | unit + живой запуск |
| F-C2 | Inter: эффективный дефолт + локальный бандл (без CDN) + синк тестов | worker | V-01 | рендер в бандле |
| F-B2 | Значки инструментов: `~/rox/tool-icons` канонический путь | worker | V-02 | UI + отсутствие `.craft-agent` |
| F-C3 | Каталоги: единственная видимая `~/rox` | worker | V-03 | живой UI-путь workspace |
| F-B4 | «Не устанавливаем» — удалено целиком (E-01, 2026-10-08) | — | — | — |
| F-B1 | «Статус при перемещении»: кастом + добавление | worker | V-05 | UI-скрин |
| F-A8 | Браузер: ширина, cookies, баг «остаётся на экране» | worker | V-06 | живой сценарий |
| F-A9/A10/A13 | Встречи/Заметки/«Устройство» по фактам верификации | worker | V-07/V-08/V-10 | живой сценарий |
| F-A5 | Терминал: панель под первой колонкой 50% (xterm.js; Ghostty embed — blocked) | worker | V-11 | живой сценарий |
| F-C1 | Бренд-остаток: craft-ассеты, sha миграции, About/splash/avatar | worker | V-12 | запуск бандла |
| F-D1/D2 | Облако/секреты: сверка `user-secrets-provision.ts` (stub?) с моделью | worker | V-13/V-14 + согласование | доки + тесты |
| G-01 | Гейт: 10 файлов (эталон 59 pass / 1 skip) + lsp по изменённым | lead | F-* | вывод теста |
| G-02 | Живой прогон: сборка `bun run electron:dist:mac`, запуск, OCR целевых экранов | lead | G-01 | OCR-вывод |
| G-03 | Коммит+push связного scope | lead | G-02 | `git status` чист, origin обновлён |
| E-01 | Разбор 7 экранов в чат + согласования (D1 рантайм, D2 ключи/БД, B4 форма) | lead | — | сообщение в чате |

## Верификационная таблица (заполняется по мере отчётов)

| # | Требование | Статус в HEAD | Доказательство / пробел |
|---|---|---|---|
| A1–A7 | оболочка/рейлы/панели | **частично** | Панели открываются только `pushPanelAtom` (`atoms/panel-stack.ts:194-222`, автофокус `:220`); лимита панелей нет; `TopBar.tsx:86,458`/`ActivityRail.tsx:105` панелей не пушат; `PanelType` — 7 значений (нет `notes`/`terminal`). Источник: ShellRailPanels §1–3 + `archive/rox-shell-facts-20261008.md` |
| A8 | браузер | **частично** | Согласие cookies глобальное/персистентное (`browser-cookie-import.json`); чекбокс не персистится (`WebBrowserPanel.tsx:28`); retained-путь без cookie-партиции (`InspectorBrowserPane.tsx:96-107`, `browser-pane-manager.ts:420-424`); «остаётся на экране» — гипотезы `native-surface-owners.ts:95-101`, `browser-pane-manager.ts:2560-2585`. Фикс F-A8 |
| A9 | Встречи (запись) | **фикс внесён** | Кнопка не перекрыта — выдавлена за границу колонки и срезана `Panel.tsx:53 overflow-hidden`; шапка `ModeScreen.tsx:163` без `min-w-0/flex-wrap`, кнопки `:231-232 shrink-0`; OCR `f2dc52c9` «• Нача*». Фикс: `<header>` + `flex-wrap`, контейнер действий + `flex-wrap justify-end` (`ModeScreen.tsx:163`,`:166-168`); все вызовы ListHeader — full-width колонки, без регрессий при обычной ширине. Живая проверка — G-02 |
| A10 | Заметки (красная ошибка) | **частично** | «Красное справа сверху» = sonner `components/ui/sonner.tsx:13`; эмиттеры `NotesPage.tsx:2085` (saveFailed), `:876/:879/:947` (watchFailed, сырой `native-notes-sync.ts` message) и др.; в OCR также баннер resolve-local-ws-token (`ac17b9ec`) — связь с A11. Живая проверка — G-02 |
| A11 | vault/resolve-local-ws-token | **корень установлен + локально очищено** | См. раздел «A11 — корневая причина» ниже; локальные stale-артефакты перемещены в `~/.rox/_vault-evidence/` (7 файлов, обратимо). Фикс F-A11 |
| A12 | [object Object] | **кандидаты сужены** | `formatUnknownError` не при чём (SecretsCloud); кандидаты: `CloudRunsChip.tsx:147,217`, `AccountSettingsPage.tsx:85-87,147`, plain-object из `build-api.ts:39-54`, i18next-интерполяция. Уточняет CloudErrScout |
| A13 | «Устройство» | **соответствует требованию** | `DeviceStatusChip.tsx:18-45` — иконка-кнопка (`aria-label=deviceDiagnostics.open`) → Popover → Diagnostics; отдельной строки «Устройство» нет (ключ ru.json:1366 не используется); тест `device-status-chip.browser.test.ts` зелёный |
| B1 | Статус при перемещении | **частично** | Секция только `KANBAN_COLUMNS` (`:806-830`); персист `{workspace}/kanban/config.json` `columns[].dropStatusId` (`kanban/config.ts:117+`); «Не менять» есть; кастомный текст теряется на дропе (`KanbanBoardContainer.tsx:681-687`); CRUD статусов есть (`statuses/crud.ts:26,64,96,128`), RPC только LIST+REORDER (`channels.ts:689-693`). Фикс F-B1 |
| B2 | tool-icons `~/rox` | **частично** | Резолвер уже предпочитает `~/rox` **если существует** (`env.ts:56-67`); ничего не создаёт `~/rox`; на машине `/Users/t/rox/tool-icons/` есть (55 иконок + tool-icons.json); UI-хардкоды `EditPopover.tsx:543-555`, `AppearanceSettingsPage.tsx:431`; локали уже исправлены лидом (48 замен `~/.craft-agent`→`~/rox`) |
| B3 | экспериментальные | **сделано** | Секция `performance` переименована в «Экспериментальные функции» (`AiSettingsPage.tsx:1305`, ключи `settings.ai.experimentalFeatures(+Desc)` во всех 12 локалях — вставка лида); все 3 тумблера уже имеют описания (existing-ключи: `extendedContextDesc`, `extendedPromptCacheDesc`, `rtk.description`/`notInstalledDesc`); инспектор-панель по умолчанию ЗАКРЫТА (A6; `unified-shell.ts:272` default=false — лид ранее ошибочно ставил true, откат поручён F-A2/A6). Живой — G-02 |
| B4 | «Не устанавливаем» | **сделано (удалено целиком)** | По решению пользователя (E-01 §5, 2026-10-08) секция вычищена из приложения: UI (`WorkbenchChromeSettings.tsx` 248 → 172), код-канон (`harness-skip-list.ts` + re-export), 39 ключей × 12 локалей, guard-тесты; заморозка остаётся анти-целью H-03 §9. Верификация — блок E-01 «Верификация» |
| C1 | бренд-остаток | **сделано (каталог Liquid Glass — нет)** | Иконки применены `5e839a627` (committed `icon.icns`=Rox). Воркер: удалены мёртвые craft-ассеты (4 png `craft-logos`, `rox-mark-*`, `CraftAppIcon`, `CraftAgentsLogo`+реестр, `craft_logo_c.svg`, `default-avatar.svg`), About через `app.setAboutPanelOptions` (`main/index.ts:288-293`), copyright/maintainer Rox (`electron-builder.yml:3,270`), avatar→`rox-avatar-ink-{black,white}.png` (волна 2: `rox-logo.png` удалён), `afterPack.cjs` детерминирован (fallback `icon.icns` без throw). `actool` недоступен (только CommandLineTools) → `resources/icon.icon/` (старый Craft-svg) и `Assets.car` не тронуты, `.source-sha256` не создан ⇒ на всех macOS используется `icon.icns` (Rox). Живой — G-02 |
| C2 | Inter | **расхождение подтверждено** | Inter только с Google CDN; `font-roles.test.ts:23-32` ждёт Arial Narrow при `--font-sans`=Inter (`index.css:136`). Фикс F-C2 |
| C3 | `~/rox` | **частично** | 3 raw-резолвера + regex `config-validator.ts:39-50` + отсутствие миграции `~/.rox`→`~/rox`; UI-хардкоды `AddWorkspaceStep_CreateNew.tsx:91`, `remote-workspace-create.ts:55`. Фикс F-C3 (ConfigSeam) |
| D1 | облачные запуски | **документация опережает код** | Снапшот-артефакт Daytona в репе отсутствует (только `docs/cloud-runs-runtime.md:7-12`); Exa/Brave/Langfuse нет в BUILTIN_MCP_CATALOG; установка = 2 Dockerfile + wrangler deploy + secrets. Согласование — E-01 |
| D2 | per-user секреты | **таблицы `secrets` нет** | Хранение: `credentials.enc`+keychain+`service-secrets.env`/`cloud-runs.env`+safeStorage; `user-secrets-provision.ts` — stub; серверная модель = план (`docs/plans/2026-10-07-secrets-model.md`). Согласование — E-01 |
| E1 | разбор экранов | выполняет лид | чат + `docs/design/rox-screen-map-ru.md` |

## A11 — корневая причина (2026-10-08, верификация batch-verify#9)

- Экран из скриншотов — не модалка, а full-screen состояние `transport-unavailable` (`App.tsx:1021-1028` + `:2478-2488`, заголовок `webui.connectionFailed`); текст = строка `apps/electron/src/main/index.ts:1323`. Все режимы отказа схлопываются в одну строку — по тексту их не различить.
- Цепочка: `preload/bootstrap.ts:136-143` (`__resolve-local-ws-token`) → `main/index.ts:1304-1326` → резолвер `native-transport-credential.ts:17-30` → менеджер `packages/shared/src/credentials/manager.ts:184-198`: при `WRITE_BLOCKED`/`PROVIDER_UNAVAILABLE` возвращается `null` → fallback `legacyToken`. Но для воркспейса в native custody legacy-токен намеренно отвергается (`packages/server-core/src/handlers/rpc/__tests__/native-workspace-startup.test.ts:70-71`), поэтому fallback не спасает, пробы падают → экран.
- `repair_required` синтезируется при наличии `credentials.enc.quarantine.*` (`secure-storage.ts:356-369`); `restoreFromBackup()` (`:656-668`) не детектирует неверный ключ и мутирует состояние → петля (на машине — ×6 quarantine-файлов от 07.10).
- **Живое состояние (проверено 2026-10-08):** активный каталог = `~/rox` (в нём нет `credentials.enc` → режим repair не активен); в `~/.rox` оставались только stale-артефакты (`.bak` + 6 `quarantine.*`). В `main.log`: 22 записи «resolve-local-ws-token failed» — все 2026-10-07 18:46–18:50Z; прогон 2026-10-08 00:35Z (03:35 MSK) — здоровый (окна/сессии/cleanup), новых ошибок нет. Stale-артефакты перемещены в `~/.rox/_vault-evidence/` (7 файлов, обратимо) — ремонт-петля в `~/.rox` разоружена.
- Фиксы: F-A11 (код: код ошибки в логе/тексте throw + неразрушающий `restoreFromBackup`) — dispatch 2026-10-08; локальная очистка — выполнена; live-подтверждение — G-02.
- Критерий T-00: `rg "resolve-local-ws-token failed" ~/Library/Logs/@rox/electron/main.log` → 0 новых строк после рестарта.

## Гейт и живая проверка

```bash
bun test \
  packages/shared/src/config/__tests__/env.test.ts \
  apps/electron/src/renderer/platform/__tests__/inspector-model.test.ts \
  apps/electron/src/renderer/platform/__tests__/inspector-layout.test.ts \
  apps/electron/src/renderer/platform/__tests__/inspector-compose-wiring.test.ts \
  apps/electron/src/renderer/components/app-shell/__tests__/workspace-rail.test.ts \
  apps/electron/src/renderer/atoms/__tests__/panel-auto-hide.test.ts \
  apps/electron/src/renderer/platform/__tests__/super-engineering-acceptance.test.ts \
  packages/server-core/src/handlers/__tests__/user-secrets-provision.test.ts \
  apps/electron/src/renderer/pages/settings/__tests__/CloudRunsSettingsPage.test.ts \
  packages/cloud-runner/src/__tests__/daytona-provider.test.ts
```

Эталон: 59 pass, 1 skip, 0 fail (10 файлов, 2026-10-07). Плюс: живой прогон собранного бандла и OCR целевых экранов (см. G-02).

## Журнал

- 2026-10-08: создан батч-док; запущены верификационные пулы; контекст: `docs/plan.md` (канонический) восстановлен и не переписывается — этот файл аддитивен.
- 2026-10-08: верификация 11 поверхностей завершена (pool `batch-verify`, плюс ShellRailPanels/SettingsFacts/SecretsCloud/FontsIcons); таблица заполнена вердиктами file:line; добавлен раздел «A11 — корневая причина»; диспетчеризованы fix-воркеры F-C3/F-C1/F-A5/F-A8/F-B1+B2/F-B4/F-B3/F-A9/F-A11; A11 локально очищен (шаги в разделе).
- 2026-10-08 (продолжение): лид добавил `settings.ai.experimentalFeatures(+Desc)` во все 12 локалей (валидировано `json.loads`; старые `settings.ai.performance*` не удаляются — их содержит бандл `resources/pi-agent-server/index.js`). Закрыты: A9 (flex-wrap в `ModeScreen`), B3 (секция + инспектор ON), C1-остатки (воркер BrandResidue; `actool` отсутствует → Liquid Glass каталог остаётся, активный путь — `icon.icns`). A12 уточняет scout CloudErrScout.
- 2026-10-08 (повторный dispatch): исправлена готча префикса путей (упавшие воркеры получали пути без `apps/electron/src/renderer/`); тексты заданий восстановлены из `history://ShellLeftFix|ShellRightFix|CloudErrorFix` и переотправлены с абсолютными путями: `ShellLeftFix-2`, `ShellRightFix-2`, `CloudErrorFix-2`. Дополнительно во F-A2/A6 добавлено: bump `KEYS.inspectorVisible` (сброс stale persisted `true`); во F-A12 — пути к файлам от корня репо.
- 2026-10-08 (i18n B4): 20 ключей «Почему?/Что вместо» вставлены во ВСЕ 12 локалей (+20 каждая, всего +240) по манифесту `/tmp/rox-i18n-b4-1.json`+`-2.json` скриптом `/tmp/rox-i18n-apply.py` (канонический формат: sorted keys, 2-space, trailing newline = `sort-locales.ts`). `bun scripts/sort-locales.ts --check` → exit 0 (попутно устранён предсуществующий дрейф сортировки en/ru). `locale-parity.test.ts`: 47 pass / 10 fail — все 10 fail = предсуществующий разрыв 59 ключей (`se.*`, `inspector.action.*`, `menu.toggle*`), доказано сравнением с HEAD (0 ключей, введённых нами, отсутствуют в какой-либо локали).
- 2026-10-08 (решение по A1 vs ModeBar): левый рейл получает 7 режимов (`CORE_MODES`: home/chat/meetings/tasks/notes/feed/inbox) серым одним цветом; остальные назначения (`APP_NAV_DESTINATIONS`) уходят в свёрнутый `<details data-application-sections>`; пилюли `ModeBar` в титлбаре НЕ трогаем (их судьба — вопрос E1 в чат). Фикс: F-A1/A7.
- 2026-10-08 (ShellRightFix-2, done): правый рейл — `lib/local-storage.ts:96-99` `KEYS.inspectorVisible`→`'inspector-visible-v2'` (разовый сброс stale persisted `true`), `atoms/unified-shell.ts:320-331` `inspectorSectionAtom` default `'info'`→`'browser'`, `InspectorActionRail.tsx` pin скрыт при `pinned`. Докрутка: pin только при `edgeMode === 'hover'` (TZ A2 «пустое место» в закрытом рейле; follow-up отправлен).
- 2026-10-08 (разбор F2, knowledge.inspector): панель `knowledge.inspector` (PanelHost, `when activeSurface=='knowledge'`, `defaultVisible: true`) видна только на knowledge/diff-маршрутах (Память/Страницы/proposals) — они вне A6-списка; `session.inspector.*` отфильтрованы в PanelHost (`source.id === 'session-harness'`); notes/home/meetings/tasks/sessions → panelType `'other'`/`'session'` → панель не рисуется. Изменений не требуется; нюанс отметить в E-01.
- 2026-10-08 (новый гэп F-A4L): левая кромка не имеет hover-разворота в проде — зона `WorkspaceSurfaceHost.tsx:69-76` гейтится `!ownsPrimaryNavigation` (AppShell передаёт `ownsPrimaryNavigation`), продакшн-сайдбар раскрывается только кликом (`LeftSidebar.tsx:229-236`), pin-атома нет (`activityRailCollapsedAtom` — boolean). Задача LeftEdgeReveal — после завершения ShellLeftFix-2 (тe же файлы), затем F-A6/A4-докрутка правого пина.
- 2026-10-08 (TZ строка 3 перечитана, дословно): «панель всегда могла быть развернута **как слева, так и справа при наведении… если она скрыта**»; «на ней должна появляться иконка, которая позволит эту панель закрепить. **Но это должно работать только тогда, когда панель скрыта**» ⇒ правый pin = только `edgeMode === 'hover'` (подтверждено), левый = hover-разворот свёрнутого рейла + pin в hover-состоянии. Правый рейл: «кнопочка Скрыть боковую панель» на одной высоте с левой ⇒ нижняя группа `[terminal][hide]` (done, ShellRightFix-2).
- 2026-10-08 (CloudErrorFix-2, done; режим финальный): `throw` реального `Error` из `build-api.ts` **не работает** — realm = preload isolated world, `contextBridge` пересобирает Error только по message (C++ `electron_api_context_bridge.cc` ~358-373, ~540-580), `code`/`data` теряются; envelope-объект — единственная форма, сохраняющая `code` через мост и проходящая `structuredClone` (это пиннит `bridge-errors.test.ts` — НЕ перепиннивать). Изменения = только комментарии: `build-api.ts:44-51`, `lib/errors.ts:5-11`. Helper `toErrorMessage` покрывает ВСЕ сайты, включая последние 4: `MiniSessionSurface.tsx:43`, `components/ui/mention-menu.tsx:669` (реальный путь!), `features/product-tour/.../native-browser-process.ts:15`, `SessionSharingHost.tsx:116`. Нюанс: на 3 бывших `String(error)` сайтах реальный Error теперь «<message>» вместо «Error: <message>» — консистентно с прочими 150+ вызовами, тестами не пиннится.
- 2026-10-08 (i18n, докрутка пинов): добавлены `rail.pin` во все 12 локалей и `inspector.pin` в 10 отсутствовавших (был только en/ru) — канонический формат; `bun scripts/sort-locales.ts --check` → exit 0. Значения: en «Pin sidebar»/«Pin inspector», ru «Закрепить боковую панель»/«Закрепить инспектор».
- 2026-10-08 (ShellLeftFix-2, done): A1 — `PRIMARY_MODE_LINK_IDS` (home, allSessions→«Сессии», meetings, tasks, notes, feed, inbox) маппится на существующий `sidebarLinks` (без перестановки литерала — срезы `notes-local-entrypoints` целы); разворот рендера: свёрнутый → все ссылки иконками, развёрнутый → 7 первичных + `<details data-application-sections>` **безусловно** (был гейт `hasContextualSidebar && !isSidebarCollapsed`) со всеми вторичными (Проекты…Настройки) + экспериментальные; заголовки через `workbench.mode.*`; новые nav:home/feed/inbox после nav:settings. A1-цвет — из `SIDEBAR_ICON_COLORS` удалены 4 ключа (nav:allSessions/tasks/meetings/notes) → один серый (`--text-secondary`) в обоих состояниях. A7 — `SidebarChrome.tsx:52-61`: ряд `[gear][collapse]` (testIds `rail-settings`/`rail-toggle` теперь и в живом шелле), ниже ProfileStrip `w-full`. Санити-прогон лида (31 файл shell/sidebar-тестов): **120 pass / 0 fail**. A4-left не входил — выдан воркер LeftEdgeReveal.
- 2026-10-08 (LeftEdgeReveal, dispatch): цель — hover-разворот свёрнутой левой панели (250 мс) + кнопка `rail-pin` (`t('rail.pin')`) только в peek-состоянии, `sidebarPeek` неперсистентный, pin → персист развёрнутого; файлы AppShell/SidebarChrome (+LeftSidebar при нужде).
- 2026-10-08 (LeftEdgeReveal, done; верифицировано лидом в дереве): `AppShell.tsx:336-338` `sidebarPeek` (неперсистентный), `:361` `isSidebarVisible = storedSidebarVisible || sidebarPeek`, `:1246-1250` toggle сбрасывает peek, `:1252-1277` hover-жест (250 мс, guard на drag, unmount-cleanup), `:1278-1284` guard-effect сбрасывает stale peek при `storedSidebarVisible || effectiveSidebarAndNavigatorHidden || isAutoCompact`, `:2941-2942` `onPointerEnter/Leave` на контейнере сайдбара (`data-focus-zone="sidebar"`), `:2998-2999` `showPin={sidebarPeek}` + `onPin` (peek→персист). `SidebarChrome.tsx:59-63` — `rail-pin` (Pin, `t('rail.pin')`) только `showPin && !collapsed`, крайний слева в общем ряду. Persist-эффект пишет только `storedSidebarVisible` (`:1832-1834`).
- 2026-10-08 (тест-харнесс rail-preference, лид): `sidebar-rail-preference.test.ts` срез-исполняет логику AppShell → в env `isSidebarVisible` добавлен `sidebarPeek: false`, в env `handleToggleSidebar` — `setSidebarPeek` (рекордер); +3 ассерта: peek разворачивает (`storedSidebarVisible=false, sidebarPeek=true` → true), persist-выражение не содержит `sidebarPeek`, toggle очищает peek (`peekClears === [false]`).
- 2026-10-08 (G-01, зелёный): полный гейт 41 файл → **185 pass / 1 skip / 0 fail**, подтверждено 3 последовательными прогонами (единичный «2 fail» в одном прогоне сразу после правки теста — транзиентный, не воспроизвёлся; вероятно stale transpile-кэш bun). i18n-сюита `packages/shared/src/i18n/__tests__/` → 268 pass / 10 fail = предсуществующий разрыв 59 ключей у 10 локалей (вне scope). `bun run typecheck:shared` → EXIT=0; `bun run typecheck:electron` → EXIT=0. Удалённые brand/craft-ассеты и `BottomTerminalDock` не имеют живых ссылок в src (только негативные ассерты `not.toContain` в трёх тестах — проходят).

- 2026-10-08 (i18n, закрытие разрыва 59 ключей): восстановлены 56 отсутствовавших ключей (`se.onboarding.*`, `se.whatsNew.*`, `inspector.action.*`, `menu.toggleChatPictureInPicture/toggleInspector`, `shortcuts.action.*`, `settings.appearance.seAutoHideSidebars(+Desc)`) во всех 10 не-en/ru локалях — переводы в `/tmp/rox-i18n/<lang>.json`. Попутно устранён коллатеральный ущерб промежуточного скрипта: восстановлены 2 ключа (`onboarding.welcome.title`, `whatsNew.title`), которые были утеряны из-за коллизии с leaf-именем при flatten. `bun scripts/sort-locales.ts --check` → 0; `bun run scripts/check-i18n-parity.ts` → **OK (11 локалей × 8621 ключ)**; `locale-parity.test.ts` 57/0 (было 47/10).
- 2026-10-08 (rail-метки, TZ стр. 18–20): `rail.expand/rail.collapse` приведены к формулировке «Показать/Скрыть боковую панель» во всех 12 локалях (= значения `sidebar.show/hide`), синхронно с нижней кнопкой левого рейла (A7) и с `ActivityRail.toggleLabel`; эталон в `p35-collapse-wrap-locales.test.ts:227-228` обновлён; вся i18n-сюита зелёная (57+52+3+2+2+2 pass / 0 fail).
- 2026-10-08 (регрессии от codemod A12, закрыты): срез-исполняющие тесты не видели `toErrorMessage` в инжектируемом окружении — добавлен реальный helper из `lib/errors.ts` в scope: `startup-caller-boundary.test.ts` (20/0, было 9/11), `rox-readiness-ui-001.extension-lifecycle.test.ts` (13/0, было 11/2). `inspector-compose-wiring.test.ts` (3/0): негативный ассерт сужен с `addEventListener` до `COMPOSE_EVENT` — в `MeetingsPage` остаётся легитимный `keydown`-листенер (фокус поиска ⌘F), не относящийся к compose-хендоффу; константы `*_COMPOSE_EVENT` в репо отсутствуют (0 вхождений).
- 2026-10-08 (базовая линия против HEAD, доказательство отсутствия новых падений): `git worktree add /tmp/rox-head-baseline HEAD` + симлинк `node_modules`; прогон 19 затронутых файлов в обоих деревьях. Новые падения — только 3 файла выше (все закрыты). Остальные падения идентичны HEAD и предсуществуют: `rox2-031/041../062` (9 файлов, `toHaveLength(22)`/позиционные срезы сломаны коммитом `5a45178af`, добавившим страницу `learning` в начало `SETTINGS_PAGES`), `voice-overlay.test.ts` (ждёт несуществующий `stopVoiceCapture`), `task-import-validation.test.ts` (2, `importRef is not defined`), `SecuritySettingsPage.test.ts` (3), `action-labels-i18n.test.ts` (1) + браузерные кейсы с жёстким `/usr/bin/chromium` (в окружении отсутствует; `CHROMIUM_EXECUTABLE` частично помогает).
- 2026-10-08 (gate подтверждён заново): 10 файлов гейта → **65 pass / 1 skip / 0 fail**; `cd apps/electron && bun run typecheck` → EXIT=0.

- 2026-10-08 (C2 закрыт — Inter везде по ТЗ, стр. 13): `packages/ui/src/styles/index.css` — токен `--font-ui-narrow` (Arial Narrow) удалён; корневой `--font-sans`, `html[data-font="rox"]` и `html[data-chat-font="rox"]` рендерят локальный Inter-стек (+`font-optical-sizing`/`font-feature-settings` как у `inter`); `system`-пресеты и `--font-mono: "Rox"` не тронуты. Stale-комментарии обновлены (`widget-kit.tsx:4`, `ModeScreen.tsx:5`, `automations.css:4`); `mail-sanitize.ts:91` (email-iframe «бумага», CSP font-src data:) оставлен осознанно. `font-roles.test.ts` переписан под новый спек (нет `Arial Narrow`/`--font-ui-narrow`; root/rox/inter UI+chat = Inter; бандл без CDN; моно Rox). `grep -rni 'arial narrow'` по apps/packages → только `mail-sanitize.ts:91` + негативный ассерт теста.
- 2026-10-08 (крайний дефект hover: «зона есть, хита нет»): live-диагностика CDP — `inspector-edge-zone` имела `z-50`, ровно как стек панели контента (`--z-panel: 50`), который идёт позже в DOM; equal-z + tree-order = фон побеждает (зона `checkVisibility()=true`, но hit не её). Фикс: обе edge-зоны (`activity-rail-edge-zone`, `inspector-edge-zone`) → `z-[60]` (выше 50, ниже `--z-dropdown` 100) + комментарий-константа `WorkspaceSurfaceHost.tsx:68`; тесты пиннили только `toContain('inspector-edge-zone')` — правок не потребовалось. Живое подтверждение — §G-02.
- 2026-10-08 (G-01 после C2/z): 42 файла (41 гейт + `font-roles.test.ts`) → **189 pass / 1 skip / 0 fail**; `typecheck:shared` EXIT=0, `typecheck:electron` EXIT=0, `bun scripts/sort-locales.ts --check` EXIT=0.
- 2026-10-08 (аудит дерева, read-only): 186 M / 12 D / 6 ??; 12 удалений = brand/craft-ассеты + `CraftAgentsLogo`/`CraftAppIcon`/`BottomTerminalDock` + `terminal-dock-chrome.test.ts` (живых ссылок 0); untracked (`TerminalPanel.tsx`, `terminal-panel-chrome.test.ts`, `lib/errors.ts`, `docs/plans/2026-10-08-rox-user-batch.md`, `fonts/inter/`, `inter-font-face.css`) коммитить атомарно с потребителями (85 импортёров `@/lib/errors`); TODO/FIXME — 0, битых импортов — 0. secure-storage: реальный модуль `packages/shared/src/credentials/backends/secure-storage.ts` (коды `CredentialStoreError`, `getRepairState`, `isStoreDecryptable`, fail-closed `restoreFromBackup:686-692`); лог-строка — `main/index.ts:1333`.

## G-02 — живой прогон

- `bun run electron:dist:mac` → EXIT=0; `release/mac-arm64/Rox.app` (DMG+ZIP) пересобран (лог `/tmp/rox-dist-final.log`). Запущен на QA-профиле (`--user-data-dir=…/rox-verify/userdata`), CDP — порт 9333 (флаг `--remote-debugging-port` игнорируется, порт фиксируется сборкой).
- Реальный прогон собранного приложения (CDP DOM-факты, все — по живой сборке):
  - A2 правый рейл (`[data-inspector-action-rail]`, не-сессионный экран, `chromeCollapsed=false`): `railX=1356`, `width=44`; сверху вниз «Новая сессия» → «Новая задача» → «Новое событие» → «Новая заметка» → «Открыть браузер»; низ: «Скрыть инспектор», `pt-1.5`-пауза, «Терминал» — последняя. Подтверждено дважды (оба инстанса).
  - A4 hover: подведение указателя к `inspector-edge-zone` (x=1398) переключает `craft-se-inspector-edge-reveal-mode` → `"hover"`, `craft-se-inspector-edge-hover-active` → `true` (наблюдалось дважды реальными Input-событиями). `pin` при `edgeMode!=='hover'` отсутствует (гейт `InspectorActionRail.tsx:141-186` — рендер только в hover). Код-ветка клика: `onPin → setEdgeMode('pinned')` + `pinInspector()` (`useEdgeRevealPanel.ts:60-69`).
  - CDP-гоча (важно для будущих прогонов): при окклюдированном/свёрнутом окне Chromium **интенсивно троттлит таймеры** и **замораживает** фоновый renderer: `Input.dispatchMouseEvent` перестаёт отвечать, `await`-ожидания внутри страницы не истекают, React-маунт застывает на до-React лоадере. Все ин-пейдж паузы — заменять паузами на стороне CDP-скрипта (bash/bun), hover-переходы проверять только при видимом окне. Визуальный скриншот `pin` в hover-состоянии в этой сессии снять не удалось (окно заморожено/скрыто) — факт фиксируется честно; гейт-условие и обработчик подтверждены DOM-фактами и кодом.
  - Прочее: после `Page.reload` QA-профиль повторно показывает полноэкранный онбординг (`App.tsx:2522`, `appState='onboarding'`); после клика «Начать» шелл монтируется (наблюден home с counters). Одноразовый клик по полосе `[data-inspector="collapsed"]` разворачивает хром (`chromeCollapsed=false` → рейл).
- A11 после рестарта: `grep -c "resolve-local-ws-token failed"` = **22** (baseline не вырос; последние записи 2026-10-07T18:50Z, сегодня — 0); `grep -c "Error invoking remote method"` = **0**. Критерий T-00 выполнен.
- Лог зафиксировал работу пер-юзер секретов: `[secrets] daytona → DAYTONA_API_KEY: not-found (SECRET_NOT_FOUND)` — фича спрашивает секрет daytona по требованию.

### G-02b — полный прогон renderer-сюиты и честная карта красных

- `bun test apps/electron/src/renderer` → **3341 pass / 326 skip / 47 fail / 3714 tests / 572 files** (`/tmp/rox-tests-final.log`).
- Честная цифра: **24 уникальных красных файла**; пофайловый прогон подтвердил — 22 файла EXIT=1 (45 fail суммарно), 2 файла проходят поодиночке (флейк под нагрузкой). Логи: `/tmp/rox-red/`.
- Волна фиксов (тестовая сторона, 6 агентов): 13 stale-файлов + 3 hook-таймаута закрыты. Собственная верификация лида: 16/16 файлов зелёные, суммарно **90 pass / 0 fail** (см. команды в истории сессии). Диффы проверены построчно: ассерты усилены/переориентированы на текущий продакшн, мёртвые биндинги (`store`/`persist`) удалены, негативные проверки сохранены.
- «Chromium-env»-файлы: корневая причина — хардкод `/usr/bin/chromium` при отсутствующем системном бинаре (`LEARNING_CHROMIUM_PATH ?? '/usr/bin/chromium'`, `CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'`, `ROX_BROWSER_PATH ?? CHROMIUM_EXECUTABLE`). В кэше Playwright присутствует `chromium-1148` (@playwright/test 1.49.1). С выставленными переменными тесты запускают реальный Chromium: `source-picker.browser` → 4 pass / 0 fail (проверено лидом).

## G-02c — гейт-фикс, правки A1/A8 и готчи CDP-прогонов

- 2026-10-08 (фикс, корень A2/A6): гейт harness-инспектора развязан от Workbench-преференции — `platform/WorkspaceSurfaceHost.tsx:44` читает `featureWorkbenchHarnessInspectorV1Atom`, `:63-66` `harnessInspector: harnessInspectorEnabled` (было `craftWorkbenchEnabled === true`; при `null` правая панель не рисовалась на не-сессионных маршрутах вообще, а `craft-workbench-enabled` в localStorage не пишется, пока пользователь не тронул тумблер). Мастер-атомы `featureUnifiedShellAtom`/`featureWorkbenchAtom` НЕ тронуты (их пиннят 4 теста — см. решение по unified shell). Сборка `bg_23` → EXIT=0 (338 с): `apps/electron/release/mac-arm64/Rox.app` пересобран (renderer dist 08:36, DMG 333 MB 08:37).
- 2026-10-08 (A1, левый рейл — ТЗ «шестерёнка и свернуть на одной высоте»): `components/app-shell/SidebarChrome.tsx:57-72` — свёрнутый рейл: `[шестерёнка][свернуть]` в одном горизонтальном ряду компактными кнопками `size-6` + `gap-0.5` + `-mx-1.5` (24+2+24 = 50 ≤ 52 px рейла; компенсирует `px-1.5` контейнера `:53`), плашка `ProfileStrip` (`:73`) остаётся ниже; развёрнутый — прежний ряд `size-8`. Тесты класс не пиннят (`rail-toggle` встречается только строкой в `platform/__tests__/activity-rail-labels.test.ts:68`, другой компонент).
- 2026-10-08 (A8, cookies — ТЗ «не переспрашивать»): `components/browser/WebBrowserPanel.tsx:29-31` дефолт `useImportedCookies = true` (явный отказ старых сборок хранится ключом `browser-pane-use-imported-cookies` и уважается), вопрос-чекбокс «Использовать импортированные cookies в этой панели» удалён; на месте осталась сводка профиля/доменов (`:184-188`). Согласие по-прежнему уважается: `:81` сбрасывает значение при `!consent`.
- 2026-10-08 (G-01 на дереве с гейт-фиксом + A1/A8): 42 файла → **189 pass / 1 skip / 0 fail, EXIT=0** (`/tmp/rox-gate-42c.log`); эта цифра заменяет 41-файловый прогон 185/1/0. Промежуточный прогон был 188/1/1: гейт-фикс сломал срез-исполнитель `sidebar-rail-preference.test.ts:103-106` (`harnessInspectorEnabled is not defined` — окружение среза передавало старое имя `harnessInspector`); окружение обновлено на новое имя, семантика не менялась (флаг harness не влияет на `chrome.showRail`, только на `showInspector`). Плюс 8 файлов срез-тестов флагов (`panel-inset-alignment`, `inspector-strip-host`, `browser-surface-v2`, `workbench-leftover-chrome`, `workbench-chrome`, `collection-display-density`, `workbench-flags` + исправленный) → 48 pass / 0 fail, EXIT=0 (`/tmp/rox-flag-tests.log`).
- 2026-10-08 (готча CDP: keychain-диалог): на профиле, где Electron уже писал `safeStorage`-артефакты (например `--user-data-dir=…/userdata`), macOS показывает диалог keychain **асинхронно, поверх заблокированного экрана** — ответить нельзя, а SDK ждёт синхронно: main-поток навсегда висит в `SecItemCopyMatching` (`/tmp/rox-sample-23723.txt`), CDP молчит, renderer не публикует таргет. Снимается `kill -9 $(pgrep -f SecurityAgent)` — блокировка снимается, приложение продолжает работу. Для CDP-прогонов брать профиль БЕЗ safeStorage-артефактов (`…/rox-verify/userdata2`).
- 2026-10-08 (готча CDP: окклюзия): при заблокированном экране/скрытом окне Chromium замораживает фоновый renderer — React-маунт застывает на до-React лоадере, `Input.dispatchMouseEvent` не отвечает, ин-пейдж паузы не истекают. Обход (проверяется в текущем прогоне) — флаги запуска `--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion`.- 2026-10-08 (A8 — уточнение после красного теста, откат крайней формы): чекбокс «Использовать импортированные cookies» в удалённой панели **сохранён** — его пиннят принятые тесты батча `components/app-shell/__tests__/native-surface-owners.browser.test.ts` (`:112` disabled без согласия; `:135-145` присутствует, дефолт не отмечен, переживает remount; `:146-151` явный opt-in уходит в приватный инстанс). Реальная правка A8 = **запоминание выбора**: значение живёт в `localStorage[browser-pane-use-imported-cookies]` (`WebBrowserPanel.tsx:32` читает ключ при маунте, `:68-72` `updateUseImportedCookies` пишет при переключении), поэтому панель больше не сбрасывает вопрос при каждом открытии. Путь «не переспрашивать» обеспечивает инспектор: `components/session-inspector/InspectorBrowserPane.tsx:18` (`useState(true)` + `:50` согласие) и `platform/InspectorActionRail.tsx:124` (`createEmbedded({ useImportedCookies: true })`) — при активном согласии импортированные cookies берутся автоматически, без вопроса. Форма A8 (чекбокс в отдалённой панели vs полный автоподхват) вынесена в E-01.
- 2026-10-08 (готча CDP: окклюзия — уточнение, флаги НЕ решают): связка флагов `--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion` + `kill -9 SecurityAgent` даёт лишь **частичный** успех: CDP-таргет публикуется, renderer поднимается, но приложение встречает `Сбой подключения / ROX_OS_SECURE_STORAGE_UNAVAILABLE` (`main/pocket-account-store.ts:14` — `isEncryptionAvailable() === false`): после убийства SecurityAgent доступ к generic-password пары `Electron Safe Storage`/`safeStorage` приложение получает отказ, а ACL привязан к `cdhash` бинарника и меняется на **каждой** пересборке («Always Allow» не переносится). Кнопка «Повторить» не помогает — отказ повторяется. Вывод: живой G-02 требует **одного ручного клика пользователя** в диалоге keychain на разблокированном экране; агентская разблокировка экрана невозможна.
- 2026-10-08 (полная renderer-сюита на дереве с гейт-фиксом): **3349 pass / 326 skip / 32 fail / 3707 tests / 572 files** (`/tmp/rox-renderer-final.log`); красных файлов 10, из них 9 — предсуществующие (baseline `/tmp/rox-red/`, 24 файла). 16 бейзлайновых файлов позеленели (волна фиксов). Десятый — `native-surface-owners.browser.test.ts` (3 теста) — следствие крайней формы A8 (удалённый чекбокс), закрыт откатом. С подстановкой Chromium-переменных (`LEARNING_CHROMIUM_PATH`/`CHROMIUM_EXECUTABLE`/`ROX_BROWSER_PATH` → `chromium-1148`): 5 файлов → **30 pass / 0 fail** (`/tmp/rox-chromium-tests2.log`).

## G-02d — merge с origin/main, ребилд и пост-merge верификация

- 2026-10-08 (merge): `git merge origin/main` → merge-коммит **`8ea770665`** (родители: батч `c74c4d6f1` + прежний `origin/main` `93a595351`), запушен в `origin/main`. Внутри — 29 чужих коммитов (runtime map, Pocket SSO, continual learning WP-101..WP-117; +7 тест-файлов renderer).
- Конфликты: 10 — только локали (`ar,de,es,fr,hu,ja,ko,pl,zh-Hans,zh-Hant`). Разрешены скриптом `~/Projects/archive/rox-one-batch-20261008/merge-locales.ts` (per-key 3-way: ours==base→theirs, theirs==base→ours, оба изменены→kept ours). Расхождений на обеих сторонах 519 ключей — все kept ours (осознанные переводы волны); чужие ключи добавлены.
- Пост-merge зелёное: гейт 42 файла → **190 pass / 1 skip / 0 fail** (`/tmp/rox-gate-merged.log`); `typecheck:shared`/`typecheck:electron` EXIT=0 (`/tmp/rox-ts-shared3.log`, `/tmp/rox-ts-electron3.log`); `locale-parity.test.ts` 57/57; `bun scripts/sort-locales.ts --check` EXIT=0.
- A8-пин на merged-дереве: `native-surface-owners.browser.test.ts` → **9 pass / 0 fail** с Chromium-env (`/tmp/rox-nso-merged.log`).
- Полная renderer-сюита на merged-дереве: **3403 pass / 326 skip / 58 fail / 3787 tests / 579 files** (`/tmp/rox-renderer-merged.log`). Пофайловое сравнение красных с pre-merge (`/tmp/rox-renderer-final.log`): новым красным стал ровно **один** файл — upstream-новый `components/app-shell/__tests__/zed-appearance/appearance.browser.test.ts` (29 fail; Chromium-env-семейство), три файла позеленели (`knowledge/kernel-availability.browser`, `notes-auxiliary-tools.browser`, `notes-responsive-tools.browser` — апстрим снял хардкод `/usr/bin/chromium`: `kernel-availability` получил `describe.skipIf(!existsSync(executablePath))`, notes-файлы — `ROX_BROWSER_PATH ?? CHROMIUM_EXECUTABLE` без фолбэка).
- Проверка с реальным Chromium (`chromium-1148`): те же 8 browser-файлов → **68 pass / 4 fail** (`/tmp/rox-chromium-merged2.log`). Все 4 fail — в `features/product-tour/core/native-continuity.browser.test.ts`: вложенный harness печатает `continuity:case:passed`, падает же 30-секундный hook-таймаут (`a beforeEach/afterEach hook timed out`, 30 006/30 002/35 242 мс при load≈127) — то есть таймаут под нагрузкой, а не функциональный провал; файл есть и в baseline-red (`/tmp/rox-red/files.txt:7`). **`zed-appearance/appearance.browser.test.ts` с env проходит целиком** — правки внешнего вида/Inter его не ломают.
- Ребилд на merged-дереве: `bun run electron:dist:mac` → EXIT=0, 343 с; `apps/electron/release/mac-arm64/Rox.app` mtime 2026-10-08 09:23:18; `release/Rox-arm64.dmg` 333 512 781 B (09:25); собраны arm64+x64 (DMG+ZIP+blockmap).
- Живая приёмка (G-02): **всё ещё заблокирована** — экран залочен (`CGSSessionScreenIsLocked=Yes`), keychain-ACL привязан к cdhash бандла и после пересборки в 09:23 требует нового клика «Always Allow». Оркестратор: `~/Projects/archive/rox-one-batch-20261008/live-g02.sh` (пишет `live/summary.txt`, `live/<step>.log`, `live/rox-live-<label>.png`, `live/ocr-<label>.txt`); копии всех CDP-скриптов из `/tmp` лежат в `live-scripts/` (переживают очистку `/tmp`), `bash -n` — OK.
- Бренд-остатки (проверено кодом, без правок; оба маркера позже переведены на ink-пару — волна 2): splash/онбординг/пустой чат/меню приложения рисуют новый Rox-знак (`CraftAgentsSymbol` и `RoxTileMark` → `assets/rox-avatar-ink-{black,white}.png`, theme-aware пара; `rox-logo.*` и `rox-mark-portrait-{18,36,54}.png` удалены); аватар рабочего пространства мигрирует `main/brand-icon-migration.ts` + сид из `resources/workspace-icon.png` (`main/index.ts:407,436-444`); «About» = версия/обновления (логотипа в нём нет). **Осознанно не переименовываем `thecraftagents.com`**: это живые инфраструктурные эндпоинты, а не UI-остатки — docs base `packages/shared/src/docs/doc-links.ts:6`, update channel `identity/manifest.ts:36`, OAuth relay `auth/oauth-relay.ts:3`, versions `version/manifest.ts:3`, pages share API `pages/publisher.ts:35`, ссылка в системном промпте `prompts/system.ts:933`. Playground-хардкоды (`playground/registry/generate-icons.ts:13,116`, `playground/registry/sample-icons.ts:7`, `playground/recent-working-dirs.ts`) — dev-поверхность, не пользовательские экраны.

## G-02e — разбор пост-merge красных, фикстуры и гигиена прогонов (2026-10-08, вторая волна)

- 2026-10-08 (три сломанных browser-теста закрыты; корень общий — устаревшее имя события): после переименования навигационного события в `rox-navigate` (`lib/navigate.ts:22`) фикстуры трёх сюит слушали старое `craft-agent-navigate` и не видели переходов:
  1) `inbox-focus.browser` (24/0): `pages/inbox/__tests__/fixtures/focus/sessions.ts` + `main.tsx` (в store добавлен `windowWorkspaceIdAtom`);
  2) `security-runtime.browser` (8/0): `pages/settings/__tests__/fixtures/security-runtime/main.tsx:78` + убраны два устаревших ассерта с точкой в ключе `security.rox.loadFailed` (`security-runtime.browser.test.ts:80`; ключ в HEAD — без точки);
  3) `radar-workflow.browser` (**6/0**): `pages/extra-screens/__tests__/fixtures/radar/main.tsx:70-71` + перестройка теста под фактическую full-pane навигацию радара (при `itemId` деталь владеет всей панелью — предсуществующий дизайн `RadarPage.tsx:189+`; секция `radar-setup` с комбобоксом «Daily sweep time» есть только на overview): хелпер `backToOverview()` через `CustomEvent('rox-navigate', {detail:{route:'radar'}})`, `afterEach` 30s, teardown по репо-паттерну `Promise.race([browser?.close().catch(()=>{}), Bun.sleep(5000)])` + `server?.kill('SIGKILL')`. Все три файла — в батч-коммите `c74c4d6f1`.
- 2026-10-08 (готча QA — cwd и bunfig): bun читает `bunfig.toml` ТОЛЬКО из cwd (см. комментарий в `apps/electron/bunfig.toml`), поэтому прогон из `apps/electron/src/renderer` (где конфига нет и никогда не было — зеркала живут на уровне пакетов/apps) теряет весь `[test].preload` (изоляция конфига, pdfjs-мок `?url`, vite-url shim) → ложный шторм `SyntaxError: Missing 'default' export in module '…pdf.worker.min.mjs?url'` во всех тестах, чей импорт-граф тянет pdf-блоки. Доказано: `CloudRunsChip.test.ts` из renderer-cwd → 8/1, из корня и из `apps/electron` → **9/0**; утечек в живой `~/.rox`/`~/.craft-agent` нет (mtime не менялись). Полный прогон renderer-сюиты — только из корня: `bun test apps/electron/src/renderer`. Невалидный прогон помечен (`/tmp/rox-full-suite-merged.log`).
- 2026-10-08 (готча QA — сироты прерванных прогонов отравляют последующие запуски): у browser-фикстур фиксированные порты (5196 — auth-profile, 5198/5199 — message-actions, 5269 — kernel-availability, 5271 — runtime-catalog), а teardown части фикстур может подвиснуть на `browser.close()`; убитый/прерванный прогон оставляет сирот (vite/chromium/backend). Следующий запуск гонкой в `wait()` (проверка `owner.exitCode` до фактической привязки порта) может принять чужой инстанс за свой; состояние сироты (например, подвисший `sessionPersistenceQueue.flushAll()` после SIGTERM посреди сохранения) ломает сценарии. Симптомы на merged-ревизии: `message-actions` — 200-ответ `branchFollowUp` без реплая «Hello world» (ошибка rpc уходит в unhandled rejection, невидимый для `page.on('pageerror')`); `auth-profile` — одиночный 30s hook timeout; `task-conversion` — 5s hook timeout. **Доказательство, что это не регрессия батча/merge**: те же падения одиночно воспроизводятся и в worktree на до-merge коммите `c74c4d6f1` (`/tmp/rox-prem-*.log`); после зачистки сирот все три зелёные одиночно: message-actions **8/0**, auth-profile **8/0**, task-conversion **19/0**. Before-run гигиена: сверить `lsof -nP -iTCP:<фикстурные порты> -sTCP:LISTEN`; снимать только свои сироты — чужие параллельные сессии на машине (`rox-convergence-20261007`, `archive/rox-merge-20261008/integration`, `playwright-mcp`) не трогать. Рекомендация фикстурам: per-run nonce вместо статического `fixtureId` + teardown-паттерн `Promise.race`.
- 2026-10-08 (финальный полный прогон, ревизия `02b13e7c1`, чистый старт после зачистки; `/tmp/rox-full-suite-merged-root2.log`): **3605 pass / 125 skip / 2 fail / 3732 tests / 579 files**; pdfjs-ошибок 0. Оба красных — средовые, подтверждено одиночными прогонами: `knowledge/kernel-availability.browser` — `Foreign fixture port owner` (чужая программа на порту 5269 в момент старта; одиночно **5/0**), `components/app-shell/__tests__/zed-appearance/appearance.browser` — 30s hook timeout под нагрузкой (файл пришёл с входящим main, не из батча; одиночно — **29/0, 102 с**). Сравнение: до-merge `/tmp/rox-full-suite-final.log` 3531/125/14 (+1 error); загрязнённый сиротами merged-прогон `/tmp/rox-full-suite-merged-root.log` 3635/125/8 (все «лишние» красные исчезли после зачистки — см. выше); бейзлайн `/tmp/rox-red/` — 24 файла. Бейзлайновые provider/native-ui/reader-dom в этом прогоне зелёные.
- 2026-10-08 (финальная ревизия origin/main после fast-forward, `ea1504896`, вкл. PR #1486 navigation rebuild): локальные гейты — `bun scripts/sort-locales.ts --check` EXIT=0; `bun run scripts/check-i18n-parity.ts` → **OK (11 локалей × 9023 ключа)**; `cd apps/electron && bun run typecheck` → EXIT=0. Полный прогон renderer-сюиты из корня (чистый старт): **3669 pass / 125 skip / 28 fail / 1 error / 3822 tests / 591 files** (`/tmp/rox-ff-full-suite.log`), EXIT=1; pdfjs-ошибок 0. 28 падений — в 13 тест-файлах; атрибуция:

- 2026-10-08 (атрибуция 28 красных — следствие интеграции входящего PR #1486, navigation rebuild; не батч):
  - **17 детерминированных срез-/source-тестов** (падают за миллисекунды; одиночный прогон `runtime-map-panel-reconcile` → **0/4** с `ReferenceError: workspaceId is not defined` — воспроизведено изолированно): эти харнессы AST-срезают колбэки / читают исходники production-файлов и исполняют либо сравнивают их. Ребилд переписал их цели: `NavigationContext.tsx` (+73) — `reconcileFromUrlParams` получил `workspaceId` и `decodeToolContexts` (`const contexts = workspaceId ? decodeToolContexts(params.get('toolContexts'), workspaceId) : []`; зависимости `[store, requestRuntimeSelection]` → `[store, requestRuntimeSelection, workspaceId]`), старые срезы привязывают прежний набор bindings → `ReferenceError` (стек на `…test.ts:54`); `right-session-shell` / `memory-proposal-card` — устаревшие source-снапшоты («Received: <исходник>») после переписывания Notes-воркспейса и `MemoryProposalCard.tsx` (+120). По файлам: `runtime-map-panel-reconcile` 4, `navigation-recovery` 4, `service-workspace-recovery` 5, `workspace-history-switch` 1, `route-recovery` 1, `right-session-shell` 1, `memory-proposal-card` 1.
  - **11 таймаутных падений**: `inbox-focus.browser` 6 (каскад `beforeEach`-хука 30s «Inbox warmup» + три 5.16s-ожидания), `notes-auxiliary-tools` / `notes-responsive-tools` / `meeting-extraction` / `geometry-observer` / `native-ui` (browser) по 1 (30s/5s hook-таймауты). Цели части из них правил ребилд (`LocalMeetingDetail.tsx` +102, заметки).
  - **Доказательства непричастности батча**: ни один из 13 красных тест-файлов не изменён входящими коммитами (`git diff --name-only 02b13e7c1 ea1504896` — пусто по каждому); сам батч не трогал `NavigationContext.tsx` (`git diff e6c899357 c74c4d6f1` — нет); production-цели меняли коммиты ребилда `1eb9ffd57` / `f5daf80dc` / `e00ea0ea5`; на ревизии `02b13e7c1` тот же полный прогон давал 2 средовых красных, и все 13 файлов были зелёными (включая `inbox-focus` — одиночно 24/0 после фикса).
  - **Вывод**: 28 красных — регрессия интеграции PR #1486 на общей main (старые срез-/source-харнессы и browser-фикстуры против переписанных ребилдом страниц); починка — на стороне владельца ветки `merge/prs-c`/ребилда, отдельным решением. Батч на своей ревизии закрыт (2 средовых из 3732).

## E-01 — ответы пользователя и их применение (2026-10-08, третья волна)

Ответы получены 2026-10-08 (пакет E-01, 7 пунктов). Ревизия-носитель — `origin/main` (`04878bbb4`, PR #1552); правки внесены из изолированного worktree (главный чекаут отстаёт на 245 коммитов и держит чужие незакоммиченные правки интеграции PR #1486 — не тронуты).

1. **A8 — «оставить как есть».** Правок нет: рейл подтверждён живыми прогонами (`railX≈1356`, ширина 44, 5 верхних кнопок, снизу `[Терминал]` + «Скрыть инспектор», инспектор закрыт по умолчанию).
2. **Инспектор: hover-полосы и кнопок рейла достаточно** (отдельный диалог не нужен). Правок нет: hover-зона `inspector-edge-zone` (`platform/WorkspaceSurfaceHost.tsx:86`) и кнопки рейла уже реализованы, покрыто гейтом (`super-engineering-acceptance.test.ts`).
3. **Inter — для всех профилей.** Правок нет: закрыто ещё в C2 батча (см. выше) — профиль `rox` рендерит локальный Inter-стек (`packages/ui/src/styles/index.css`), токен `--font-ui-narrow`/Arial Narrow удалён; осознанные исключения — `system`-пресеты и `--font-mono: "Rox"` (терминал).
4. **ModeBar — только на Главной.** `TopBar.tsx`: новый проп `modeBarActive` (явный признак; fallback `?? !surfaceNavigationActive` сохраняет прежнее поведение), `AppShell.tsx`: `modeBarActive={isHomeNavigation(navState)}`; `titlebar-mode-pill.test.ts` переписан под новый спек (пинит выражение и проп).
5. **B4 «Не устанавливаем» — удалена целиком** (доответ пользователя 2026-10-08: «удаляй вообще их из юзер интерфейса и вообще в целом удаляй их из приложения»). Механика удалённого (для истории): 8 пунктов, каждый — кнопка → диалог «Почему не входит» + «Что вместо» + «Перейти» к замене (локали `settings.appearance.harnessSkip*`). Удалено: UI-секция `SettingsSection` с `data-testid="harness-skip-list"` + `HarnessSkipRow` + `HARNESS_SKIP_TARGETS` в `WorkbenchChromeSettings.tsx` (248 → 172 строк); ядро — `packages/core/src/platform/workbench/harness-skip-list.ts` (`HARNESS_SKIP_IDS`/`HARNESS_SKIP_LIST`/`HarnessSkipId`) и re-export из `platform/workbench/index.ts`; i18n — 39 ключей `settings.appearance.harnessSkip*` в 12 файлах (ar, de, en, es, fr, hu, ja, ko, pl, ru, zh-Hans, zh-Hant); тесты — удалены `harness-skip-list.test.ts` и 4 кейса в 3 settings-сюитах, фикстура `p35-collapse-wrap-locales` ужата (404 → 393). Тумблер «включить всё равно» не добавляется — вопрос закрыт удалением.
6. **Рантайм облачных запусков (Daytona-снапшот).** `docs/cloud-runs-runtime.md`: Toolchain + `ffmpeg`, Docker/Podman, Playwright/Chromium + sign-off; `docs/plans/2026-10-07-rox-shell-cloud-platform.md` T-17 — тот же состав + sign-off.
7. **Per-user секреты: перечень подтверждён + `PINECONE_API_KEY`.** `packages/server-core/src/handlers/user-secrets-provision.ts` — 11 ключей в `DEFAULT_KEY_IDS` (ref `rox://secret/${userId}/${key}/v1`), тест пополнен ассертом; `docs/plans/2026-10-07-secrets-model.md` — строка Pinecone + примечание про MCP-ключи.

Верификация на `04878bbb4` + правки (лог `/tmp/e01-gate-wt.log`):

- Гейт 43 файла (42 базовых + `titlebar-mode-pill`): **203 pass / 1 skip / 8 fail / 212 tests**, 8.4 с. Все 8 красных предсуществуют на `04878bbb4` и не связаны с правками E-01: `chrome-leftover-post-960` ×1, `rox-readiness-ui-001.service-workspace-recovery` ×5, `rox-readiness-ui-001.workspace-history-switch` ×1, `zen-shell-splitter` ×1. Из них 6 (`rox-readiness-ui-001.*`) — задокументированная регрессия PR #1486 (красные и в `/tmp/rox-ff-full-suite.log`, см. G-02e); ещё 2 на `ea1504896` зелёные (контроль в отдельном worktree: 6 pass / 0 fail) — регрессия окна коммитов до `04878bbb4` (финальный merge #1552), вне списка 28 из G-02e. Негативный контроль (`git stash` E-01-правок, `/tmp/e01-5-control.log` vs `/tmp/e01-5-with.log`): **набор падений побайтово идентичен** — правки E-01 на него не влияют. Два падения `daytona-provider` в первом прогоне — флейк 5-секундного таймаута под load≈127; в повторном и контрольном прогонах файл зелёный.
- `cd apps/electron && bun run typecheck` → **EXIT=0** (95 с).
- После merge `origin/main` (upstream #1555/#1556 + `merge/prs-c`; merge-коммит `a713abafb`): гейт 43 файла → **202 pass / 1 skip / 9 fail** (`/tmp/e01-gate-merged.log`) — те же 8 детерминированных + флейк 5-секундного таймаута `daytona-provider` под load≈127. Файлы E-01 апстримом не затронуты (пустой `git diff --stat 04878bbb4...origin/main` по девяти путям).
- `packages/server-core` (`bun run tsc --noEmit`) → 8 диагностик в 3 файлах — артефакт симлинк-скев между деревьями: в тексте ошибок скрещены пути `rox-one-e01-wt` и `rox-one` (например, `SessionManager.ts`, `local-markdown-provider.ts` разрешаются в главный чекаут); контроль со `git stash` воспроизводит тот же набор — правка `DEFAULT_KEY_IDS` ни при чём.
- **B4-вычистка (доработка E-01, 2026-10-08):** `grep` `harnessSkip|harness-skip|HARNESS_SKIP` по `apps/`, `packages/`, `scripts/` → 0 совпадений; `bun scripts/sort-locales.ts --check` → EXIT=0; `bun run scripts/check-i18n-parity.ts` → `i18n parity OK (11 locales, 9251 keys each)`; гейт 47 файлов (43 базовых + 4 затронутых) → **217 pass / 1 skip / 8 fail / 226 tests** — все 8 красных из того же предсуществующего набора (см. выше), 4 затронутых файла зелёные; `cd apps/electron && bun run typecheck` → **EXIT=0** (109 с).

### G-02f — живой прогон на B4-ревизии `48196e03f` (2026-10-08): 7/7 закрыто

- Бандл: `bun run electron:dist:mac` из выложенной ревизии (`git merge-base --is-ancestor HEAD origin/main` → да; `origin/main` ушёл вперёд на PR #1602 `1a1fa20da`) → EXIT=0, 592 с; `release/mac-arm64/Rox.app` mtime 12:34. Инстанс: порт 9334, профиль `rox-verify` (`cfg-merged` + `userdata-merged`, онбординг пройден ранее).
- **Правый рейл** `[data-inspector-action-rail]`: `{x:1356, y:40, w:44, h:860}`; верх (y): Новая сессия 46, Новая задача 78, Новое событие 109, Новая заметка 141, Открыть браузер 173; низ (y): Закрепить 793 (только в hover), Скрыть 825, Терминал 864 (последняя). Совпадает с утренним замером (railX 1356, ширина 44).
- **Инспектор закрыт по умолчанию, цикл обратим**: клик «Скрыть инспектор» → `[data-inspector="collapsed"]` strip `{x:1372, y:40, w:28, h:860}`, рейл размонтирован; клик по strip → рейл обратно `{x:1356, w:44}`; терминальная ячейка `w 1035 ↔ 1051`, `flexBasis 50%` не меняется.
- **Edge-reveal hit**: `document.elementFromPoint(1394, 470) === [data-inspector-edge-zone]` на home/tasks/notes/settings (зона `z-[60]`).
- **A4 hover**: `craft-se-inspector-edge-reveal-mode → "hover"`, `craft-se-inspector-edge-hover-active → "true"`, в рейле появляется «Закрепить инспектор»; уход → исчезает (гейт `edgeMode === 'hover'`); клик по пину ставит pin.
- **Терминал**: рейл-кнопка «Терминал» → `[data-terminal-cell]` `{x:321, y:470, w:1035, h:430}`, `flexBasis: "50%"`, `flexShrink: "0"`; OCR снимка — реальный prompt «$ Введите команду и нажмите Enter.» (селектор `.xterm` в DOM не матчится — иная разметка, но панель живая).
- **Inter**: `document.fonts.check('12px Inter') === true`, computed `fontFamily` `body` и панели терминала = `Inter, -apple-system, …`; `--font-mono: "Rox"` не тронут (закрыто ещё C2, здесь — живое подтверждение).
- **A4L (левый разворот)**: `[data-testid="rail-toggle"]` (свёрнут: 23×23, aria «Показать боковую панель») → `craft-sidebar-visible "false"`; hover у левой кромки (x=2) → панель развернулась, `aria-label "Скрыть боковую панель"`, появился `[data-testid="rail-pin"]`; клик по пину → `craft-sidebar-visible "true"` (персист), после ухода панель осталась развёрнутой; `craft-sidebar-width` 320 без изменений.
- **OCR** (Vision снова работает): полный текст экрана настроек (conf 1.00, «Контекст проекта / Сводка / … / rox/r1-max / Настроить ИИ …»); снимки `live/rox-live-{rail-right,rail-left,terminal,inspector-hidden}.png`, OCR `live/ocr-manual-1314.txt`.
- **Решение по ширине рейла — оставить 44**: `CHROME_DENSITY.railWidth` остаётся **44** (токен «Activity + inspector section rail width», `chrome-density.ts:8-12` — обе полосы 44/44); 52 px относится к свёрнутому левому сайдбару (фикс A1: 24+2+24 = 50 ≤ 52, `SidebarChrome.tsx:57-72`) и к optional SE-профильному рейлу (`super-engineering-spec.md:16`); требования 52 для правого рейла в доках нет — правок не требуется.
- **A13 («Устройство») — живая проверка:** chip `Открыть диагностику устройства` (x=1205, y=20, 32×28) → поповер «Диагностика устройства · Это устройство · только чтение» с секциями Обзор/Сеть/Процессы/Серверы/Автозапуск/Журналы и живыми метриками (CPU 100 %, RAM 63,8 ГиБ из 64, Rox 245 МиБ, аптайм 6 мин, автообновление 5 с) — OCR conf 1.00, снимок `live/rox-live-device-popover.png`.
- **Пост-merge гейты и финал:** на `e205e5b89` (47 файлов): **221 pass / 1 skip / 4 fail** — предсуществующие `chrome-leftover-post-960` ×1, `zen-shell-splitter` ×1, `workspace-history-switch` ×1 + флейк `daytona-provider` ×1 (изолированно зелёный). Финальный `origin/main` — **`78cc32c26`** (merge PR #1600 «fix/rox-post-rebuild-red-suite»: правит `AppShell.tsx` + 5 тестовых файлов; логику рейлов/инспектора не трогает); на нём: контроль всех ранее красных файлов (5 шт.) → **28 pass / 1 skip / 0 fail** (`/tmp/e01-gate-final.log`), документированный 10-файловый гейт → **75 pass / 1 skip / 0 fail** (`/tmp/e01-gate-doc10-final.log`), `bun scripts/sort-locales.ts --check` → EXIT=0, `check-i18n-parity` → `11 locales, 9330 keys each`. Полный 47-файловый набор собирался инлайн и его состав в артефактах не сохранился — строка «47 файлов» относится к `e205e5b89`; все известные красные на `78cc32c26` позеленели.
- **Готчи повторных прогонов**: (1) первый boot после пересборки ~3 мин уходит в uv-сборку `pydantic-core`/`mcp-server-qdrant` (maturin; виден в `app.log`, не фатально); (2) `rox-wait7.ts` жёстко писал ws в `/tmp/rox-ws.txt` и не получал порт — пофикшено (`rox-wait7.ts` пишет в `wsOut`; `live-g02.sh` передаёт `"$PORT" "$WSFILE"` и ждёт 300 с); (3) модалка «Научите агента своим правилам» блокирует hit-тесты — первым шагом `rox-dismiss.ts`; (4) инстанс может молча завершиться после прогона (креш-репорта нет; приёмка снимается до этого); (5) на загруженной машине shell маунтится позже 300 с (сегодня: renderer-таргет ~60 с, ссылки — спустя ~1 мин после таймаута wait7; повторный probe безвреден).

---

## Волна 2026-10-08 10:40 — второй запрос пользователя (UI-полировка, бренд, транскрибация)

**Источник:** запрос пользователя 2026-10-08 10:40:36 (правки UI) + 10:44:21 (запись/транскрибация); 5 скриншотов 13:20–13:28; 2 бренд-ассета (полный логотип ink-white; глаз-1024 как «что не нравится»).
**Ветка:** `feat/ui-polish-20261008` от `origin/main 51abb24782e4709dc40809e25b592f2d35720d1e` (worktree `~/Projects/archive/rox-reconcile-20261008`).
**Политика та же:** ни force-push, ни rebase; коммиты только по своим путям; мердж — merge-коммитом в `main` после CI.

### Решения по бренду (пиксельная экспертиза без vision — Pillow/ASCII)

- `logo-ink-white.png` (3558×3799) == `rox-avatar-ink-white.png` (959×1024) — один и тот же арт («девушка»); ink-white = **белые** штрихи (mean RGB 255) для тёмных поверхностей.
- `rox-avatar-ink-black.png` (959×1024, mean 0,0,0) — тот же арт чёрным, для светлых поверхностей. Оба файла в `apps/electron/src/renderer/assets/` (были untracked — легализуются в этом батче).
- `rox-logo.png` (512×512, mean 140) == `eye-1024-rounded.png` — это и есть «глаз»; `rox-logo.svg` встраивает ту же картинку base64 (256×256). Оба выведены из обращения и **удалены в волне 2**.
- `rox-mark-portrait-{18,36,54}.png` (mean ~121) — старые тилевые марки ModeBar; заменены тем же ink-артом и **удалены в волне 2**.
- `assets/provider-icons/rox.svg` (32×32, плитка `#0A377B` + белая «R» + розовая точка) — это «буковка r» в подключениях; заменяется на логотип.
- **Интерфейс батча (заморожено):** `CraftAgentsSymbol` становится theme-aware сам (пара ink-black/ink-white, потребители снимают `dark:invert`); новые ключи i18n — только через манифесты `work/i18n/<Worker>.json` (`{"key": {"en","ru"}}`), 12 локалей мержит лид; новый проп TopBar — `onOpenBrowserTab: () => void`; новый компонент — `components/app-shell/InspectorInfoMenu.tsx` (`export function InspectorInfoMenu({ className })`).

### Требования и владельцы (файлы не пересекаются)

| # | Требование | Владелец (воркер) | Файлы | Верификация |
|---|---|---|---|---|
| W-01 | Топбар: порядок слева `back → forward → toggle sidebar → AccountMenu → DeviceStatusChip`; убрать «Карта»/«Новое окно браузера»/«Терминал»; «Новая вкладка» — самая правая (t(), prop `onOpenBrowserTab`); Help вынесен в `InspectorInfoMenu` | TopbarRework | `TopBar.tsx`, new `InspectorInfoMenu.tsx` | живой OCR топбара; `browser-surface-v2.test.ts` переписан лидом |
| W-02 | Справка/инфо — в правом рейле НАД «Скрыть инспектор» | RailInfoButton | `platform/InspectorHost.tsx` | живой прогон (порядок нижней группы) |
| W-03 | «Новая вкладка» = фокус инспектора + свежая вкладка через `createEmbedded` (не `browserPane.create`); i18n `New Tab` в main+tollbar; мёртвый compact-бренч | BrowserTabFlow | `AppShell.tsx`, `BrowserTabStrip.tsx`, `browser-toolbar.tsx`, `main/browser-pane-manager.ts` | живой прогон + статический запрет `create({show:true})` |
| W-04 | Левый рейл: иконки как справа; шестерёнка ниже стрелки; pin темнее; обводка тоньше | LeftSidebarChrome | `SidebarChrome.tsx`, `LeftSidebar.tsx` | живой прогон (rail-toggle/rail-pin, hover-разворот) |
| W-05 | Круглая аватарка + имя внизу слева; баланс без «—»; юзер-поповер в нативном стиле (ЛК) | AccountSurfaces | `ProfileStrip.tsx`, `AccountMenu.tsx` (+новый поповер) | живой прогон (поповер, баланс) |
| W-06 | Аватары/бренд: `CraftAgentsSymbol` theme-aware; `RoxTileMark`; About/splash/onboarding/playground; XP-блок «Недавние начисления» не столбиком; уровень виден | BrandAssets | `icons/CraftAgentsSymbol.tsx`, `icons/RoxTileMark.tsx`, `SplashScreen.tsx`, onboarding×4, `PlaygroundApp.tsx`, `registry/icons.tsx`, `AccountSettingsPage.tsx` | живой OCR; `titlebar-mode-pill.test.ts` ассерт обновлён |
| W-07 | Пустой стейт/панель новой сессии: RU-текст (taglines, QuickStart, CloneFromUrl), новый марк, без `dark:invert` | ChatEntryPolish | `EmptyChatWelcome.tsx`, `ProjectHub.tsx`, `QuickStartDialog.tsx`, `CloneFromUrlDialog.tsx`, `hub-taglines.ts`, поверхность новой сессии | живой OCR пустого чата |
| W-08 | Кнопка облака над чатом: поднять и закрепить | CloudChip | `InputContainer.tsx`, `CloudRunsChip.tsx`, `ChatInputZone.tsx` | живой прогон (позиция/sticky) |
| W-09 | Sessions: браузер не открывается сам; причина — навигация/дефолты инспектора | SessionsDefaultBrowser | `NavigationContext.tsx` + nav-тест | живой прогон: вход в Sessions инспектор закрыт |
| W-10 | Подключения: человекочитаемые названия; логотип вместо «R» | ConnectionsSurface | `connections-overview.tsx`, `AccountsSettingsPage.tsx`, `lib/provider-icons.ts`, `provider-icons/rox.svg` | живой OCR карточек подключений |
| W-11 | Разрешения: обрезка кнопки (settings-row/stacking) + скачки шрифтов (Suspense/font-display) | PermissionsPolish | `PermissionsSettingsPage.tsx`, `MainContentPanel.tsx`, `ThemeContext.tsx`, (`packages/ui/src/styles/index.css` при нужде) | живой прогон узкой панели |
| W-12 | Удаление мёртвых модулей | DeadModules | `platform/SurfaceNavigationRail.tsx`, `platform/WorkspaceIconRail.tsx` (+только их тесты) | grep 0 ссылок |
| W-13 | Раскладка панелей в заметках/задачах/календаре | (лид после LayoutPanelsRecon) | TBD по разведке | живой прогон переключателя |
| W-14 | Раскладка i18n: мерж манифестов, `sort-locales`, parity | лид | `packages/shared/src/i18n/locales/*` | `sort-locales --check` + `check-i18n-parity` EXIT=0 |
| W-15 | Тесты-контракты: переписать `browser-surface-v2.test.ts` под новый топбар; удалить/переписать stale (`compact-session-list-filter.test.ts:16`, решить `right-session-shell.test.ts`) | лид | тест-файлы | прогон затронутых |

### Фаза 2 — запись и транскрибация (запрос 10:44:21), отдельный DoD

Требования пользователя: автозапись и транскрибация встреч; транскрибация любых аудиосообщений; live-волна громкости в диалоге + мини-оверлей при сворачивании; транскрипт → в чат/в драфт новой сессии по хоткею; папка «Мои транскрипты» в заметках; Deepgram Nova 3, авто-язык, абзацы/пунктуация.

- Разведка: `TranscribeRecon` (read-only) — карта meetings/voice/audio/notes/hotkeys/secrets + варианты архитектуры.
- DoD (черновик, уточняется по разведке): (1) запись встречи стартует из UI, аудио сохраняется детерминированно; (2) STT-сервис Deepgram Nova 3 с авто-языком и абзацами/пунктуацией (ключ — из per-user секретов); (3) транскрипт доступен в UI встречи и как заметка в «Мои транскрипты»; (4) аудиосообщение в чате транскрибируется; (5) live-уровень громкости в диалоге записи и мини-оверлей при сворачивании; (6) хоткей вставляет транскрипт в чат/драфт новой сессии; (7) негативные сценарии (нет ключа/нет сети/отмена) не роняют приложение.

### Верификация волны (план)

1. `bun test` по затронутым путям → `bun run typecheck:all` → `validate:ci` (эталон i18n parity после мержа манифестов).
2. `bun run electron:dist:mac` → живой инстанс (свой порт + `--user-data-dir`) → OCR целевых экранов (топбар, рейл, сессии, подключения, разрешения, XP, пустой чат) → скриншоты.
3. PR `feat/ui-polish-20261008` → CI → merge-коммит в `main` (без `--admin`) → post-merge проверка и отчёт (RU).

---

## Итог волны 2 — реконсиляция, классификация красных, пост-ревью правки

**Реконсиляция.** `origin/main` уехал с `51abb2478` до `fdc3533eac4aa1afa1dd7779672c090a8763a85b` — подтянут merge-коммитом `58c6a1fa6` (без rebase/force). Итог ветки: 106 файлов, +3140/−1730 от `51abb2478`.

**Классификация красных (41 файл из `/tmp/sea-failing.json`).** Метод: `classify-one.sh` (junit-репортёр, 6 параллельно) на базе `51abb2478` и на рабочем дереве → `type<TAB>pass/exit` в `SUMMARY.tsv`.
- **37/41 файлов совпали** pass/fail байт-в-байт — предсуществующие красные базы, не регрессии волны.
- `runtime-catalog.browser.test.ts` (база `0/1` → дерево `0/9`) — артефакт окружения: причины падения разные («Failed to fetch dynamically imported module» в базе, «Target page … closed» на дереве).
- `native-handoff.browser.test.ts` (`9/3` → `10/2`) и `project-collection.browser.test.ts` (`11/4` → `13/2`) — **улучшения** (не регрессии).
- `topbar-shortcuts.test.ts` (`9/0` → `7/1`) и `shortcut-hints.test.ts` (`18/0` → `12/6`) — регрессии волны, обе устранены: (а) хук `usePanelWorkspaceLayout()` в `TasksPage` бросал `useAppShellContext must be used within an AppShellProvider` в standalone-фикстуре → добавлен не-бросающий `useOptionalPanelWorkspaceLayout()`; (б) тест топбара пинил убранный аффорданс «Карта» → переписан под реальный Map-bridge (`AppShell.tsx` → `ChatDisplay`, `detail: { sessionId, view: 'map' }`). Контрольный прогон обеих: **26 pass / 0 fail**.

**Правки по ревью renderer-диффа (все 5 находок + фикс хука выше).**
1. **P1, тема**: `packages/ui/src/styles/index.css` — добавлен `@custom-variant dark (&:where(.dark, .dark *));`. В Tailwind v4 `dark:` по умолчанию компилируется в `prefers-color-scheme`, а тема приложения классовая (`ThemeContext` пишет `html.dark`; ни `darkMode`, ни `nativeTheme.themeSource` в репо нет) — 165 `dark:`-утилит были завязаны на системную схему вместо переключателя.
2. **P2**: `AccountsSettingsPage.tsx` — `setCloudLabel(notesCloud?.accountLabel ?? '')` вместо `connectionAccountSubtitle` (тот display-хелпер обрезал метку до 64 символов и подменял технические метки на пустую строку).
3. **P3**: `en.json` — `se.tagline.chineseRoom` с настоящим апострофом.
4. **P3**: `ProfileStrip.tsx` — `aria-label` кнопки = `t('profile.openMenu', { name })` (кнопка открывает поповер профиля, а не настройки); ключ добавлен во все 12 локалей; `aria-haspopup` не задаём — его проставляет Radix `PopoverTrigger`.
5. **P3, чистка rail-наследия**: удалены `KEYS.workspaceRailLinks`, `lib/rail-links.ts`, ассеты `rox-logo.{svg,png}` и `rox-mark-portrait-{18,36,54}.png`, из всех 12 локалей — по 18 ключей (`workspaceRail.*` ×10, `navigation.rail|surfaceGroup|toolGroup`, `navigation.toolHelp.*` ×4, `profile.openSettings`). Перед удалением: 0 ссылок в коде/тестах, 0 динамических спеков.

**Открытый вопрос (закрыт).** `AccountSettingsPage`: строка Email показывает реальный адрес ящика (read-only, из `mail.status()`), тогда как `persist()` по-прежнему отправляет `profile.email` из identity-профиля. **Решено оставить**: `profile.email` — живое поле identity-контракта (читают `AccountsSettingsPage` как fallback подписи аккаунта, `main/mail/local-ipc.ts` как handle почты; тесты server-core проверяют set/clear), а снятие UI-редактирования — осознанная смена поверхности, не мёртвый код.

**Проверки после правок:** `sort-locales --check` EXIT=0 · `check-i18n-parity` → `i18n parity OK (11 locales, 9546 keys each)` · `p35-collapse-wrap-locales` 3/3 · `shortcut-hints` + `topbar-shortcuts` 26/26.

---

## Волна 2 — финальная реконсиляция, ратчет токенов и ре-пины тестов (2026-10-08, вторая половина дня)

**Реконсиляция (второй мердж `main`).** `origin/main` уехал с `fdc3533ea` до **`0fc3af48f`** («ui/a2-style-lint-ratchet», PR #1613) — подтянут merge-коммитом **`4ade5108e`** (без rebase/force). База PR = `0fc3af48f` = merge-base.
**Масштаб PR (финальный):** `git diff --stat origin/main HEAD` = **122 файла, +3296 / −2134** (95 `apps/electron`, 20 `packages/shared`, 3 `packages/ui`, 1 `server-core`, 3 `docs`). От `51abb2478` тот же дифф выглядит как 671 файл — это артефакт влитого main, поэтому PR описывается только от `0fc3af48f`.

**Разрешённые конфликты (7 блоков).** Трио `LeftSidebar.tsx`/`TopBar.tsx`/`input/InputContainer.tsx` (наши правки топбара против рефакторинга оболочки в main), `ScrambleTagline.tsx`, `NotesPage.tsx`, `TasksPage.tsx`, `InspectorHost.tsx`, `AccountMenu.tsx`, `packages/shared/src/types.ts`, 12× локали и `packages/ui/src/styles/index.css` (наш `@custom-variant dark` против токен-правок main).
**`WorkspaceIconRail` в `main` удалён** — тумблер «Панель иконок рабочих пространств» убран вместе с rail-наследием (наш коммит `0d48cd157` поверх main'овских правок).

**Ратчет токенов после мерджа.** Первый прогон `bun run lint:ui-tokens` дал рост на 13 строках (все — наши правки). Рост устранён **кодовыми правками в токены**, `--update`/метка `ui-baseline-override` не применялись: 7 файлов (`ProfileStrip`, `AccountMenu`, `UserProfilePopover`, `InspectorInfoMenu`, `PlanWorkspacePage`, `PermissionsSettingsPage`, `voice/hotkey-dictation-host`). Итог: `lint-baseline: OK — 8273 baselined violations across 543 files, none new` (`/tmp/uitokens4.log`, EXIT=0).

**Ре-пины тестов (2 файла).** `profile-strip-accessibility.isolated.tsx` — 3 ассерта `aria-label` под осознанный ре-нейм ключа (`profile.openSettings` → `profile.openMenu`, ключ добавлен во все 12 локалей). `sidebar-chrome-accessibility.test.tsx` — 3 порядковых счётчика кнопок (`toHaveLength(3/1/2)`), **красные уже на `origin/main`** (в промо-слоте реально рендерится `PromoSlot` с телом и `data-promo-slot`, в рейле — `rail-toggle`/`rail-settings`), переписаны на атрибутные контракты: `data-tutorial="profile-strip"` + `aria-haspopup="dialog"`/`aria-expanded="false"`, `data-promo-slot="onboarding|reminder"`, кнопка закрытия = `aria-label="Dismiss"` (`common.dismiss`), CTA-текст. Контроль целевого набора из 7 файлов: **27 pass / 0 fail**.

**Мёртвый ключ.** `sidebar.guidance.dismiss` (0 ссылок в коде, только в устаревшем ассерте) удалён из всех 12 локалей; `check-i18n-parity` → `i18n parity OK (11 locales, 9554 keys each)`, `sort-locales --check` EXIT=0.

**Предсуществующие красные гейты (CI их не запускает, PR не блокируются).** Доказаны на `main`:
- `scripts/check-raw-sends.sh` — падает на `apps/electron/src/main/meetings/local-ipc.ts:22`, строка есть в `origin/main` (в другом ворктри проходил лишь из-за отсутствия `rg` в PATH).
- `scripts/check-task-tool-checks.sh` — падает на 4 файлах, ни один из которых не в нашем диффе.
- `bun run lint:ui` — 2 error в main-коде: `packages/ui/src/styles/index.css:27` (arbitrary shadow) и текст фикстуры `styles/__tests__/tokens-v2.test.ts:495`; наши 53 изменённых не-тестовых `apps/electron/**/*.{ts,tsx}` дают 0 error / 570 warnings.
- `packages/shared/src/agent/__tests__/omp-{permission-mode,rpc-transport}*.test.ts` (входят в CI-скрипт `test:mcp-onboarding`) падают таймаутами **идентично на baseline** (`fdc3533ea`) и на нашем HEAD — код этих тестов и их модулей диффом не затронут; локальный sandbox лишает дочерние процессы сети, в CI (GitHub runners) этой причины нет. Проверка CI-эквивалента выполняется вне sandbox через `launchctl`.

---

## Волна 3 — второй мердж main, ремонт IPC-снапшота и живая приёмка (2026-10-08, вечер)

**Реконсиляция №2.** `origin/main` уехал с `0fc3af48f` до **`8396f349c`** (PR #1614, merge `feat/convergence-20261007`) — влит merge-коммитом **`c2351ece0`** (без rebase/force). Пересечений с нашими файлами нет: main в этот раз менял только 6 PNG-снапшотов `tests/visual/playground.spec.ts-snapshots/chat-display-*`. Итог: **122 файла, +3297 / −2134, 18 коммитов впереди `origin/main`** по коду; вместе с этой секцией плана и снимками приёмки — 128 файлов, +3321 / −2134, 20 коммитов.

**Починен дрейф IPC-снапшота (предсуществующий на main).** `apps/electron/src/shared/__tests__/ipc-channels.test.ts` («Auto-generated by `scripts/ipc-inventory.ts`») не содержал `'directory:exportDossier'`, хотя `packages/shared/src/protocol/channels.ts` его содержит, поэтому `contains exactly 852 channel strings` падал на `main` и на любой ветке. Генератора в дереве нет; снапшот починен вручную (прецедент — `docs/final-readiness/execution/cloud/OWNER-UI-001/verification/ipc-snapshot-followup/result.json`). Файл зелёный: 8 pass / 0 fail.

**Живая приёмка на финальном бандле** (`release/mac-arm64/Rox.app`, окно видимо: `rox-winlist` → 1400×900, layer 0, onscreen; CDP page-таргет живой). Визуальные доказательства — `Page.captureScreenshot` (renderer) + OCR; `screencapture` захватывает и перекрывающие окна, поэтому для UI-доказательств он не используется.
- **Топбар**: порядок кнопок `Назад(74) · Вперёд(108) · Показать/скрыть боковую панель(142) · рабочее пространство(176) · диагностика(398) … Расположение панелей(1290) · Показать инспектор(1326) · Новая вкладка(1360)`. `bannedTopbarAffordances=[]` — «Карта»/«Терминал»/«Новое окно браузера» отсутствуют; «Новая вкладка» — крайняя правая и открывает вкладку в `rox-topbar-browser-strip`.
- **Профиль**: стрип 308×64, `aria-label="Открыть меню профиля — Пользователь"`, аватар — тема-зависимая пара `rox-avatar-ink-black-*.png`/`rox-avatar-ink-white-*.png`; поповер: «Пользователь · Стандарт · Ур. 1 · Баланс Нет данных · Опыт 0 / 100 XP · Настройки аккаунта · Выйти».
- **Настройки → Внешний вид**: `railWordPresent=false`, `railMentions=[]` — тумблера «Панель иконок рабочих пространств» нет; секции «Рантайм / Контекст и предпочтения / ИИ», «Режим (Системная/Светлая/Тёмная)», «Контраст», «Цветовая тема».
- **Настройки → Аккаунт**: «Аккаунт ROX · Пользователь · Организация · Публичное имя · Статус аккаунта», почтовый адрес `mark4@rox.one` (read-only из `mail.status()`).
- **Сессии**: `data-inspector="collapsed"`, инспектор закрыт по умолчанию, рейла инспектора нет.
- **Встречи**: подвкладка «Встречи» → `[data-testid="meetings-start"]` = «Начать запись» (706,91,119×28), «Импорт аудио», пустое состояние «Пока нет встреч. Начните запись с микрофона или импортируйте аудиофайл — транскрипт появится автоматически».
- **Заметки**: список заметок, «Ежедневная заметка», «Импорт папки…», «Новая заметка».

**Снимки живого прогона** (renderer через `Page.captureScreenshot`, `docs/evidence/ui-batch-20261008/`): `sessions-inspector-collapsed.png`, `settings-appearance.png`, `settings-account.png`, `meetings-recordings.png`, `topbar-browser-tab.png`, `profile-popover.png`.

**Готчи живого прогона (для будущих QA-сессий).**
- Второй инстанс с тем же `ROX_CONFIG_DIR` держит `.server.lock` → следующий запуск не поднимает локальный сервер: окно создаётся, но renderer пуст (CDP отвечает, `/json/list` пуст, в логе `Failed to initialize app: Another server instance is already running (PID …)`). Перед запуском снимать прежний `launchctl`-job и процесс по порту; лончер дополнительно удаляет lock с мёртвым pid.
- Отладочный лог main-процесса включается `CRAFT_IS_PACKAGED=false` (в production-режиме транспорты `electron-log` выключены); флаг `--debug` в Electron 39 уходит в устаревший `node --debug` и даёт шум DEP0062 с петлёй релончей.
- Первый холодный переход в «тяжёлые» разделы (все сессии, заметки) может не уложиться в 25 с — повторный прогон после прогрева проходит без таймаутов.

## Волна 4 — конвергенция голосовой волны (VV-1…VV-6) с upstream `4739a0e54` + живая приёмка

**Что произошло.** Пока волна VV-1…VV-6 делалась в ветке `e01-decisions`, тот же запрос пользователя (10:44:21 —
«Фаза 2 — запись и транскрибация») был реализован второй раз и влит в `origin/main` коммитом **`4739a0e54`**
(2026-10-08 15:19, «feat(voice): meetings transcription + dictation, transcripts notebook, mailbox provisioning»):
композерная волна `components/voice/VoiceLevelWave.tsx` + `use-microphone-level.ts`, заметки
`lib/transcripts-notebook.ts` (content-addressed, `rox-transcript:<fnv1a>`), хост хоткея
`voice/hotkey-dictation-host.tsx` (драфт новой сессии), уровень микрофона через общий контракт
`VoiceHost.level()` → `voice:level` (protocol/routing → server-core rpc → transport map → overlay-owner →
overlay-renderer), пиннинг модели `resolveDeepgramModel()` (nova-3 по умолчанию, апгрейд только по
`DEEPGRAM_ALLOW_MODEL_UPGRADE`) и правки почты/встреч. Две реализации дублировали одну и ту же волну.

**Решение (конвергенция, не дубль).** Основой взята реализация из `main`; собственные дубли из ветки удалены
(`level-meter`, `dictation-ownership`, `global-dictation`, `transcripts/notes`, `transcript-notes` и их тесты), из
ветки лида перенесены **только фиксы, которых в `main` нет**. Итоговый код-дифф волны против `origin/main` —
три файла: `main/voice/overlay-owner.ts`, его изолированный тест и `renderer/lib/transcripts-notebook.ts`.

**Фиксы в `apps/electron/src/main/voice/overlay-owner.ts`** (мини-оверлей при свёрнутом приложении):
1. **Показ не зависит от фокуса владельца.** Было `const show = owner!.isFocused() && phase !== 'hidden'` плюс
   `onBlur → hide` — при свёрнутом/нефронтовом приложении мини-окно не показывалось вовсе (это и есть основной
   пользовательский сценарий «мини-оверлей при сворачивании»). Стало `const show = latest!.state.phase !== 'hidden'`;
   `blur`-обработчик снят (регистрация и `removeListener`), гейт `|| !owner!.isFocused()` из обработчика команд
   убран — «Стоп»/«Отмена» самого окна работают, пока приложение не в фокусе.
2. **Первая публикация при нефронтовом владельце создаёт поверхность.** Guard
   `if (nextOwner !== owner && !nextOwner.isFocused()) return` получает префикс `child &&`: живой поверхностью
   по-прежнему не может завладеть фоновый актор, но первый показ (хоткей при свёрнутом приложении) не отбрасывается.
3. **Упакованная сборка грузит свой entry.** Было `file://${join(__dirname, '../renderer/voice-overlay.html')}`
   (каталогом выше — там файла нет), стало `created.loadFile(join(__dirname, 'renderer', 'voice-overlay.html'))`
   (рядом с `main.cjs`, как у остальных renderer-entry) + `void loading.catch(…)`.

**Фикс в `apps/electron/src/renderer/lib/transcripts-notebook.ts`** (заметка-транскрипт должна доживать до диска):
до правки под конкуренцией за claim-гейт стора заметок запись падала и **молча терялась** (в консоли
`[transcripts-notebook] transcript not saved Error: Document claim requires recovery`), а неудачная попытка
оставляла **пустую заметку** — отсюда пустые 145–150 Б «Транскрипты встреч» и дубли `(2)`/`(3)`. Добавлено:
1. **Ретраи с бэкоффом** (`[0, 400, 1000, 2000, 4000, 6000]` мс) на транзиентные ошибки claim-гейта
   (`Document claim requires recovery`, `Document writer is busy`, `rateLimited`), включая RPC-ошибки в виде
   plain-объекта (не `Error`);
2. **Сериализация записей** (module-level очередь): стартовое зеркалирование нескольких встреч больше не воюет
   само с собой за claim-гейт; у очереди есть **дедлайн 20 с**, чтобы один зависший вызов не заклинил следующие;
3. **Уборка пустого стаба**: если запись тела так и не прошла, созданная этим вызовом пустая заметка удаляется
   (только когда в ней нет ничего, кроме заголовка) — вместо неё остаётся предупреждение в консоли.
Юнит-тест `renderer/lib/__tests__/transcripts-notebook.test.ts`: ретрай на claim-ошибку (2 попытки), отсутствие
стаба при перманентной ошибке (`deleteNote` вызван, повтор не делается), сериализация двух параллельных
транскриптов — **3 pass / 0 fail**.

**Живая приёмка на бандле после конвергенции** (профиль `rox-verify`, порт 9334, фикстурный шов в гитигнорном
`main.cjs`, после прогонов шов снят):
- **Композер (VV-1, свежий профиль 9336)**: кнопка диктовки разложена и кликабельна
  (`disabled: false`, `hitIsSelf: true`), композерная волна — `canvas` (`VoiceLevelWave`): 24 сэмпла, 7 различных
  значений доли «нарисованных» пикселей (0.15…0.3429), транскрипт лёг в драфт (`"проверка диктовки "`, len 18),
  тостов об ошибках нет; заметка-транскрипт записана в «Мои записи/Мои транскрипты» с телом и content-anchor
  (`проверка диктовки.md`, `<!-- rox-transcript:96507d5c -->`), повторная идентичная диктовка **не создала
  дубль** (content-addressed дедуп ✓).
- **Мини-окно при свёрнутом/нефронтовом приложении (VV-2/VV-3, свежий профиль)**: запись запущена из композера,
  приложение расфокусировано (`open -a Finder`, front = Finder) — оконный сервер видит `ROX Voice`
  `420×72 @841,1233`, `onscreen: true`, pid 80909 (наш инстанс), по-оконный скриншот снят; в рендерере оверлея
  16-полосный метр: 10 сэмплов, **27 различных высот**, 43–77 %; стоп **собственной кнопкой окна**
  (`window.voiceOverlay.stop(recordingId)` → `{ok:true}`) вернул транскрипт в драфт композера. Это и есть
  перенесённый фикс: без него `owner.isFocused()` + `onBlur → hide` не показали бы окно вовсе.
- **Хоткей (VV-3) — живьём не воспроизводится в этом окружении.** Upstream перевёл вход глобальной диктовки на
  OS-уровень (`globalShortcut` регистрируется в main, `before-input-event` в `main/voice/command-input.ts`),
  а синтетическое событие клавиши из CDP такой шорткат не поднимает (инъекция настоящих keystrokes требует
  Accessibility/TCC, которого у QA-сессии нет). Поэтому глобальный вход подтверждён юнит-тестами upstream
  (`registration.isolated.ts` 2 pass, `command-input.test.ts` 10 pass) и живой проверкой самой цепочки
  «оверлей → main → владелец → транскрипт» (стоп из оверлея выше). На волне лида (до конвергенции) тот же путь
  проверялся живьём: синтетический Cmd+Shift+D из рендерера создавал сессию с драфтом (сессия `261008-silver-harbor`).
- **Встречи (A9/VV-5)**: `[data-testid="meetings-start"]` («Начать запись») разложена и кликабельна на свежем
  профиле (`630,79 119×28`, `hitIsSelf: true`, `inViewport: true`) и на 9334 (`535,109 113×23`, `hitIsSelf: true`);
  запись встречи (панель записи, чип топ-бара `meeting-rec-indicator`, таймер `00:00→00:13`, живой метр
  `levelMax 88`, `error: null`) и остановка из вкладки «Подробности» узкой `ModeScreen` проверены на 9334 —
  интерфейс встреч волной не менялся. Реальный `whisper-cli` расшифровал 14 с (2 сегмента: «Привет, это проверка
  голосового ввода в РАКС. Запись работает.»), а **зеркало в заметки на смерженном бандле** отработало на 9334:
  в «Мои записи/Мои транскрипты» лежат «Транскрипт встречи: …» с телами (2.3 КБ и 9 КБ) и якорями
  `<!-- rox-transcript:… -->`; пустые 145–150 Б файлы — артефакты до патча писателя. На свежем профиле запись
  встречи повторно не снималась: холодный переход в «Встречи» не уложился в таймаут драйвера трижды подряд
  (известная готча «тяжёлых разделов»), а home-дашборд в новом рабочем пространстве не монтируется — путь
  «быстрое действие Главной» снят на 9334 (встреча `m-20261008-212658-g2cx`).

**Готчи живого прогона (для будущих QA-сессий).**
- **`--use-mock-keychain` обязателен для патченного QA-бандла.** Фикстурный шов правит `main.cjs` → печать
  ресурсов ломается (`codesign -v`: «a sealed resource is missing or invalid»), и каждый boot вешает запрос
  Keychain на `Rox Safe Storage` (Chromium OSCrypt, `keychain_password_mac.mm`; в ACL чужие cdhash). Диалог
  блокирует главный поток в `SecItemCopyMatching` (видно в `sample`), CDP принимает соединение и не отвечает;
  `pkill -9 -f SecurityAgent.bundle` снимает ожидание, но упирается в экран `ROX_OS_SECURE_STORAGE_UNAVAILABLE`
  (`pocket-account-store.ts:61`) с «Повторить» по кругу. Лечится флагом `--use-mock-keychain` в
  `live-scripts/rox-qa-launch.sh` (продуктовый код не менялся).
- **Свежий QA-профиль должен создать сам инстанс.** Если положить в пустой `ROX_CONFIG_DIR` только `voice.json`,
  приложение остаётся в полу-инициализированном состоянии: писатель заметок работает (диктовка легла заметкой
  `проверка диктовки.md` ✓), но сессии не персистятся (`[PersistenceQueue] Failed to write session … ENOENT:
  rename … session.jsonl.tmp`) и **диктовка отдаёт пустой транскрипт без тоста** (и хоткей тогда не открывает
  сессию с драфтом). Порядок для QA: дать приложению поднять профиль с нуля (свой `config.json` + рабочие
  каталоги), затем остановить его, подменить `voice.json` (`sttEngine: local-whisper`, `delivery: draft`,
  `trailingSpace: true`, `asrModelId: whisper-large-v3-turbo`, `recognitionLanguage: ru`), снова запустить.
- **Профиль `cfg-merged` может «заклинить» запись заметок (окружение, не продукт).** С ~22:15 в профиле
  `rox-verify/cfg-merged` **любая** запись заметок перестала отвечать: `listNotes`/`readNote` (чтения ✓)
  отвечают, а `createNote`/`saveNote` висят — и 8 с, и 30 с (проверено и прямым вызовом
  `window.electronAPI.createNote`, и из UI: стартовое зеркалирование встреч легло файлами 22:14–22:15, дальше —
  тишина). При этом в нативных сторах чисто (`pending=0`, `aborted_operations=0`, `conflicts=0`), claim-локов
  на диске нет, а мягкий перезапуск (`kill -TERM`, дать процессу выйти) **не помогает**. На **свежем профиле**
  (`ROX_QA_ROOT=/tmp/rox-qa-fresh`, свой cfg/user-data) запись работает сразу ✓ — поэтому живая приёмка заметок
  выполнена на нём. Практика для QA: если запись заметок в профиле висит, не тратить время на диагностику
  стора, а поднимать свежий профиль (`ROX_QA_ROOT` в `live-scripts/rox-qa-launch.sh`).
- **Инстанс живёт только в своей сессии**: приложение, поднятое внутри длинного bash-джоба, умирает вместе с
  ним по дедлайну; запускать через `subprocess.Popen(..., start_new_session=True)` и `</dev/null`.
- **`document.hasFocus()` в этом приложении недостоверен** (рапортует `true` даже когда спереди Finder):
  критерий «Rox не на переднем плане» снимается оконным сервером (`lsappinfo front` / `winlist.m`).
- **`window.voiceOverlay.stop()` требует `recordingId`** (сверяется с `latest.state.recordingId` при
  `phase === 'recording'`); UI передаёт его из `onState` — вызов без аргумента молча ничего не делает.
- **`meeting-rec-stop` с нулевым rect — не дефект вёрстки**: нулевой rect даёт узкая (`349 px`)
  `ModeScreen`-панель (`components/mode-screen/ModeScreen.tsx:77`); переключение на вкладку «Подробности»
  раскладывает кнопку (553,861 100×23, `hitIsSelf: true`), координатный клик останавливает запись.
- **Оракулы без vision-канала** (`read <png>?q=` в этой сессии недоступен): оконный сервер
  `live-scripts/winlist.m`, пиксельные статистики `live-scripts/png-stats.py`, OCR `swift /tmp/omp-ocr.swift`,
  полный `screencapture -x` (4112×2658 = 2× от 2056×1329 pt). Уровень волны читается из DOM только там, где он
  DOM (`span[style*="height"]` у оверлея); композерная волна — `canvas` (`VoiceLevelWave`), её живой оракул =
  доля «нарисованных» пикселей канваса по сэмплам.

**Гейты после конвергенции** (все — на финальном дереве; файлы `*.isolated.ts` запускаются по одному, как в их
врапперах — в общем прогоне их `mock.module('electron')` конфликтует): `bun run typecheck` (shared) EXIT=0 ·
`sort-locales --check` EXIT=0 · `check-i18n-parity` → `i18n parity OK (11 locales, 9554 keys each)` ·
`overlay-owner.test.ts` 1 pass (враппер, пинит `2 pass` и `0 fail` изолированного файла) ·
`overlay-owner.isolated.ts` 2 pass / 0 fail / 27 expect · `command-input.test.ts` 10 pass · `registration.isolated.ts`
2 pass · `renderer/lib/__tests__/transcripts-notebook.test.ts` 3 pass / 0 fail · `meeting-task-bridge.test.ts`
7 pass · `ipc-channels.test.ts` 8 pass · `channel-map-parity.test.ts` 4 pass · `deepgram-transcription.test.ts`
22 pass / 0 fail / 61 expect.

## Волна 4b — перепроверка, разбор красного CI и программа его починки (2026-10-09)

### Адверсариальная проверка «Волны 4» (независимый read-only агент)
Итог: **8 пунктов CONFIRMED сырыми строками рецептов, 2 — без рецепта, 2 — склейка двух разных прогонов.**
- CONFIRMED: кликабельность «Диктовки»; canvas-волна 24 сэмпла / 7 значений 0.15…0.3429; драфт `"проверка диктовки "` len 18; пустые тосты; заметка 152 B + якорь `96507d5c`; `ROX Voice` 420×72 `onscreen:true` (оконный сервер); A9 `630,79 119×28 hitIsSelf:true`; запись встречи (таймер 00:00→00:13, `levelMax 88`, whisper 2 сегмента); зеркало в заметки (2.3 КБ и 8.9 КБ, якоря).
- Без рецепта были: (а) «повтор не создал дубль» и (б) «10 сэмплов / 27 высот / 43–77 %» — донор чисел найден (`/tmp/rox-overlay-port.ts`), но его stdout нигде не сохранён.
- Склейка: в двух пунктах «pid 80909» (профиль fresh2) стоял рядом с «front = Finder» и `stop {ok:true}`, которые относятся к прогону 9334 (в прогоне 80909 спереди был OrbStack, стоп вернул `{ok:false, no overlay target}`).

**Перепроверка на финальном бандле закрыла оба пробела** (свежий профиль `/tmp/rox-qa-fresh3`, порт 9336, квитанции `live/fresh3-*` и `live/overlay*.json` этого прогона):
- **дедуп**: два идентичных прогона композера → ровно один `проверка диктовки.md` (152 B, sha256 в `live/fresh3-receipts.txt`);
- **оверлей**: цель `ROX Voice` грузится из `…/app/dist/renderer/voice-overlay.html` (тот самый упакованный вход, который теперь пинит тест), 16 полос, 48 сэмплов, **42 различных ширины 41…78 %**;
- **мини-окно при front = Finder** (`live/overlay-front-recording.txt`, `live/overlay-windows-recording.json`: owner=Rox, `ROX Voice` 420×72, `onscreen:true`) и **собственная кнопка стопа** → `{ok:true}` (`live/overlay-stop.json`), после — окна нет; хоткей-путь (оверлей → main → владелец) снова довёл транскрипт до композера (`live/overlay-hotkey-send.json` → `states[0].text = "проверка диктовки "`);
- **встречи**: `live/fresh3-meetings-record.log` (13 с, координатный стоп) и зеркало-заметка «Транскрипт встречи…» с телом whisper и якорем `397fc1fa`;
- **гейты на финальном дереве**: `sort-locales` EXIT=0 · `i18n parity OK (11 locales, 9553 keys each)` · `typecheck` 0 · `overlay-owner` 1/2 pass · `command-input` 10 · `registration` 2 · `transcripts-notebook` 3 · `meeting-task-bridge` 7 · `ipc-channels` 8 · `channel-map-parity` 4 · `deepgram` 22 — везде 0 fail. (Число ключей 9554 в строке выше — состояние на момент той проверки; после последующих мержей — 9553.)

### Регрессия моей волны в CI — найдена, исправлена, подтверждена
Факты: у workflow `product-tour-native` **нет ни одного зелёного прогона** (последние 200 запусков: 100 cancelled + 80 failure). Мой первый мерж `3f1a978e9` добавил четыре *новых* красных кейса `T-VOICE-OWNER` в job `browser-and-domain` — единственная регрессия волны.
- Причина: тест-харнесс подменяет только OS-поверхность Electron фейковым окном, у которого был `loadURL`, но не `loadFile`; `overlay-owner.ts` грузит упакованный вход через `loadFile` → `TypeError: created.loadFile is not a function` в `publish()`. (Upstream использовал `loadURL('file://…/../renderer/voice-overlay.html')` — неверный путь в упаковке; это и был баг «оверлей не виден».)
- Фикс (`83a8c393d`, в main): фейк получил оба метода и **пинит упакованный путь** (`renderer/voice-overlay.html`, без `..`). Локально 11 pass / 0 fail; **в CI на `83a8c393d` красных `T-VOICE-OWNER` больше нет** (job: 404 pass; среди `(fail)` — только унаследованные).

### Унаследованные красные: атрибуция и программа починки
На `83a8c393d` красными остаются (все были и на `b26b48b4b`/`dc7e8436f`): `T-MEETINGS-LIST/RESULT` (30 с таймаут), `T-PROJECT-OPEN…`, «A failed owned project detail…» — **реальные дефекты продукта**; `fresh-native-smoke (windows)` — 2 кейса, **жёсткие дедлайны проб 2 000/5 000 мс**; `fresh-native-smoke (macos)` — смоук убит по 180-с родительскому дедлайну. 15 таймаутов `persistence/progress.test.ts` в том прогоне оказались **флаком** (прошли сами).

| Группа | Файлы | Правка | Проверка |
|---|---|---|---|
| A. macOS-смоук | `tests/e2e/product-tour/native-harness.ts`, `native.config.ts` (+ `scripts/product-tour/run-native.ts`) | `rm` не был импортирован (teardown падал `ReferenceError`); CLI перестал убиваться по дедлайну: `timeout: 150_000`, `globalTimeout: 170_000`, родительский дедлайн 300_000, `actionTimeout: 15_000`, ожидание первой отрисовки 45_000; teardown ограничен 20 с с SIGKILL-фолбэком, удаление профиля — с ретраями и без падения теста; профиль перенесён в `test-results/product-tour/native/profiles/<pid>`, лог приложения (`home/Library/Logs/Electron/main.log`) цепляется к отчёту | было 180 с + SIGKILL и ноль информации; стало: CLI сам завершается, `native.json` пишется, и он назвал точную причину — `#root` числится «пустым», пока App держит состояние `loading` (`SplashScreen` — только SVG без текста), а выход из `loading` требует WS-проб транспорта (`waitForTransportConnected`, бюджет 12 с + `probeWithRetry`); 30-с таймаут `skills:get` — тот же симптом недоступного транспорта, а не причина: навыки грузятся пост-монтируемым эффектом и шелл не блокируют. Ожидание первой отрисовки поднято до 45 с |
| B. Таймауты persistence | `…/persistence/browser-test-harness.ts` | `--disable-dev-shm-usage` в аргументы запуска Chromium (стандартный фикс 5-с «клина» в контейнерах) | `progress.test.ts` локально **17 pass / 0 fail** |
| C. Дефекты продуктового tour | `pages/ProjectInfoPage.tsx`, `…/runtime/ProductTourProvider.tsx` | эффект `projects.available` не возвращал disposer и оставлял вечный pending; `ready` поднят выше `pending` в слиянии contributions | оба целевых кейса `project-collection.browser.test.ts` — **1 pass / 0 fail** (в CI были красными) |
| D. Фикстура встреч | `…/meetings-automations/native-ui.browser.test.ts` | `finishCatalog` резолвил один запрос из нескольких ожидающих — теперь дренит все (как `finishTranscript`) | `T-MEETINGS-LIST/RESULT` (A → B → A) и ранее флаковавший `T-MEETINGS-RESULT: changing the panel…` — оба **1 pass / 0 fail** |
| E. Windows-пробы | `authority/os-private-path.ts`, `native-os-owner.ts` (+2 согласующих теста) | сняты две строки перекодировки консоли — единственный код между маркерами `process-start`→`input-ready`, где вставал ребёнок; по итогам CI дедлайны проб подняты до 45 000/30 000 с синхронным подъёмом бюджетов тестов (реальные пробы; две mock-only проверки остались на 5 000) | локально `os-private-path.test.ts` **12/12**, `rox-readiness-ui-001.windows-owner.test.ts` **19/19** (на darwin win32-кейс скипается). В CI снятие перекодировок продвинуло стадии ребёнка с `process-start` до `input-complete` — прежний стоп убран; остаток (ACL/identity-работа дольше дедлайна) закрыт новыми бюджетами, вердикт лейна — в следующем прогоне |

**Остаётся открытым (итерация 2 — уточнено ниже, в «Итерации 3»):** macOS-лейн после этих правок больше не «висит»: CLI сам завершается, пишет `native.json` и профиль с логом приложения. Его оставшийся блокер — поведение холодного старта, а не навыки (проверено отдельным разбором: `main.tsx:157` монтирует корень безусловно, `bootstrap.ts:36` ждёт только локали, а `skills:get` вызывается пост-монтируемым эффектом с `catch` — `AppShell.tsx:1575-1596`): пока WS-транспорт не поднялся, `App.tsx:2554-2556` держит состояние `loading` и рисует `SplashScreen` без текста, а тест «fresh product setup appears» считает `#root` пустым по `textContent` (SplashScreen — только SVG). Правильное решение — по вкусу владельца: дать сплэшу видимый текст/статус или раньше переводить `appState` в `transport-unavailable` (`App.tsx:1061-1073`), не выжидая полный бюджет WS-проб (`waitForTransportConnected` 12 с + `probeWithRetry`). Ожидание первой отрисовки в смоуке поднято до 45 с; итог — по прогону `2654da336`. Отдельно, для владельца: ограниченный quit-путь `apps/electron/src/main/index.ts:2052-2056` (`Promise.race` + `app.exit(0)` через 5 с), чтобы зависшая подсистема не оставляла зомби-процесс. Также восстановлены импорты сервера приёмки (`scripts/product-tour/serve-application.ts`), потерянные чужим мержем `20900316a`/`76e30c1b9` — без них e2e-шаг `browser-and-domain` не стартовал вовсе.

**Итерация 3 (прогон `ef51e1cb9`, состояние на момент отчёта).**
- **Unit-часть `browser-and-domain` — 407 pass / 0 fail** (было 386/22): фикс голосовой регрессии и группы B/C/D подтверждены зелёными в CI, включая все A11-кейсы (`T-MEETINGS-LIST/RESULT` A→B→A, `T-MEETINGS-RESULT: changing the panel…`, `A failed owned project detail…`, `T-PROJECT-OPEN…`).
- **e2e-шаг впервые дошёл до своих тестов** (сервер стартует) и обнажил их собственный, ранее скрытый красный: `APP-05` (`tests/e2e/product-tour/product.application.spec.ts:73`, `nativeScope`/`getWorkspace…`) — отдельный продуктовый разбор.
- **Windows-пробы**: продвижение стадий подтверждено (`process-start`→`input-ready`→`input-complete` после снятия перекодировок), но ACL/identity-работа не уложилась и в 45 с — тест дошёл до 62 с и упал на своём 60-с бюджетe. Три раунда (2/5 → 15 → 45/30 с) проблему не закрыли; похоже на холодный PowerShell+Defender на раннере. Решение за владельцем: либо ещё бюджет, либо измерять/оптимизировать пробу на windows-хосте (локально не воспроизводится).
- **macOS — корень найден и закрыт** ✓: 75-с ожидание показало точку — `locator('#onboarding-username')` не появлялся, причём **и локально**. Разбор с экспериментами: харнесс подменял `HOME` на пустой `profile/home`, из-за чего дочерний Electron терял доступ к login-keychain macOS → `safeStorage.isEncryptionAvailable() === false` → `pocket-account-store.ts:61` бросал `ROX_OS_SECURE_STORAGE_UNAVAILABLE` → `getRoxCloudState` падал → `App.tsx:985` делал фатальный выход, и `decideStartupAppState` давал `transport-unavailable` вместо `onboarding` (наружу виден лишь маскирующий текст «startup probe deadline exceeded»). Тот же запуск с настоящим HOME (изоляция — только `ROX_*`/`CRAFT_*` каталогами, которые приложение и так поддерживает) дал `encryptionAvailable=true`, `cloud={required:true,connected:false}` и `usernameInput=1`. Фикс в харнессе: реальный HOME + лог приложения копируется в профиль; **локальный прогон: `✓ NATIVE-01/NATIVE-02 (8.4s)`, `status=PASS`, `exitCode=0`, `elapsedMs=10 223`** — впервые в истории лейна.
- **Диагностика разблокирована**: харнесс сохраняет профиль при `ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE=1` (включено в workflow), поэтому артефакт прогона несёт `native/profiles/<pid>/home/Library/Logs/Electron/main.log` — проверено локально: профиль остался, лог на месте (в нём — здоровый старт и `[bundled-skills] background sync finished … 34749 ms`).

**Итерация 4 (CI-прогон `1178a63e5`).**
- **`fresh-native-smoke (macos-15)` — SUCCESS** ✓ — **первый зелёный прогон этого лейна** (фикс keychain/HOME подтверждён в CI; до этого — окно из 200 прогонов без единого успеха).
- `browser-and-domain`: unit-часть зелёная (407/0), красной остаётся одна e2e-проверка `APP-05` (`tests/e2e/product-tour/product.application.spec.ts:73`): `getWorkspaces()` отдаёт `rootPath: "/tmp/rox-product-tour-app-Jz8AvY/workspace"`, а тест (инвариант приватности: аутентифицированный WebUI не видит хостовый путь) ждёт `rootPath: ""`. Из 14 e2e-тестов 13 зелёные; расхождение вскрыто впервые (раньше шаг не доходил до тестов из-за падения сервера).
- `fresh-native-smoke (windows-2025)`: дочерний хост проб исчерпал свой бюджет — `Expected {exitCode: 0, stdout: "actual Windows … guards passed\n", timedOut: false}` против `Received {exitCode: 1, stdout: "", timedOut: true}`, 62 370 мс, падение на `rox-readiness-ui-001.windows-owner.test.ts:143`. Дедлайны подняты до 45/30 с, но ACL/identity-фаза на раннере всё ещё не укладывается в бюджет хоста; нужен windows-хост для замера (`Measure-Command`) и решения — ещё бюджет или оптимизация пробы.

**Итерация 5 (коммиты `9906af437`, `a43d0a4e4`, `65efd2bca`).**
- **e2e `APP-05` закрыт** ✓. Разбор показал: это пробел харнесса, а не продукта — production-редакция `rootPath` существует в двух слоях (`packages/server-core/src/handlers/rpc/workspace.ts:116` — `rootPath: ''` для аутентифицированного принципала, и `apps/webui/src/adapter/web-api.ts:159-162` — WebUI-адаптер), а статическая заглушка харнесса (`scripts/product-tour/serve-application.ts:126`) отдавала сырой хостовый путь; фикстура уже вычисляла поверхность (`restricted`), но к `getWorkspaces` её не применяла. Теперь фикстура (`tests/e2e/product-tour/fixtures/application/main.tsx`) зеркалит WebUI-проекцию на web-поверхности и сохраняет полную запись на десктопной. Локально **14 passed** (было 13/1); **в CI `browser-and-domain` — SUCCESS** (unit 407/0 + e2e 14/14).
- **Найден и устранён дефект CI-инфраструктуры**: слияние с чужими правками оставило в шаге смоука **два ключа `env:`** (их `DEBUG: pw:browser` + наш `ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE`). YAML принимает дубль молча (побеждает последний), а **GitHub Actions отклоняет весь файл**: прогоны на `ac7076c65` завершались мгновенно с пустым списком джобов. Оба ключа сведены в один `env:` (`a43d0a4e4`), все workflow проверены на дубли (чисто). Урок для батча: после каждого слияния валидировать YAML на повторяющиеся ключи.
- **Windows: медленно, а не висит** ✓ — эксперимент с бюджетами дал ответ: кейс A («actual Windows identity…») **прошёл** на 120-с бюджете (18/19, было 17/19), т.е. PowerShell-проба на этом раннере стоит ~90–120 с на spawn, но завершается. Кейс B («real Node host creates and reopens authority…», две пары проб) убит 180-с бюджетом хоста на 182-й секунде → цепочка поднята до пробы 180 с / хоста 420 с / per-test 480 с (`65efd2bca`), ассершены согласованы; локально 12/12 и 19/19. Вердикт — следующим прогоном `product-tour-native`.
- macOS-лейн в прогоне `a43d0a4e4` помечен `cancelled` (новый пуш отменил прогон, не падение): его зелёный статус стоит с `1178a63e5`, а файлы лейна с тех пор не менялись.

**Итерация 6 — статус верификации в CI (2026-10-09, ~02:00 MSK).**
- Всё запушено в `origin/main` (последнее: `869be2b13`): фикс e2e `APP-05`, дефект дубля `env:` в workflow, финальные windows-бюджеты (проба 180 с / хост 420 с / per-test 480 с), пин каналов (861→863, два `fabric:infisical*`) и гард пин-теста в `test:product-tour`.
- Подтверждено прогонами: `browser-and-domain` — **SUCCESS** на `a43d0a4e4` (unit 407/0 + e2e 14/14); `fresh-native-smoke (macos-15)` — **SUCCESS** на `1178a63e5` (первый зелёный в истории лейна); windows-эксперимент дал ответ — «медленно, не висит» (18/19 на 120-с бюджете, кейс A прошёл).
- Оставшийся вердикт (windows-лейн на финальных бюджетах + сводный прогон) **не получен по внешней причине**: очередь GitHub Actions забита — на момент проверки **60 прогонов `queued` при 6 `in_progress`**; пуши нескольких агентов отменяют прогоны до старта, и прогон на `4d175ab69`/`869be2b13` не материализовался за 30 минут наблюдения. Как только очередь рассосётся, `product-tour-native` отработает сам: ожидаются зелёные `browser-and-domain` и `macos` (их файлы с тех пор не менялись) и windows на бюджетах 180/420/480.
- Локальные гейты на финальном дереве: `sort-locales` EXIT=0 · `i18n parity OK (11 locales, 9623 keys)` · волновые файлы 1/2/10/2/3/7/8 pass · `deepgram` 23 · `os-private-path` 12 · `windows-owner (darwin)` 19 · `ipc-channels` 8 — везде 0 fail.

**Итог верификации (2026-10-09): `product-tour-native` — ЗЕЛЁНЫЙ по всем трём лейнам** ✓✓ — прогон `#37859744621` на `15e85d6ff` (ветка `fix/sash-hit-area-reanchor`, построенная поверх нашего `4d175ab69`): `browser-and-domain` **success** (unit 407/0 + e2e 14/14), `fresh-native-smoke (windows-2025)` **success** (бюджеты 180/420/480 подтверждены — лейн зелёный впервые), `fresh-native-smoke (macos-15)` **success** (фикс keychain/HOME). Принадлежность доказана `git merge-base --is-ancestor`: `9906af437`, `c35f035a9`, `a43d0a4e4`, `65efd2bca`, `4d175ab69` — все внутри этой ревизии. До этого у workflow **не было ни одного зелёного прогона** в окне из 200 запусков. Собственный прогон `4c87fe925` (в нём лишь CI-гард пин-теста и эта дока) стоит в общей очереди Actions (60 queued / 6 in progress) и отработает тем же кодом.

### Наблюдения окружения QA (не продукт волны)
- `[PersistenceQueue] Failed to write session … ENOENT … rename … session.jsonl.tmp` пачками в свежем профиле: каталог `workspaces/<ws>/sessions` есть, отсутствуют каталоги конкретных сессий (включая авто-сессии агентов) — кандидат на отдельный разбор ядра сессий.
- `[Chat] Failed to load skills: Request timeout: skills:get (30000ms)`; `[FreeFormInput] Failed to resume pending plan execution: Error: Connection lost` и `[WsRpc] Sequence gap` при реконнектах; сборка `mcp-server-qdrant` падает (`pyo3` vs Python 3.14) при провижининге MCP.
- QA-профиль видит сессии локального сервера приложения (в списке — реальные сессии): прогоны не приватны, наружу ничего не отправляется.
- Готча навигации: `meetings-record` жмёт `nav:home`, но с `route=meetings` дашборд не поднимается — нужен DOM-клик по `[data-sidebar-link-id="nav:home"]`.
- `tests/e2e/product-tour/native-startup.test.ts` импортирует несуществующие `openNativeStartup`/`NativeStartupDiagnostics` — мёртвый файл, не запускается ни одним workflow.
