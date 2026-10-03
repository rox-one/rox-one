# S02: актуальные наблюдения и приёмка

Аудит продолжается; полная приёмка этапа не выполнена. Базовая установленная версия — Rox 0.11.5, source `f63294ba4fffa7238b46b24e918925a313ad0b12`, main SHA256 `fc555356e91f72f3b69bb8dfe14d8eb8ac0d224f61e8a7f397b4c3c584f13993`. Исторические captures привязаны к процессам и viewport; смена процесса без управляемого испытания не считается restart PASS. Частные AX, снимки, export и записи пользователя остаются локально.

## Наблюдаемые работающие сценарии

- Home quick task → Tasks: canonical запись; изменение приоритета, тега и checklist; поиск с положительным и отрицательным контролем; завершение задачи отражается в Home.
- Notes: сохранение и повторное открытие собственных QA материалов; переход Home calendar → та же заметка; Outline collapse/expand. Отдельные действия не дают PASS всему экрану.
- Memory: создание workspace lesson, pin, disable/enable, изменение правила и поиск. Настоящий native turn выбрал lesson в provenance и записал usage; успешный ответ агента пока не получен.
- Feed: настоящий публичный RSS, 20 полученных статей, поиск и фильтр цвета; порядок дней и отдельная сортировка внутри дня; starred annotation; создание canonical заметки. После Tasks hydration создание задачи даёт canonical запись и открывает её.
- Connections: переходы по пяти вкладкам, актуальные пустые состояния credentials/audit, существующие local sources. Настройка аккаунтов, allow/deny и обмен данными не приняты.
- PDF: native Save создаёт настоящий PDF с текстом и контрольной меткой заметки. Визуальная проверка обнаружила отдельный дефект печатного checklist.

## Подтверждённые остаточные дефекты

| ID | Наблюдаемый результат | Следующая проверяемая работа |
| --- | --- | --- |
| RX-AUDIT-001 | Сохранённая связь задачи с заметкой не меняет Tasks route после нажатия | Реальный переход в правильную заметку; поддерживаемые соседние виды связей и missing-note failure |
| RX-AUDIT-002 | Tasks count в Table становится 0 для неактивной заметки, хотя её Markdown содержит checklist | Полное содержимое каждой строки; сохранение и повторное открытие обеих заметок |
| RX-AUDIT-003 | Table «В задачу/В сессию» неактивной строки молча возвращается | Конверсия выбранной строки с правильным материалом; отрицательный контроль чужой активной строки |
| RX-AUDIT-004 | Wiki autocomplete сохраняется как escaped brackets; parser не видит связи | Семантическая ссылка сохраняется, reopen/backlinks/Graph; literal brackets не превращаются в ссылку |
| RX-AUDIT-005 | Feed до Tasks hydration показывает успех; после открытия Tasks задача отсутствует. Тот же путь после hydration работает | Fresh process → Feed first → canonical acknowledgement → Tasks/restart; RPC rejection без ложного успеха |
| RX-AUDIT-006 | UI/header выбранной Rox модели расходится с actual native provider/model первого turn | Перед prompt/respawn применить и проверить выбранную модель; unknown/unavailable model прекращает запрос с явной ошибкой |
| RX-AUDIT-007 | Imports показывает необработанные ключи `connections.import.*` | Переведённые labels/help, паритет 10 локалей, реальные native формы |
| RX-AUDIT-008 | В Graph кнопка PDF enabled, но её нажатие не открывает диалог и не сообщает причину | Работающий экспорт предусмотренного содержимого либо явно недоступное действие с понятной причиной |
| RX-AUDIT-009 | PDF короткой заметки содержит огромный checklist SVG и лишний разрыв страницы | Печатный checklist правильного размера/состояния; текст и соседний Markdown не повреждены |
| RX-AUDIT-010 | Повторное открытие непустой библиотеки Projects приводит к ErrorBoundary | Полные записи проектов в списке; список → проект → настройки → повторное открытие, соседний session picker |

RX-AUDIT-005: ID первоначальной несохранившейся задачи не захвачен. Независимо проверены false-success UI, отсутствие результата в Tasks, working hydrated control и source replay. Исторический canonical inventory первоначального момента не восстанавливается задним числом.

RX-AUDIT-006: фактически использован Cursor вместо Rox; четыре наблюдаемых попытки вернули `resource_exhausted`, без ответов и tool calls. Ошибка Cursor не доказывает неисправность Rox gateway/key. Исходники показывают отсутствие применения выбранной модели перед первым prompt. Каталог и alias contract проверяются отдельно; подстановка другой модели по догадке не допускается.

## Текущая узкая реализация

RX-AUDIT-006 блокирует успешный Memory runtime сценарий. Владелец adapter/tests — отдельный исполнитель; интегратор и владелец UI/installed acceptance — root. Границы записи: OMP adapter, model routing и их regression tests. SessionManager, пользовательские provider/config и глобальный OMP default не меняются этим заданием.

