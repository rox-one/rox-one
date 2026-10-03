# Проверки пересборки навигации

Дата записи: 2026-10-04. Рабочая область: `/Users/t/Projects/rox-navigation-rebuild-20261003`. Область этой записи — память, типизированные связи автоматизаций и их интеграция с текущим main. Требования и этапы: [spec.md](spec.md); владельцы и зависимости: [plan.md](plan.md).

Результаты ниже подтверждают ограниченные проверки исходного кода и настоящего локального WebSocket RPC. Они не являются заявлением о production, установленной версии приложения, визуальной приёмке или внешних провайдерах. Финальная ревизия, общие проверки типов/сборки, нативный интерфейс и доставка дополняются lead после интеграции. Пересекающиеся наборы тестов не суммируются в общий уникальный счётчик.

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
