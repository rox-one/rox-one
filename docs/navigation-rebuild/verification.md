# Проверки пересборки навигации

Дата записи: 2026-10-04. Рабочая область: `/Users/t/Projects/rox-navigation-rebuild-20261003`. Область этой записи — каркас навигации, канонические задачи/профили/блоки, память, типизированные автоматизации и интеграция с основной веткой. Требования и этапы: [spec.md](spec.md); владельцы и зависимости: [plan.md](plan.md).

Результаты ниже подтверждают ограниченные проверки исходного кода и настоящего локального WebSocket RPC. Они не являются заявлением о production, установленной версии приложения, визуальной приёмке или внешних провайдерах. Окончательная интегрированная реализация: `12dafec990df9851aa5764511ba0eaee81d25065`, включает main `439b9d4f141fe8d484f57f0fa55681de7b7af966`. Предыдущая интеграция `f5daf80dc...` включала main `47b5fcd...`. Окончательная доставка дополняется после push/readback. Пересекающиеся наборы тестов не суммируются в общий уникальный счётчик.

## Подтверждённые результаты после объединения с main

Среда: локальный macOS, Bun `1.4.2 (43848b5a7)`, временные изолированные данные. Логи находятся в `/tmp/rox-nav-context-checks.cp3QSs`; это локальные временные артефакты, не опубликованные внешние результаты.

| Проверка | Результат | Лог |
| --- | --- | --- |
| Automation context, редактор/граф RPC, memory proposals, MemoryService/decay, prompt automation | **107 pass, 0 fail, 347 assertions**, 7 файлов | [post-merge-focused-tests-corrected.log](/tmp/rox-nav-context-checks.cp3QSs/post-merge-focused-tests-corrected.log) |
| Native Inbox через реальный scoped authority и WebSocket; native Memory | **14 pass, 0 fail, 14 assertions**, 2 файла: 11 сценариев Inbox + 3 сценария Memory | [post-merge-native-memory-tests-corrected.log](/tmp/rox-nav-context-checks.cp3QSs/post-merge-native-memory-tests-corrected.log) |
| Отдельный обновлённый fixture memory proposals перед общим повтором | **15 pass, 0 fail** | [post-merge-memory-fixture.log](/tmp/rox-nav-context-checks.cp3QSs/post-merge-memory-fixture.log) |
| `git diff --check` для назначенных конфликтных файлов и последующих исправлений | Exit **0** | Проверено локально; отдельного файлового лога нет |

Команды воспроизведения двух итоговых наборов:

```sh
bun test packages/shared/src/automations/context.test.ts packages/server-core/src/handlers/rpc/automations-editor.test.ts packages/server-core/src/handlers/rpc/automations-graph.test.ts packages/server-core/src/handlers/rpc/memory-proposals.test.ts packages/server-core/src/memory/__tests__/memory-service.test.ts packages/server-core/src/memory/__tests__/memory-service-decay.test.ts packages/server-core/src/sessions/execute-prompt-automation-test-mode.test.ts
bun test packages/server-core/src/handlers/rpc/__tests__/native-inbox-queues.test.ts packages/server-core/src/handlers/rpc/__tests__/memory-native-acceptance.test.ts
```

SHA-256 итоговых логов:

```text
11011e8a4a101ada17f79a73a7cd1cbe14bd99f41d874a85e2be65510260e95e  post-merge-focused-tests-corrected.log
e1f425698667c139ce9fc817699dcd96867e0b37f5756fb413b83ca80b568310  post-merge-native-memory-tests-corrected.log
```

Проверенные поведения:

- Принятие предложения памяти фиксируется после долговечной записи выбранной цели и подтверждения результата. Несуществующий проект и отказ записи сохраняют непринятый статус. Повтор после записи цели, но до сохранения статуса, не дублирует проектную запись и восстанавливает receipt.
- Явная цель workspace записывается в workspace store; личная цель требует личности, проверенной transport authority. Сохраняется изоляция владельцев. Старая глобальная память не переименована в личную; legacy approvals без receipt не становятся доказанными записями.
- Чужая или отсутствующая каноническая сессия не запускает провайдер извлечения. Для native callers используются канонические сообщения сессии. Разрешение проверяется до вызова и после ожидаемого ответа; отзыв прав и смена корня исключают последующую запись.
- Ожидающая и поставленная в очередь дистилляция не записывает память после перехода в temporary/incognito, отключения обучения или остановки сервиса. Явные ручные операции сохраняют существующие правила авторизации.
- Автоматизации используют устойчивые ID и типизированные ссылки на workspace/project/object. Удалённая или чужая цель препятствует выполнению и оставляет устойчивую причину паузы до явного валидного переподключения. Временная недоступность не подменяется удалением. Обычное редактирование, включение и запись графа не сбрасывают паузу скрыто.
- Выполнение prompt automation сохраняет project/context binding и hooks authority из main. Тест scheduler runtime launch сохранён вместе с тестом типизированного контекста.
- Настоящие native WS сценарии проверяют owner isolation, чужое workspace, read-only и revoked callers, смену корня во время ожидания, producer lifecycle/deferred completion, восстановление после перезапуска и отсутствие host-private preferences в ответе памяти. Это backend/RPC доказательства, не desktop screenshot/AX приёмка.