Приёмка: failing first-prompt regression → минимальное исправление → подтверждённый actual model readback перед запросом → настоящая собственная Memory сессия → respawn и unavailable-model failure. Ни source test, ни сборка сами по себе не закрывают этот дефект. Остальные строки пока остаются открытыми audit findings.

Gate выбора модели и штатный OMP protocol 2 transport реализованы. Независимый review закрыл qualified suffix mismatch и проверил chunk framing в обе стороны с установленным managed OMP. Финальный полный suite: 125 PASS / 411 assertions, девять файлов; пять transport mutations обнаружены. Предыдущие неудачные прогоны при высокой системной нагрузке сохранены. Общий shared typecheck содержит 17 диагностик вне изменённых файлов и не объявлен зелёным.

Первая штатно упакованная candidate сборка сохранила семь собственных сущностей побайтно, с отдельно сохранёнными before/after копиями; workspace config изменил только `updatedAt`. Она показала реальную ошибку превышения transport limit до ответа агента. Эта неудача относится к версии до исправления protocol 2. Точное требуемое `rox/standard` отсутствовало и в managed catalog, и в проверенном публичном gateway manifest; успешный turn требует согласованного контракта и runtime регистрации, а не замены ключа или модели по догадке.

RX-AUDIT-010: компактный список `context.projects` передавался в библиотеку, ожидающую `LoadedProject.config`. Два компонента исправлены: библиотека читает полный `projectsAtom`, тип явно `LoadedProject[]`; компактный session picker сохранён. Source review прошёл; SSR не дошёл до рендера из-за Vite PDF worker import. Новая candidate сборка прошла настоящий непустой список → свой проект → сохранение description/details → создание canonical задачи с правильным projectId → Resources empty state → возврат к библиотеке. Соседний переход в собственную сессию работает. Controlled restart и принятие установленной версии остаются обязательными; они пока не выполнены.

Локальный live ledger содержит 44 узких случая / 252 assertions: 33 принятых контрольных наблюдения, девять FAIL, один INVESTIGATING и один PARTIAL. Полных экранов принято ноль. Исторический aggregate restart по первоначальной установленной версии понижен до PARTIAL: contemporaneous after hash receipt сохранён, но исходные after raw bytes не были удержаны. Поздние копии не выдаются за исторические. Отдельные подтверждённые UI readbacks сохраняют свой узкий scope. Новые retained candidate before/after snapshots относятся к своей версии и не расширяют старое доказательство.

Исправлен штатный packaging matcher: negative-only platform rules прежде включали source/scripts и старые release каталоги. Проверки config прошли на пяти platform/arch вариантах: 9 tests / 78 assertions, три mutations обнаружены. Candidate успешно упакована и проверена codesign с локальной ad-hoc подписью; это не нотарифицированная поставка. Полная новая сборка с transport и Projects исправлениями и штатная упаковка завершились успешно. Main SHA256 `04707b3621c7d8a388018b0932f3596bc5070bf79db660566e1de0f112733f69`; renderer entry SHA256 `cdc19d48826f1146aa65b0fc6fc08e517c86a665309175d90bb6426e096de2ef`. Native candidate вернула точную ошибку `Model not found: rox/standard in the OMP catalog`; собственный OMP journal не получил новый prompt. Это PASS безопасного отказа недоступной модели, а не успешного R1/Memory ответа. Установка пока не выполнена.

## Пробел нативной проверки

После перечисленных взаимодействий канал native CUA перестал инициализироваться: bound observation timeout, exact app reconnect и explicit reset/inventory вернули `-10005` Codex app-server initialization timeout. Процесс candidate продолжал работать. Это инфраструктурный пробел, не доказательство дефекта Rox. Controlled restart, восстановление только QA RSS source settings и проверка установленной версии ждут восстановления поддерживаемого native канала. Предыдущие результаты относятся к зафиксированной candidate версии; они не продвигаются в installed/restart PASS. Исторические процессы, завершившиеся с Quit AppleEvent от неизвестного отправителя, также не выдаются за управляемый перезапуск.

## Следующий доступный batch

1. Интегрировать независимо проверенные узкие Notes/Memory/Feed receipts в локальную матрицу без продвижения всего экрана в PASS.
2. Продолжить Home widgets и shared entities, Feed subscriptions/settings, Connections реальные допустимые и отрицательные сценарии.
3. Проверить controlled restart с сохранением собственных записей и без прерывания чужих заданий.
4. После исправления RX-AUDIT-006 пересобрать соответствующую поверхность и повторить затронутые native сценарии на новой версии.

RX-AUDIT-001: добавлена одна ветка перехода к note через существующий encoded Notes route. Проверка фактического callback, настоящего PersonalTaskStore и routes/parser прошла: 7 PASS / 41 assertions, включая шесть note IDs и четыре соседних link kinds. Native click/content, missing-note recovery и restart пока не проверены; эта правка не входит в candidate main04707b/renderer cdc19d и требует новой renderer сборки.

Внешние leaf gates остаются отдельными: Windows-specific durability, реальные identities/connectors, внешняя почтовая доставка, RMA E3 prerequisites. Они не становятся основанием объявить локальную функцию отсутствующей или весь этап завершённым.
