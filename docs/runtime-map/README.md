# Живая карта выполнения ROX

Выбор «Карта» открывает правую панель рядом с тем же `ChatDisplay`. Карта читает наблюдения исполнителей; она не отправляет запросы модели, не исполняет показанные команды и не создаёт задачи. Старый `SessionWorkflowEditor` доступен в явном режиме «Редактор процесса» с прежними callbacks, версиями, pins и branch operations.

## Подключение в действующем приложении

| Граница | Фактический исходник |
|---|---|
| Версионированный договор событий, контекста, идентичностей и измерений | `packages/core/src/runtime-trace/types.ts` |
| OMP observer, приватный ограниченный NDJSON-spool и native mapping | `packages/shared/src/agent/omp-runtime-observer.ts`, `omp-runtime-trace-bridge.ts`, `omp-agent.ts` |
| Канонический журнал и collector | `packages/server-core/src/sessions/runtime-trace/`, подключение в `SessionManager.ts` и `TaskRunner.ts` |
| RPC registrar | `packages/server-core/src/handlers/rpc/index.ts` импортирует и вызывает `registerRuntimeTraceHandlers` из `runtime-trace.ts` |
| Desktop/web клиентский facade | `apps/electron/src/transport/channel-map.ts`; его импортируют `apps/electron/src/preload/bootstrap.ts` и `apps/webui/src/adapter/web-api.ts` |
| Единственный источник live-событий | существующий `App.tsx` session-event listener с проверкой текущего authority/workspace до trace ingress |
| Snapshot/cursor, восстановление gap, projection | `apps/electron/src/renderer/event-processor/runtime-trace-ingress.ts`, `hooks/useRuntimeTrace.ts` |
| Постоянный split и карта | `pages/ChatPage.tsx`, `components/runtime-map/ChatRuntimeSplit.tsx`, `RuntimeMapDock.tsx` |
| Каталоги | существующие корни `MainContentPanel.tsx`, `SkillsCatalogPage.tsx`, `IntegrationsCatalogPage.tsx` |
| Пустой чат | `ChatDisplay.tsx`, `EmptyChatWelcome.tsx`, `StarterPromptList.tsx`; используется прежний ROX asset |

Каждая операция имеет собственные run/agent/parent/span/attempt и source/event identities. Повторная доставка события не создаёт новую операцию. Queue, approval, retry, interruption и acceptance остаются разными состояниями. Context snapshot сохраняет actual ordered parts; compaction создаёт новую версию. Статус applied появляется только при явном наблюдении применения. Отсутствующие reasoning, usage, model window и durations остаются неизвестными.

Кнопка обзора укладывает текущее ограниченное окно событий в настоящие полосы агентов с сохранением порядка внутри каждой полосы. Подпись явно отличает этот обзор от общей шкалы времени. Он сохраняет исходные события и связи; клик по карточке или фокус возвращает обычную шкалу и читаемый масштаб. Сохранённая камера включает режим обзора и ограничена текущими workspace/session/run.

Запуск сохраняет фактический источник, доступную привязку интеграции и идентификатор события. Для расписания отдельно показаны timezone, occurrence, плановое время и наблюдённое время dispatch; отсутствующие значения остаются неизвестными. Эти сведения описывают запуск и не дают права доступа к аккаунту или сессии.

Ссылки `rox://runtime?workspace=…&session=…&run=…&event=…` адресуют чтение исторического запуска. Main parser ограничивает и проверяет references; renderer сохраняет request отдельно от журнала. Чтение всё равно проходит существующие workspace/session/native grant проверки RPC.

## Совместимость и откат

Новая трасса хранится в отдельных sidecars с schema version 1. Она не заменяет прежний transcript, task authority, credentials store или workflow draft. История без trace показывает reconstruction только из сохранённых полей и маркируется неполной. Повреждённый/torn журнал сохраняет целые строки и сообщает partial coverage. Snapshot/cursor replay не исполняет прошлые инструменты.

При откате версии приложения старый reader продолжает читать прежний transcript и workflow documents; новые trace sidecars можно оставить без удаления. Откат следует выполнять штатной процедурой установки предыдущей сборки после закрытия приложения, сохранив workspace backup. Не следует вручную изменять task authority или credentials, удалять пользовательские sessions либо менять schema version в существующем журнале. Это инструкция эксплуатации, а не утверждение об installed-app rollback smoke на неподтверждённой платформе.

Секреты маскируются до spool/journal/blob/transport. Native session grants не получают host instructions, host paths или tool payloads. Экспорт карты разрешает только observation metadata; опубликованные workflow documents не получают raw trace автоматически.

## Доказательства и область проверки

Матрица R01–R30 и команды находятся в `docs/evidence/runtime-map/validation.md`; baseline и offline gate ограничения — в соседних `baseline-test-triage.md`, `offline-gates.md`, `workflow-compatibility.md`. `media/` содержит безопасные screenshots и короткую запись одновременного изменения настоящих renderer компонентов чата и карты в изолированном deterministic executor стенде. Это renderer integration fixture, не installed-app или paid-provider smoke.

Native SDK loop закреплён на OMP 18.4.12, сверяет integrity и использует реальный task/eval/restricted worker runtime с тестовым provider. Windows WorkGraph platform guard, native model readback и permission responses ради доказательства не отключаются. Непроверенные платформы и live-provider ограничения перечисляются отдельно от выполненных unit/native/renderer проверок.