## Первоначальные ошибки и исправления

| Наблюдение | Установленная причина | Исправление и повтор |
| --- | --- | --- |
| Первый набор после merge: **105 pass, 2 fail** из 107 | Два unit fixtures передавали изготовленный объект principal и не имели настоящего native authority/registry. Новая проверка из main корректно отказала до проверяемой ветви owner/session. Mock config также не экспортировал `resolveConfigDir`. | Fixture использует enrollment → authentication, реальные grants, канонический registry/root, `nativeData.authority` и явный transport-current seam. Сохранены owner/cross-workspace/session/revocation assertions; native session error соответствует canonical gate. Итог **107/0**. [Первый лог](/tmp/rox-nav-context-checks.cp3QSs/post-merge-focused-tests.log). |
| Первый native набор: **3 pass, 11 fail** | Все три начальные очереди отдельно отказали в `assertNativeInboxWorkspace`: macOS fixture записывал `/tmp` или `/var` alias, а strict authority зарегистрировал `/private/...`. Диагностика: registry существует, workspace совпадает, `authorize(alias)=false`, `authorize(realpath)=true`. Fixture и общие scope/registry helpers совпадали с main; различие authority затрагивало только новый membership projection. | Fixture берёт `realpathSync(directory)` перед созданием roots. Production authority и строгий запрет alias сохранены; все 11 негативных сценариев остались. Итог native **14/0**. [Первый лог](/tmp/rox-nav-context-checks.cp3QSs/post-merge-native-memory-tests.log), [диагностика predicate](/tmp/rox-nav-context-checks.cp3QSs/debug-native-predicate.log). |
| Lead сообщил об ошибке типов: дублирующий `MemoryProposal.owner` после автоматического merge | Обе ветки добавляли одно и то же поле с одинаковым типом. | Удалена только повторная декларация; native owner semantics сохранены. Финальный общий typecheck фиксирует lead отдельно. |

Конфликты в `AutomationEditor.tsx`, RPC `automations.ts`/`memory-proposals.ts`, `MemoryService.ts` и `execute-prompt-automation-test-mode.test.ts` разрешены с сохранением новых authority/revision hooks из main и принятых context pauses, durable receipts, session binding и mode guards. Worker не выполнял staging, commit, push или запуск интерфейса.

## Исторические проверки до merge

Это предыдущие checkpoints, полезные для истории регрессий; они не заменяют итоговую квалификацию после объединения с main.

| Набор | Результат | Лог |
| --- | --- | --- |
| Память, automation system/context/graph/prompt handler/resolver/editor, receipt helper | **116 pass, 0 fail, 341 assertions**, 11 файлов | [focused-tests.log](/tmp/rox-nav-context-checks.cp3QSs/focused-tests.log) |
| MemoryService: queued/awaited mode race + decay | **61 pass, 0 fail, 172 assertions**, 2 файла | [memory-mode-race-tests.log](/tmp/rox-nav-context-checks.cp3QSs/memory-mode-race-tests.log) |
| Каноническая сессия и durable approval | **15 pass, 0 fail, 68 assertions**, 1 файл | [memory-session-binding-tests.log](/tmp/rox-nav-context-checks.cp3QSs/memory-session-binding-tests.log) |

Предыдущий server typecheck имел ошибку литерала в соседнем workspace-work тесте; исправление передано его владельцу. Дублирующий Electron typecheck остановлен по просьбе lead с exit 143: пустой лог остановленного процесса не считается успехом. Окончательные результаты компиляторов и сборок добавляются отдельно.

## Границы доказательств и оставшаяся интеграция

