# Golden Gate: план проверки и фактические границы доказательств

Дата: 2026-09-14. База исходной инвентаризации: `22c8b89858f8c41d3f687f13d49a31b55045c146`. Родительская задача: [#541](https://github.com/rox-one/rox-one/issues/541). Матрица содержит 63 сценария: QA-01…QA-45 первоначального охвата и QA-46…QA-63 продолжения доработки.

## Текущее состояние

**Визуальная приёмка результата и проверка Electron/macOS заблокированы.** Доступный Cloud Browser отклонил локальный продуктовый URL по политике доступа. Обход через другой адрес, прокси или альтернативную browser-поверхность недопустим. Пользовательский снимок ROX 2048 × 1329 фактически просмотрен и разобран в [SCREENSHOT-REVIEW.md](SCREENSHOT-REVIEW.md); версия приложения на нём неизвестна. Это свидетельство исходного состояния, а не результата изменений. Снимок 21st.dev — только внешний дизайн-референс.

| Свидетельство | Уровень | Статус на момент составления | Ограничение |
|---|---|---|---|
| Инвентаризация routes/settings/components | C: статическое чтение | 575 TSX / 501 Props относятся к исходной базе, не к текущему повторному подсчёту | Не доказывает runtime reachability, RPC или вид экрана. |
| Новые регрессии моделей | U: unit | Есть проверки геометрии, черновиков, ответов, таймеров, навигации; финальные прогоны — [VERIFICATION.md](VERIFICATION.md) | Наличие теста и даже его PASS не закрывают весь пользовательский сценарий. |
| Разметка общих и экранных компонентов | R: render-to-string | Есть проверки ролей, подписей, связей полей и отсутствия закрытых controls; результаты — [VERIFICATION.md](VERIFICATION.md) | SSR не выполняет layout, перенос фокуса, голосовой ввод и взаимодействие с порталом. |
| Актуальные typecheck / сборки / CI | T/B | Только результаты с указанием проверенного состояния в [VERIFICATION.md](VERIFICATION.md) | Исторические failure ниже не являются текущим результатом ветки. Сборка не запускает native runtime. |
| Пользовательский снимок ROX | V: исходное наблюдение | Просмотрен, 2048 × 1329; разбор связан с изменениями | Неизвестный commit; не является снимком результата PR. |
| Снимки результата в приложении | V: визуальная приёмка | BLOCKED: policy rejection локального URL | Не заменять снимками референсов или отрендеренным вне приложения mock. |
| Реальные server/RPC сценарии | S: интеграция | Не приравниваются к fixtures и mocked handlers; факт запуска указывается в VERIFICATION.md | Нет утверждения о приёмке всех реальных служб по зелёному unit suite. |
| Electron/macOS native bounds/focus/mic/Keychain | N: native integration | BLOCKED / NOT RUN | Linux/browser fixture не подтверждает macOS поведение. |
| Дизайн-эксперименты E01–E08 | E: пользовательские/инструментальные эксперименты | PROPOSED | Метрики успеха — цели, фактических пользовательских результатов ещё нет. |

Состояния ниже — **план приёмки**, если рядом не указан конкретный результат соответствующего уровня. Наличие автоматических регрессий отмечено отдельно от открытых F/V/S/N проверок. Итоговые числа и логи не дублируются здесь: источник текущих результатов — [VERIFICATION.md](VERIFICATION.md).

Историческая база до изменений имела 50 ошибок Electron typecheck и 403 PASS / 2 FAIL в shell suite. Эти значения сохранены для сравнения; они не описывают текущую ветку. Промежуточные прогоны также не подменяют финальный результат. Первичная проблема установки старого native sharp под Node 24 не позволяет считать native runtime проверенным по успешной renderer-сборке.

## Уровни доказательств и шаблон результата

| Уровень | Что доказывает | Что не доказывает |
|---|---|---|
| C — code inspection | Наличие route/component/handler/условия в указанном commit | Внешний вид, выполнение операции, accessibility. |
| U/T/B — unit/type/build | Контракт модели, типы, возможность собрать bundle | Реальный UI flow, поведение native surfaces и служб. |
| R — render-to-string / SSR | Роли, подписи, связи полей, текст и условное наличие разметки | Геометрию, реальный Tab/фокус, pointer events и accessibility tree браузера. |
| F — browser fixture | DOM/интеракции на известных synthetic данных | Реальные OAuth, Keychain, browser pane, microphone, SSH, remote server. |
| V — visual product capture | Фактический вид названного экрана/состояния на названном стенде | Все скрытые состояния и backend outcome. |
| S — real server | End-to-end API/RPC и состояние конкретного подключённого сервиса | macOS compositor/native focus, если это web-клиент. |
| N — Electron/macOS | Window controls, bridge, embedded/native view и системные разрешения | Пользовательские предпочтения без отдельного исследования. |
| E — эксперимент | Метрика по описанному протоколу/выборке | Общая победа редизайна без достаточных данных. |

Каждый результат содержит: `case_id`, `requirement_ids`, `issue_id`, `commit`, `baseline_commit`, `environment` (OS/device/runtime/viewport/zoom/theme/locale/data fixture), `steps`, `expected`, `actual`, `status`, `evidence_level`, `artifacts`, `limitations`. При блокировке указать фактическую причину; «не проверено» не равно PASS.

## Покрытие запроса: реализация, предложение и блокировка

| Запрос | Трассировка | Работа в коде / план | Приёмка |
|---|---|---|---|
| Компактный свежий macOS Golden Gate | R02/R07/R11; GG-001; все SH/SC/ST/OV | Токены/примитивы и частичные миграции Chat/Notes/Tasks/Meetings/settings/collections | Снимок исходного состояния просмотрен; внешний вид результата BLOCKED; native macOS NOT VERIFIED. |
| Постоянная rail и контекстный sidebar | R01/R03; GG-002; SH-02/04, SC-11 | ActivityRail, контекстные hosts, компактные профиль/память, сохранённые defaults и hidden zero counters | U/R проверки отдельно; product visual/keyboard flow BLOCKED. |
| 4/6 панелей, 2×2/3×2, оба resize, spatial focus, state | R04/R05/R06; GG-003/004; SH-03 | Geometry/layout/lifecycle и направленные команды по соседним панелям | Model tests не заменяют 4/6 смешанных native panels и restart; native/visual gate OPEN. |
| Сохранить всю функциональность | R01/R14/R16; GG-008…024 | 27 surface-групп + 22 settings + overlays описаны; несколько screen-specific миграций выполнены частично | Прочие сервисы и особые тела настроек остаются открыты; полный функциональный/визуальный аудит не завершён. |
| Ленивая диагностика по клику | R09/R13; GG-005; SH-06 | Read-only bridge, ленивые чип/панель и управление запросами | Closed/hidden request tests доступны; реальные macOS metrics/native visibility BLOCKED. |
| Короткие статусы в заголовке | R08; GG-006; SH-05 | Priority/dedupe/expiry, сохранение остатка времени при паузах | U/R доказательства отдельно; actual layout/screen reader ещё OPEN. |
| Контекстные skills/workflow hints | R10; GG-007; SH-07 | Policy/компонент и защита от действия в устаревшем контексте; E06 — предложенный эксперимент | Нет утверждения о измеренной релевантности/конверсии. |
| Strong/link/пунктир/code/highlight единообразно | R07; GG-001/009/010/024 | Общие semantic tokens плюс потребители Markdown/editor/preview | DOM semantics можно проверить; contrast/readability/highlight visual gate OPEN. |
| Motion и настройки доступности | R11/R14; GG-001/004/024 | Короткие переходы и reduced motion контракт | Подтверждение на OS/browser settings и native compositor ещё OPEN. |
| Подробные предложения/эксперименты/issues | R17; PRD E01–E08; issues.json | Документы и 25 задач опубликованы, продолжение разобрано в POLISH-REVIEW.md | Опубликованная задача не означает реализованную и принятую функцию. |

## Набор воспроизводимых данных

Использовать подготовленный контролируемый workspace без личных секретов и внешних side effects. Запись разрешена только в тестовые объекты, предусмотренные существующим approval flow. Нельзя менять policy приложения ради прохождения теста.

| Набор | Содержание |
|---|---|
| D0 | Новый workspace без сессий/заметок/источников/навыков/проектов и с отсутствующими интеграциями. |
| D1 | 12 сессий: idle/running/cancelled/error/approval/credential; длинные RU/EN названия, emoji, 3 проекта, tree labels, archive/flag/unread, linked task/note. |
| D2 | 500 сессий с metadata sidecar, 100+ labels, большой transcript и tool output; фиксированный seed для до/после. |
| D3 | Vault: длинный Markdown, table/code/math/images/PDF, wiki links/backlinks/missing target, tasks/properties/comments/footnotes, external edit conflict и несохранённый draft. |
| D4 | Saved note views, canvas с нечётным числом узлов, большой graph, outline folds; Knowledge connection отсутствует/подключён/упал, stale mutation proposal. |
| D5 | 5 connection tabs, auth expired, unavailable bridge, credential references без значений; source MCP loading/error; OMP/project/bundled/pending skills; memory conflict. |
| D6 | Scheduled/event/agentic automation, invalid cron/graph, success/partial/failure executions; meeting paused/finalized, proposal pending/approved/rejected; page no content/loading/error/grant revoked. |
| D7 | Local/remote workspace, browser instance, terminal process, extension sandbox, SiYuan document; только на разрешённом Electron/native стенде. |
| D8 | Управляемые задержки чтения/сохранения/диктовки, обратный порядок ответов, A → B → A, одинаковые note paths в разных пространствах, повторный клик, ошибка записи и контролируемые часы статуса. |
| D9 | Ширины рабочих панелей 320/360/420/640 px и общий workspace 2×2/3×2; длинные RU/DE названия, 150% zoom, opened/closed sheets, скрытый retained panel и отсутствие адресата инспектора. |

Во всех тестах dirty draft содержит кириллицу, emoji и выделение. Перед/после фиксируются route, instance ID, draft checksum, active tab/view, selected entity, scroll position, canvas viewport и native instance/process ID, если поле доступно. Для restart не обещать восстановление эфемерного DOM selection/паролей, если существующий storage этого не поддерживает.

## Проверки оболочки и общих контрактов

| Case | Issues / требования | Шаги и ожидаемый результат | Нужное доказательство | Сейчас |
|---|---|---|---|---|
| QA-01 | GG-001 / R02,R07 | Token/font role parity; light/dark/high contrast; выбранная именованная тема переживает reload; текст/ссылки/code/mark читаемы. | U/B + V: primitives, chat, Notes, settings | Code/spec ready; V BLOCKED |
| QA-02 | GG-002 / R01,R03 | Пройти все rail destinations, дополнительное меню, context filters, back/forward; повторный клик фокусирует существующую панель. | U + F/V navigation trace | Visual flow BLOCKED |
| QA-03 | GG-003 / R04,R05 | Создать 1/2/4/5/6/7 панелей, auto/columns/grid-2/grid-3/focus; измерить grid bounds; resize X/Y; reload workspace. | U geometry + F/V bounding boxes + N restart | U регрессии расширены; итог в VERIFICATION; V/N BLOCKED |
| QA-04 | GG-004 / R05,R06,R13 | Spatial arrows по неравным панелям; editor/terminal shortcuts; скрыть/вернуть 4/6 panels; проверить stable IDs, drafts, native bounds и focus. | U nearest-neighbor + F mount counters + N | N/V BLOCKED |
| QA-05 | GG-005 / R09,R12,R13 | 60 s closed → open → in-flight close → hidden → reopen; no overlap/stale updates; real metrics/unsupported partial. | U timers + IPC trace + N real snapshot | Native metric proof OPEN |
| QA-06 | GG-006 / R08 | Replay 100 mixed events/duplicates; error/action/running/success priorities; timer expiry; action links; live region. | U model/fake timer + F screen-reader tree + V | V BLOCKED |
| QA-07 | GG-007 / R10 | Eligible/ineligible/missing handler, impression, dismiss, cooldown, apply/save; spy показывает 0 mutations до activation. | U policy + F editor action + E06 relevance | E PROPOSED; V BLOCKED |
| QA-08 | GG-001/004/024 / R11,R14 | Reduced motion/transparency/contrast; zoom80/100/125/150; hover/focus/disabled/busy; no tooltip-only action. | CSS/DOM audit + V + N OS setting | V/N BLOCKED |
| QA-09 | GG-024 / R14,R15 | Tab through menus/dialogs/overlays; nested Esc; focus returns; RU/EN/de long text; locale parity/sorted keys. | U i18n/escape + F keyboard + V | Visual keyboard run OPEN |
| QA-10 | GG-025 / R12 | Same seeded D2 trace до/после; cold ready/cached switch/menu/view/notes/browser/canvas, IPC counts and hidden CPU. | Perf report with environment and raw samples | Базовые бюджетные определения известны; redesign measurements OPEN |

## Экранные сценарии

Каждая строка выполняется минимум на ready, empty, loading, error и permission/unavailable данных; при неприменимости состояния фиксируется причина. Все 22 settings страницы перечислены явно. Для каждой также применяется QA-08/09.

Статус NOT RUN здесь относится ко всему сквозному сценарию, а не к отсутствию изменений в коде. Общие controls уже доработаны; отдельные Chat/Notes/Tasks/Meetings миграции перечислены ниже и в POLISH-REVIEW.md. Их U/R проверки не закрывают все состояния этих экранов.

| Case | Экранные IDs / issue | Минимальный happy path и риск | Контрольный failure / состояние | Сейчас |
|---|---|---|---|---|
| QA-11 | SC-01/02/05/06/07; GG-008 | Home→session; list↔board↔table↔heatmap, filters/group/sort, selection/bulk; D2 perf. | Empty/filter empty, partial bulk, DnD rollback, missing board session. | NOT RUN redesign |
| QA-12 | SC-03/04, OV-04; GG-009 | Draft+attachments→send→stream/tool→approve→complete; map fork/outline checkout; view return. | Credential expired, denied approval, cancel/error, unavailable teamchat/SiYuan graph. | Частичная доработка Chat/composer; U регрессии; полный F/V flow OPEN |
| QA-13 | SC-08/12; GG-014 | Project create→task→properties/link/import/export; `tasks/task/{id}` selects correct item. | Unknown ID, invalid import, upload/save error, no calendar. | Выбор по route исправлен; Tasks доработан, U/R есть; проектный end-to-end OPEN |
| QA-14 | SC-09/10/11/22; GG-013 | Source edit/tools/auth; pending skill diff/apply; memory conflict; connections preview/confirm. | Missing API/auth, unavailable MCP, OMP shadowed, invalid credential import. | NOT RUN redesign |
| QA-15 | SC-13; GG-015 | `meetings/meeting/{id}`→capture/pause/stop→manual note→finalize→proposal review. | Mic denied, failed import/finalize, duplicate apply, missing ID. | Выбор по route исправлен, экран/запросы доработаны; U/R есть; S/N OPEN |
| QA-16 | SC-14; GG-010 | Create/edit/save/rename/move Markdown, wikilink/comment/property/task/asset; grid focus restore. | External conflict, failed save, missing target, rename impact cancel. | Notes доработан; U/R регрессии, включая QA-52…55; F/V OPEN |
| QA-17 | SC-15; GG-011 | Table saved view/formula; canvas move/fit; outline fold; graph filter; convert to task/session. | Invalid stored JSON, empty graph, oversized graph, stale source note. | Общий переключатель и сохранение редактора доработаны; полная приёмка views OPEN |
| QA-18 | SC-16/17/18; GG-012 | Knowledge search/view→doc/block/database→inspector→proposal→apply/reject. | No connection, feature off, removed native instance, stale diff conflict. | V/N BLOCKED |
| QA-19 | SC-19; GG-016 | Scheduled/event/agentic→edit→test→enable→execution/replay; workspace graph without selection. | Invalid cron/timezone/graph, paused, partial failure, denied run. | NOT RUN redesign |
| QA-20 | SC-20, OV-05; GG-017 | Blank page→design→preview→project→share→manage grant→delete. | No content, lease/snapshot error, revoked source grant, public copy retention. | NOT RUN; N overlay BLOCKED |
| QA-21 | SC-21/23/24/25/26/27; GG-018 | Browser tabs/history/inspect; extension; terminal process; cloud run route; inspector focus/close. | Removed surface, unsupported route, native occlusion, runtime unavailable, Conation flags off. | N/V BLOCKED |
| QA-22 | ST-01; GG-019 | Profile name/avatar→save, plan/balance/XP; links privacy/connections. | No avatar/plan/value, API denied/save error; amount not fabricated. | NOT RUN redesign |
| QA-23 | ST-02; GG-019 | Change consent→export request→deletion review/status. | Queued/not-live/failed deletion, realtime recovery dependency. | NOT RUN redesign |
| QA-24 | ST-03; GG-020 | Runtime provider/model/thinking/mode→tool toggle/env save/secret ref. | Offline/missing/outdated toolchain, next-session-only vs apply-now failure. | NOT RUN redesign |
| QA-25 | ST-04; GG-021 | Preferences/context doc edit, template diff/keep mine, project override. | Unsaved switch/delete cancel, stale template, save error. | NOT RUN redesign |
| QA-26 | ST-05; GG-022 | Catalog search/tag/sort/available→install/update/remove; offline report. | Offline/deferred/capability rejected/stale stats. | NOT RUN redesign |
| QA-27 | ST-06; GG-022 | Local prompt save→detect optional engine→test/start→migration. | No binary/token/connection; partial migration; detect never auto-downloads. | NOT RUN; N engine BLOCKED |
| QA-28 | ST-07; GG-022 | Catalog/installed/update/permissions/disabled/developer; URL allowlist and host controls. | Incompatible plugin, invalid prefix, no host, capability revoked. | NOT RUN; N surface BLOCKED |
| QA-29 | ST-08; GG-022 | Scan→query/filter/select→preview→persist/results; browser profile import. | Truncated scan, denied grant, partial failure, invalid profile. | NOT RUN; N import BLOCKED |
| QA-30 | ST-09; GG-020 | Environment/notifications/awake/browser/proxy/update controls. | Invalid URL/protocol, notifications denied, update download error. | NOT RUN; N OS controls BLOCKED |
| QA-31 | ST-10; GG-020 | Default/override connection/model/thinking; add/edit/rename/validate/reauth; context/cache/RTK. | Corrupt/expired/other-machine credential, unavailable runtime, invalid model. | NOT RUN redesign |
| QA-32 | ST-11; GG-021 | Theme/font/language/zoom/kanban/tool icon and shell options. | Missing theme fallback, long locale, reduced settings, 150% zoom reset. | V/N BLOCKED |
| QA-33 | ST-12; GG-020 | Typing/spellcheck/send shortcut, voice config/dictation. | IME composition, mic denied, no device/model/runtime. | N voice BLOCKED |
| QA-34 | ST-13; GG-021 | Rename/icon/default source/mode/cycling/workingDir/notes path/TLS. | No workspace, bad path, single cycle mode rejected, icon error. | NOT RUN; native picker BLOCKED |
| QA-35 | ST-14; GG-019 | Accounts connect/reconnect/signout/health/migration; profile/server URL. | Expired token, corrupt credentials, unknown health, reset cancel. | NOT RUN redesign |
| QA-36 | ST-15; GG-023 | Explicit load permissions→default/custom rules→edit/audit/gateway. | No config, invalid rule, denied read; no implicit grant. | NOT RUN redesign |
| QA-37 | ST-16; GG-023 | Audit/filter/finding details→accept risk rationale/expiry→revoke/fix. | Stale/unavailable audit, invalid expiry, host-only action remote. | NOT RUN; N host actions BLOCKED |
| QA-38 | ST-17; GG-021 | Root/child label→name/color→auto rule→delete. | Save error/invalid hierarchy/delete impact; color-independent identity. | NOT RUN redesign |
| QA-39 | ST-18; GG-019 | Org→team spaces/members→invite→accept; identity edit. | No mailer/pending/expired invite, denied role, long member ID. | NOT RUN redesign |
| QA-40 | ST-19, OV-06; GG-023 | Each of five messaging connections; Telegram access/owners/topics, Discord trigger, session binding. | QR expiry/auth failure/offline/denied owner; close stops poll. | NOT RUN; real integration OPEN |
| QA-41 | ST-20; GG-023 | Enable server/remote, port/cert/key/token, sidecar/restart. | Bad port/key/cert, restart cancel, unavailable/disabled sidecar. | N server lifecycle BLOCKED |
| QA-42 | ST-21; GG-023 | Provider/secret/webhook/sandbox/TTL/limits/schedule/persona config. | Missing provider secret, invalid units/limits, gated sandbox. | NOT RUN redesign |
| QA-43 | ST-00/22; GG-021 | Search all 22 settings→detail→new window; shortcut registry/platform labels. | No matches/no active workspace, unknown shortcut, compact overview. | NOT RUN; V/N BLOCKED |
| QA-44 | SH-01, OV-01/02; GG-024 | All onboarding branches + create/open/remote/SSH workspace and reauth. | Provider error/cancel, native path denied, TLS/SSH failure, environment skip. | N auth/picker BLOCKED |
| QA-45 | OV-03/07/08; GG-024/GG-018 | Menu→submenu→preview→annotation→Esc; all rich types; voice/browser auxiliary window. | Unsupported type, load error, nested modal, restore selection/focus. | V/N BLOCKED |

## Регрессии продолжения доработки

Эти 18 сценариев дополняют предыдущие, не заменяя их полную приёмку. Связь с изменениями — [POLISH-REVIEW.md](POLISH-REVIEW.md). U/R означает наличие предметных автоматических проверок; факт и итог последнего запуска берутся из [VERIFICATION.md](VERIFICATION.md). Там, где проверяется реальный фокус, геометрия, звук или служба, автоматическая модель не считается прохождением F/V/S/N.

| Case | Issues / требования | Шаги и ожидаемый результат | Автоматическая часть | Открытая приёмка |
|---|---|---|---|---|
| QA-46 | GG-002/003/008/018 / R02,R03,R04 | D0: один каталог, запись не выбрана, инспектор без адресата. Видна одна рабочая пустая область; скрыты пустой detail и лишняя строка одной вкладки. Выбрать запись и открыть вторую панель — они возвращаются без потери маршрута или сохранённой геометрии. | U: shell layout, inspector model; C: условные hosts | F/V: настоящий размер областей и отсутствие наложений — BLOCKED. |
| QA-47 | GG-002/024 / R03,R14 | Отсутствующие настройки дают компактные группы без нулевых значков. Явное сохранённое `[]` раскрывает все группы. Скрыть подсказку памяти в A, перейти B → A; чтение настроек не записывает состояние A в B. Профиль/память доступны с клавиатуры. | U: preferences/nav helpers; R: sidebar chrome | F/V: клавиатурный переход и длинные названия — BLOCKED. |
| QA-48 | GG-003/004 / R04,R05 | В неравной сетке направленные команды выбирают геометрического соседа; на краю остаются на допустимой панели. Перейти между 2×2/3×2/focus, уменьшить доступную площадь и вернуться. Размеры остаются конечными и допустимыми; настройки A и B не смешиваются. | U: panel geometry, directional actions и preferences | F/V/N: реальные bounds, направление взгляда, native focus — BLOCKED. |
| QA-49 | GG-003/018 / R05,R14 | Изменить разделитель указателем и стрелками/Shift/Home/End; отменить через Esc, pointercancel и потерю окна. Границы объявлены корректно, обработчики завершённого drag сняты, editor остаётся доступен. | U/R: resize helpers, Notes/inspector separator semantics | F/V: pointer capture, возвращение фокуса и фактическая ширина — BLOCKED. |
| QA-50 | GG-009 / R02,R05,R12 | Читать старый ответ в одном чате, переключить фокус и продолжить поток в другом. Двигается только соответствующий viewport при разрешённом следовании за концом. D9: раскрыть/свернуть инструменты ввода; высота учитывает перенесённые controls, меню скрытого ряда закрывается. | U: chat-scroll; C: composer width/ResizeObserver | F/V: поток, длинные model/mode names, 150% zoom и сохранение позиции — BLOCKED. |
| QA-51 | GG-009/020 / R01,R14 | Запустить диктовку, допечатать кириллицу/emoji и пробелы, получить результат. Он дописывается к текущему тексту. Отменить или перейти к другой сессии/запросу до ответа — поздний результат туда не попадает. | U: dictation guard/append | N/S: реальный микрофон, распознавание, permissions и IME — OPEN. |
| QA-52 | GG-010 / R01,R06 | D8: открыть заметку A, затем B; ответ A задержать. B остаётся выбранной. Повторить при A → B → A по пространствам, сбросе выбора, закрытии, новом поиске и открытии rename/delete. Поздний ответ не подменяет новый каталог/документ и не открывает действие для старой записи. | U: Notes request ownership; C: search cancellation и action wiring | F/S: реальные Note RPC задержки и быстрая навигация — OPEN. |
| QA-53 | GG-010 / R01,R06 | Отправить сохранение первой версии, дописать вторую до подтверждения. Вторая остаётся dirty и получает собственное сохранение. Ошибка не очищает текст. Начатое ранее чтение с диска не стирает новую правку; явная перезагрузка остаётся доступной. | U: save snapshot acknowledgement; C: debounce и refresh guard | F/S: настоящие записи, external watcher и переход при pending save — OPEN. |
| QA-54 | GG-010 / R06 | Создать разные несохранённые комментарии в двух заметках и одинаковых note paths двух пространств; переключить inline rail ↔ sheet ↔ другой вид. Возвращаются исходные цитата и текст каждого черновика. Текст из соседнего DOM не становится цитатой этой заметки. | U: draft keys/updates/scoped selection; R: controlled composer | F/V: перемещение формы и выделение; после restart восстановление этих эфемерных черновиков не заявлено. |
| QA-55 | GG-010/011/024 / R05,R06,R14 | D9: уменьшить Notes и открыть оглавление/комментарии/инспектор временно. Вернуть ширину, сменить вид и скрыть панель-владельца. Редактор сохраняется; закрытая форма недоступна для Tab, обычное выделение не крадёт фокус, закрытие не фокусирует скрытый блок. | U: rail budgets/focus guard; R: closed rail и labels | F/V: Radix portal, focus trap/restore, реальные геометрия и редактор — BLOCKED. |
| QA-56 | GG-014 / R01,R06,R14 | В Tasks изменить поле и сразу выполнить соседнее действие blur/click. Обе правки исходят из последнего store. Имитировать ошибку сохранения/импорта — ввод остаётся; сменить выбранную задачу и вернуться к её незавершённым полям/связи. | U: draft/presentation/import helpers; R: catalog presentation | F/S: реальный store/write cycle, drag order и все project bindings — OPEN. |
| QA-57 | GG-015 / R01,R06 | В Meetings запросить каталог, затем поиск/создание; задержать старый ответ. Новая запись/выбор не исчезают. Повторить клик start/import/apply и смену пространства; завершение старого запроса не меняет текущую встречу. | U: request tracker/catalog contracts; C: owners/epochs | S/N: реальная запись, импорт и исполнение предложения — OPEN. |
| QA-58 | GG-015 / R06,R14 | Набрать ручную заметку/правку сегмента/заголовок предложения, отправить и продолжить ввод. После успеха очищаются только всё ещё совпадающие отправленные поля; черновик другой встречи/пространства не меняется. | U: matching draft field clear; R/C: forms и per-meeting keys | F/S: реальная форма во время ответа сервера — OPEN. |
| QA-59 | GG-019…023 / R07,R14 | Пройти Input/Textarea/Toggle/Select/Radio/Segmented и secret reveal. Подпись, помощь и ошибка связаны с полем; disabled секрет нельзя открыть. В menu select работают стрелки, выбор, typeahead; Home/End в поиске и IME сохраняют текстовую семантику. | U: menu navigation; R: settings accessible contracts | F/V/N: настоящий Tab, screen reader и все 22 screen bodies — OPEN/BLOCKED. |
| QA-60 | GG-008/024 / R03,R14 | Открыть display/filter menu коллекции; проверить отмеченное состояние и подпись. Открытие фильтра не вызывает его удаление, удаление не открывает меню; отдельные controls доступны с клавиатуры и имеют имена. | R: collection accessibility; C: handlers | F/V: реальные события, focus restore и длинные filter chips — BLOCKED. |
| QA-61 | GG-006/007 / R08,R10 | Показать короткий статус, прочитать часть времени, навести/сфокусировать/открыть меню/скрыть окно. Возобновить — истекает оставшееся время, не полный интервал. Замена/закрытие отменяет старый timer; ошибка/действие не теряются; подсказка не действует в другом контексте. | U: pausable deadline/status/suggestions; R: live region presence | F/V/N: реальные паузы, отсутствие повторных объявлений VoiceOver и тесный header — BLOCKED. |
| QA-62 | GG-005 / R09,R12,R13 | Открыть диагностику, начать чтение/копирование и сразу закрыть/скрыть/сменить вкладку. Поздний ответ не обновляет закрытую панель, запросы не накладываются; повторное открытие даёт актуальный read-only снимок, закрытое состояние не опрашивается. | U/C: diagnostics lifecycle/validation, bounded requests | N/S: реальные CPU/RAM/process/network samples и стоимость сбора — OPEN. |
| QA-63 | GG-003/004/025 / R04,R05,R12,R13 | Смешать Chat/Notes/Browser/Knowledge/Terminal в 2×2 и 3×2, менять размеры и фокус. Сохраняются редакторы/экземпляры. Частично обрезанная native view показывает предусмотренный fallback; только полностью видимая сфокусированная native view получает bounds. | U: geometry/native owner/visibility; C: retained hosts | V/N: весь сценарий, GPU/frame trace/idle CPU и restart — BLOCKED. Одновременная композиция нескольких частично обрезанных native views не реализована. |

## Производительность: цели и статус gates

Действующий файл `apps/electron/src/renderer/perf/budgets.ts` задаёт нижеуказанные бюджеты. Только `cached_session_switch` имеет `ciGate:true` в базовой версии; нельзя называть остальные обязательным существующим CI без изменения конфигурации. Новый продуктовый gate утверждается вместе с воспроизводимым измерением.

| Метрика | Бюджет p95 | Базовый CI | Метод |
|---|---:|---|---|
| cold_ready | 2500 ms | Информационный | Холодный запуск фиксированного fixture/runtime; отдельно network/toolchain startup. |
| cached_session_switch | 120 ms | Обязательный | 500 сессий; 0 `sessions.list`, максимум 1 permission и 1 metadata IPC на interaction. |
| view_switch | 200 ms | Информационный | Уже загруженные данные, active view swap; не измерять mock timeout как реальный UI. |
| notes_open | 300 ms | Информационный | Фиксированный note и assets/cache state. |
| browser_chrome | 250 ms | Информационный | UI toolbar response отдельно от загрузки сторонней страницы. |
| dropdown_open | 80 ms | Информационный | Input event→paint; одинаковый большой menu fixture. |
| canvas_layout | 400 ms | Информационный | Фиксированные nodes/edges и engine; UI responsive во время вычисления. |
| Resize frame | ≤16.7 ms p95 | Новая цель E04 | Реальный trace на названном устройстве; не объявлять 60fps по отсутствию JS ошибок. |
| Закрытая/hidden диагностика | 0 poll | Новый контракт | IPC counter; одноразовый fetch после явного open допускается. |

CPU/memory/bundle сравниваются с базой на том же стенде. До получения baseline нельзя утверждать улучшение в процентах. Замеры сохраняют количество samples, warm-up, p50/p95/max, пропуски/ошибки и версию. Synthetic model test считается synthetic, не интерактивным browser trace.

## Команды и условия завершения

Команды ниже — предусмотренные проверки, а не автоматически выполненные результаты:

```sh
bun run electron:build:renderer
bun run typecheck:electron
bun test packages/shared/src/i18n
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run test:perf-budgets
```

Точечные tests изменённых handlers/models выбираются по реальному diff; не писать snapshot, который только повторяет текст реализации. Полный typecheck сравнивается с сохранённой исторической базой, а после обновления main — также с точной базой интеграции; новые ошибки запрещены, устранённые базовые отмечаются отдельно. Текущее число ошибок и тестов берётся из VERIFICATION.md. Публикация issue и наличие CSS не закрывают screen-specific acceptance.

Release gate `GG-025` остаётся открытым до разрешённого продуктового стенда, на котором получены actual screenshots, все route/state проверки и реальные Electron/macOS lifecycle результаты. При текущей блокировке допустим честный результат «код реализован частично/по указанным направлениям, сборка и конкретные tests подтверждены, визуальная/native приёмка не выполнена» с точным списком оставшихся работ.