- По текущей [спецификации](spec.md) второй этап — настоящий командный мессенджер и внешние календари — **отложен**. Удалённый транспорт, внешний provider и командный обмен не доказаны этими тестами; демонстрационные данные не подменяют интеграцию. Звонки сохраняют обозначение «Скоро».
- Существующая память с native owner filtering не доказывает командную общую память. Недоступный внешний object adapter остаётся недоступным; автоматизация не получает выдуманную цель. Credential reference не сохраняется как обычная memory lesson: возвращается явная ошибка.
- Существующая политика Bash/filesystem execution сохранена. Ограничение профиля агента не заявляется новым жёстким filesystem sandbox.
- Canonical workspace tasks, права общих задач, профили и наследование ограничений дочерними сессиями принадлежат source_scout; финальная интеграция и native UI — lead. Их результаты дополняются только фактическими логами и readback.
- Проверки сохранения основного объекта/черновика/прокрутки, переключения панелей и workspace, узкого окна и восстановления после relaunch требуют отдельной нативной приёмки. Backend WS pass не закрывает эти пункты.
- Результаты в этой записи относятся к рабочему дереву в момент указанных запусков. Lead добавляет delivered revision, родителей merge, финальные type/build/native артефакты, PR и remote readback; до этого эта запись не связывает доказательства с опубликованной ревизией.


## Общая интеграционная проверка

| Проверка после merge | Результат | Сохранённое доказательство |
| --- | --- | --- |
| Типы shared/server-core/Electron | Все три exit 0; Node 22.23.3, повтор после refresh main завершён 2026-10-03 22:38 UTC | [types.json](evidence/types.json) |
| Каноническое хранилище, native RPC, профильное наследование, exact registry | 17 pass / 0 fail / 71 assertion | [backend17.log](evidence/backend17.log) |
| Основная/дополнительные панели, receiver навигационных событий, долговечные черновики, URL/history | 30 pass / 0 fail / 78 assertions | [shell30.log](evidence/shell30.log) |
| UI contracts: keyboard/focus/layout, captured project, notes/page context, meeting-task bridge | 60 pass / 0 fail / 289 assertions | [ui60.log](evidence/ui60.log) |
| Локализация | Parity 8716 keys × 12 locales, sorted и literal coverage pass | [parity](evidence/i18n-parity.log), [coverage](evidence/i18n-coverage.log) |
| Сборки main/preload/renderer/resources/assets | Exit 0 | [renderer](evidence/renderer-build.log), [main](evidence/main-build.log), [preload](evidence/preload-build.log) |
| Scoped ESLint изменённых renderer TS/TSX | 0 errors, 66 warnings | [renderer-lint.log](evidence/renderer-lint.log) |
| Изменения относительно фиксированного integration target | `git diff --check 439b9d4f...` exit 0 | Сравнение выполнено до merge commit |

SHA-256 сохранённых логов и среда перечислены в [manifest.json](evidence/manifest.json). ANSI и хвостовые пробелы удалены только из копий логов; manifest содержит хеши оригиналов. Это не полный `validate:ci`, не проверки всех пакетов и не qualification всех внешних провайдеров. Новые тексты переведены на русский и английский; в остальных десяти языках новые ключи имеют английский fallback. Проверки parity не означают завершённый перевод на все языки.

Два registration expected sets обновлены новыми main `runtimeTrace` каналами без изменения exact-once assertions. Первый повтор превысил 20 секунд при холодном импорте под нагрузкой и породил позднюю continuation; core test timeout увеличен до 120 секунд. Изолированный повтор 4/0 и итоговый полный набор 17/0 прошли. Производственные регистрации не менялись для исправления теста.

При автоматическом merge дублировались `panelId` и `MemoryProposal.owner`. Повторы удалены. Возвращаемое boolean переключения workspace осталось у контроллера history, который прекращает restoration при отказе сохранения черновика; UI получает Promise<void> wrapper. Все три окончательных проверки типов прошли.

## Нативное окно и сохранённые данные

Проверка проводится в отдельном Electron 39.2.7 с конфигурацией `/private/tmp/rox-navigation-native-20261004-clean/config` и отдельным `user-data`. Workspace `2ebaf193-670c-9f4b-5994-f4a1e9ab6a55`, slug `navigation-check`. Импорт чужих клиентских сессий отключён **до** запуска чистого fixture. Секреты и пользовательские данные в fixture не копировались.

Подтверждено через AX, фактическое окно и каноническое чтение:

1. Узкая панель слева содержит поверхности; внизу — Задачи, Автоматизации, Память, Агент, Настройки. Логотип и имя workspace находятся сверху. Screenshot опубликован в текущем чате; отдельный PNG не сохранён.
2. Панель задач открывается рядом с Планом. Через интерфейс создана задача `task_b65b9bba-9a07-4a6c-adc5-873c1d4a0327` с названием «Проверка навигации · задача пространства». После запуска нового процесса она видна в разделе «Пространство». Изменение статуса на «В работе» прочитано из `workspace-work/state.json` (revision 2).
3. Через «Запланировать работу» выбран этот canonical task и сохранён блок 2026-10-04 09:00–10:00. Календарь показывает кнопку с временем и названием задачи; запись прочитана из того же store.
4. Агент открыт рядом с Планом, восстановлен существующий диалог `261004-bold-branch`. Синтетический черновик введён штатной вставкой текста; отправка не нажималась. `drafts.json` содержит точный текст. Переход на Ленту меняет primary route на `feed`, оставляя agent route `allSessions/session/261004-bold-branch` и captured context Плана. Выбор вкладки Агент показывает неизменённый черновик.
5. Rail Агент закрывает и снова открывает свою панель; primary и панель задач остаются. Выполнение команды при этом не запускалось.

Исправление, обнаруженное именно в окне: раньше receiver события перехода отбрасывал опцию `primary`, и Лента открывалась внутри Agent pane. Receiver теперь передаёт весь набор опций; два теста через настоящий EventTarget и panel atoms проходят. Нативное URL/readback выше подтверждает правильное поведение.

История незачтённых проб:

- Первое изолированное окружение разрешало автоматический импорт; запуск остановлен и заменён чистым fixture с запрещённым auto-import. Его данные не используются как доказательство.
- AX `setValue` в rich text не запускал событие редактора: видимый текст сам по себе не был сохранён. Эта проба исключена; окончательный черновик введён через paste, кнопка отправки стала доступна, durable JSON проверен.
- Lazy route Агенты проверялся в процессе удаления старых assets при активной сборке renderer. Наблюдение «Ошибка загрузки содержимого» не зачтено как результат final build. Требуется повтор в окончательном процессе.
- Final build перезапущен 22:26 UTC. URL восстанавливает primary `agents`, tasks/agent roles и captured contexts. После этого Mac заблокирован; инструмент сообщил, что штатное unlock недоступно. Пользователю отправлена одна просьба разблокировать Mac. Визуальная приёмка итогового relaunch, профилей, меню workspace, остальных инструментов и узкого окна **ожидает разблокировки**. Эти пункты не закрываются сборкой, backend tests или прежними screenshot.

Ограничения: не проверен отправленный запрос внешнему LLM, внешняя календарная авторизация или remote messenger. Автоматическая установка необязательного Qdrant MCP в тестовом окружении отложилась из-за Python 3.14 / pydantic-core; навигационные и canonical workspace-work операции выполнялись без него. Не установлена release-версия в пользовательский профиль и не выполнен merge/release основной ветки.


## Последняя проверка и доставка

После создания draft PR основной main обновился на 42 commits. Выполнено ещё одно фиксированное объединение с `439b9d4f141fe8d484f57f0fa55681de7b7af966`. Единственный конфликт `TasksPage` разрешён с сохранением адаптивного footer и новых платформенных подписей hotkeys. Языковые ключи main сохранены; сортировка и parity повторены.

Независимый renderer review выявил и исправил три P2:

- Открытие задачи из календаря теперь обновляет маршрут **и** captured project контекст существующей Tasks pane, сохраняя её ID и основной календарь. Исполняемый component harness проверяет A→B→All.
- Маршрут общей/личной задачи переключает область в обе стороны; bare route сохраняет ручной выбор. Исполняемый hook harness проверяет workspace→personal→workspace.
- Rail Agent использует общий capture/open intent guard. Новое действие с инструментом или поверхностью отменяет доставку позднего результата; origin panel/focus также проверяются. Шесть тестов utility intent с настоящими Jotai atoms проходят.

Финальные повторные наборы: backend17/0, memory+automation107/0, nativeWS14/0, shell+transitions30/0, UI60/0. Исходники runtime не изменялись во время запусков; commit `12dafec99` зафиксировал уже готовое рабочее дерево. Общие types и main/preload/renderer повторены после этих исправлений. [Manifest](evidence/manifest.json) указывает эту implementation revision; документационный commit может быть позже без изменения runtime.

[Draft PR #1486](https://github.com/rox-one/rox-one/pull/1486) прикреплён к текущему чату. Remote head/readback фиксируются отдельно после последнего push. CI на предыдущем PR head ещё ожидал runners; Vercel status сообщает **Account is blocked**. Это внешний запрет deployment, не результат локальной сборки. Публичный deployment не выполнен.

Сохранён [канонический readback синтетических данных](evidence/native-data-readback.json): задача, work block, черновик. Он подтверждает ранее выполненные операции в изолированном окне и не подменяет ожидающую нативную проверку final refresh build. Mac всё ещё требует ручной разблокировки; просьба отправлена один раз.
