# Obsidian: аудит референсов и перенос поведения в ROX

Дата проверки: **30 сентября 2026**, Europe/Moscow. ROX checkout: **e953786ba7e30fb5da5dca7e88e20e324d5aebab**. Это исследование исходников и проект будущей интеграции. Плагины не установлены в ROX; UI Obsidian не проверялся. Проверены 11 запрошенных репозиториев и отдельно библиотека md-dragger. Точные ссылки, SHA и хеши лицензий: [obsidian-sources.json](../../plans/lark-suite-reference/obsidian-sources.json).

## 1. Что проверено и как читать результаты

1. Идентичность плагинов сверена с [официальным реестром Obsidian](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json). Репозитории прочитаны в изолированном каталоге /tmp/rox-lark-reference-sources. Зависимости не устанавливались.
2. SHA — HEAD репозитория на момент fetch; версия — значение manifest.json этого SHA. Это не утверждение о последнем релизном артефакте или его работоспособности на пользовательском Mac.
3. Для каждого вывода прочитаны root LICENSE, package.json и соответствующие исходники. Лицензии зависимостей, изображения, шрифты и весь релизный bundle отдельно не проверены. В этот документ перенесены поведение и ограничения; исходники/ассеты плагинов не копировались.
4. Только Ideascape получил исполняемую проверку чистого файлового формата: установленный Bun 1.4.2, команда **bun test test/map-file.test.ts**, **35 pass / 0 fail**. Остальные возможности подтверждены статическим чтением текущих исходников, не запуском UI.

## 2. Репозитории, версии, лицензии

| Референс | Manifest | Проверенный SHA | Лицензия в файле | Расхождение |
|---|---|---|---|---|
| [Ideascape](https://github.com/jonathanmcw/obsidian-ideascape) | 1.0.0; Obsidian ≥ 1.7.2 | [dd41702444cb3b87d22084036b534323f4b473e0](https://github.com/jonathanmcw/obsidian-ideascape/commit/dd41702444cb3b87d22084036b534323f4b473e0) | [MIT](https://github.com/jonathanmcw/obsidian-ideascape/blob/dd41702444cb3b87d22084036b534323f4b473e0/LICENSE) | нет наблюдаемого |
| [TaskNotes](https://github.com/callumalpass/tasknotes) | 4.13.6; Obsidian ≥ 1.12.2 | [659b9a0ae3184314f8842804505458cfe1145a3e](https://github.com/callumalpass/tasknotes/commit/659b9a0ae3184314f8842804505458cfe1145a3e) | [MIT](https://github.com/callumalpass/tasknotes/blob/659b9a0ae3184314f8842804505458cfe1145a3e/LICENSE) | нет наблюдаемого |
| [Highlightr](https://github.com/chetachiezikeuzor/Highlightr-Plugin) | 1.2.2; Obsidian ≥ 0.12.8 | [61341a464456cdc868ffa1480341136025ec8389](https://github.com/chetachiezikeuzor/Highlightr-Plugin/commit/61341a464456cdc868ffa1480341136025ec8389) | [MPL-2.0](https://github.com/chetachiezikeuzor/Highlightr-Plugin/blob/61341a464456cdc868ffa1480341136025ec8389/LICENSE) | package.json: MIT |
| [Buttons](https://github.com/shabegom/buttons) | 0.9.13; Obsidian ≥ 0.12.8 | [0fc70f37ff983353925882f0aebb51cb63e05ac6](https://github.com/shabegom/buttons/commit/0fc70f37ff983353925882f0aebb51cb63e05ac6) | [Unlicense](https://github.com/shabegom/buttons/blob/0fc70f37ff983353925882f0aebb51cb63e05ac6/LICENSE) | package.json: MIT |
| [Dragger](https://github.com/ariestar/obsidian-dragger) | 2.0.0; Obsidian ≥ 1.13.0 | [8096da6246dd58948553d34892001de3900ee5fa](https://github.com/ariestar/obsidian-dragger/commit/8096da6246dd58948553d34892001de3900ee5fa) | [MIT](https://github.com/ariestar/obsidian-dragger/blob/8096da6246dd58948553d34892001de3900ee5fa/LICENSE) | нет наблюдаемого |
| [Dynamic Views](https://github.com/churnish/dynamic-views) | 0.15.0; Obsidian ≥ 1.13.0 | [0cd0300bb4d39414ae51513191a4e31d766098de](https://github.com/churnish/dynamic-views/commit/0cd0300bb4d39414ae51513191a4e31d766098de) | [GPL-3.0-or-later](https://github.com/churnish/dynamic-views/blob/0cd0300bb4d39414ae51513191a4e31d766098de/LICENSE) | нет наблюдаемого |
| [Charted Roots](https://github.com/banisterious/obsidian-charted-roots) | 0.22.76; Obsidian ≥ 1.7.2 | [d17bc8ce8b78339bc62afde5624772769aeee2d4](https://github.com/banisterious/obsidian-charted-roots/commit/d17bc8ce8b78339bc62afde5624772769aeee2d4) | [MIT](https://github.com/banisterious/obsidian-charted-roots/blob/d17bc8ce8b78339bc62afde5624772769aeee2d4/LICENSE.md) | нет наблюдаемого |
| [Codeblock Customizer](https://github.com/mugiwara85/CodeblockCustomizer) | 1.4.7; Obsidian ≥ 0.15.0 | [a5e131dbae4c89cfc8525868620b484227dc2498](https://github.com/mugiwara85/CodeblockCustomizer/commit/a5e131dbae4c89cfc8525868620b484227dc2498) | [MIT](https://github.com/mugiwara85/CodeblockCustomizer/blob/a5e131dbae4c89cfc8525868620b484227dc2498/LICENSE) | нет наблюдаемого |
| [Day Planner](https://github.com/ivan-lednev/obsidian-day-planner) | 0.35.1; Obsidian ≥ 1.6.0 | [78672f68d2e96343c0875cd76dd4b7c442e31fd6](https://github.com/ivan-lednev/obsidian-day-planner/commit/78672f68d2e96343c0875cd76dd4b7c442e31fd6) | [MIT](https://github.com/ivan-lednev/obsidian-day-planner/blob/78672f68d2e96343c0875cd76dd4b7c442e31fd6/LICENSE) | нет наблюдаемого |
| [Markdown Tabs](https://github.com/xhuajin/obsidian-tabs) | 1.2.1; Obsidian ≥ 1.8.7 | [d6ab1814196d62aee7f071862b805b7cd58939d4](https://github.com/xhuajin/obsidian-tabs/commit/d6ab1814196d62aee7f071862b805b7cd58939d4) | [MIT](https://github.com/xhuajin/obsidian-tabs/blob/d6ab1814196d62aee7f071862b805b7cd58939d4/LICENSE) | нет наблюдаемого |
| [Notion Bases](https://github.com/bgarciamoura/obsidian-notion-bases-plugin) | 1.13.0; Obsidian ≥ 1.8.7 | [ae2dd75f21f5fee7dca382325cb48b5ce8dcdd96](https://github.com/bgarciamoura/obsidian-notion-bases-plugin/commit/ae2dd75f21f5fee7dca382325cb48b5ce8dcdd96) | [GPL-3.0; only-or-later selection not explicitly customized](https://github.com/bgarciamoura/obsidian-notion-bases-plugin/blob/ae2dd75f21f5fee7dca382325cb48b5ce8dcdd96/LICENSE) | package.json: 0-BSD |

**Три расхождения нельзя скрывать:** Highlightr: MPL 2.0 против MIT в package.json; Buttons: Unlicense против MIT; Notion Bases: GPL v3 против 0-BSD. Для Notion Bases README дополнительно объявляет GPL v3, а LICENSE содержит стандартный текст с незаполненным примером уведомления: точный выбор «только v3» / «v3 или позже» не выдумываем. Dynamic Views явно заполняет уведомление «v3 или позже», совпадающее с GPL-3.0-or-later в package.json.

**Правило реализации:** изучить UX → написать собственную спецификацию входов/выходов → реализовать на ROX API → проверить сходное полезное поведение. MIT допускает повторное использование при соблюдении условий и сохранении уведомлений; Apache 2.0, если появится в последующем аудите, требует отдельной проверки NOTICE/патентных условий; MPL относится к покрываемым файлам; GPL требует оценки условий распространения и производной работы; Unlicense не равно отсутствию прав третьих лиц. Эта классификация не даёт автоматической юридической гарантии совместимости. Наиболее простой путь для этого проекта — оригинальный код без literal copy. Для reuse сначала нужен отдельный аудит конкретных файлов и зависимостей.

## 3. Что в референсах действительно реализовано

### 3.1 Ideascape

[Формат и парсер](https://github.com/jonathanmcw/obsidian-ideascape/blob/dd41702444cb3b87d22084036b534323f4b473e0/src/organiser/model/markdown.ts): дерево в одном Markdown-файле, корень/узлы с Obsidian block IDs; геометрия, связи и оформление в скрытом comment block. MdExtras сохраняет raw frontmatter, текст до/между/после списка, trailer после геометрии, неизвестные поля geometry/look, будущую версию, BOM и CRLF. Ошибочный JSON сохраняется как rawGeometry; данные не заменяются пустой раскладкой. Старые idea-map/ideamap маркеры читаются без переименования при каждом открытии.

[Модель](https://github.com/jonathanmcw/obsidian-ideascape/blob/dd41702444cb3b87d22084036b534323f4b473e0/src/organiser/model/types.ts) и [клавиши](https://github.com/jonathanmcw/obsidian-ideascape/blob/dd41702444cb3b87d22084036b534323f4b473e0/src/organiser/ui/keys.ts): Map и Outline — представления одного документа; Tab добавляет ребёнка, Enter соседа, Shift+Tab поднимает уровень, Shift+Enter переносит строку внутри узла. Mind map и Free доступны; org chart существует в коде, но **ORG_CHART=false**, поэтому это скрытая возможность, не опубликованный обязательный UX.

[Reload](https://github.com/jonathanmcw/obsidian-ideascape/blob/dd41702444cb3b87d22084036b534323f4b473e0/src/organiser/session.ts) сбрасывает историю при внешнем чтении, обновляет нетронутый draft, а набранный draft изменившегося узла помещает поверх внешней версии как undo step. [MapView](https://github.com/jonathanmcw/obsidian-ideascape/blob/dd41702444cb3b87d22084036b534323f4b473e0/src/map-view.ts) имеет saveQueue и generation fence против позднего callback старого файла. Это не CRDT и не доказанная синхронизация нескольких пользователей. 35 тестов формата успешно исполнены; доказательства не распространяются на Obsidian UI.

**Перенос:** ROX Outliner/Mind map/Free Canvas редактируют одну страницу/Markdown. Дерево не становится отдельной базой сущностей. Подробный контракт сохранения и конфликтов — раздел 5.

### 3.2 TaskNotes

[Регистрация Bases](https://github.com/callumalpass/tasknotes/blob/659b9a0ae3184314f8842804505458cfe1145a3e/src/bases/registration.ts) добавляет Task List, Kanban, Calendar, MiniCalendar. [Создание задачи](https://github.com/callumalpass/tasknotes/blob/659b9a0ae3184314f8842804505458cfe1145a3e/src/services/task-service/TaskCreationService.ts) пишет заметку с frontmatter; [VaultMutationService](https://github.com/callumalpass/tasknotes/blob/659b9a0ae3184314f8842804505458cfe1145a3e/src/core/VaultMutationService.ts) сериализует мутации по TFile и использует Obsidian atomic process APIs. One note per task — фактическая модель, не только маркетинг. Pomodoro, time tracking, recurrence, reminder metadata, Google/Microsoft calendar services, API/webhook контроллеры существуют в текущем коде; OAuth, календарные аккаунты и напоминания на этом Mac не запускались.

**Перенос:** Tasks — существующие PersonalTask, ссылки на Notes/Page и provenance. «Задача как заметка» — импорт/экспорт и linked detail view; не второй task store. Calendar и schedule projection используют существующую модель CalendarEvent, не превращают внешние события в задачи. Timer/reminder UI подключается к общему runtime и notification delivery; наличие reminderAt в модели не является доказательством доставки уведомления.

### 3.3 Highlightr

[Генерация команд](https://github.com/chetachiezikeuzor/Highlightr-Plugin/blob/61341a464456cdc868ffa1480341136025ec8389/src/plugin/main.ts) оборачивает выделение в настроенные mark tags и удаляет mark обёртки; [меню](https://github.com/chetachiezikeuzor/Highlightr-Plugin/blob/61341a464456cdc868ffa1480341136025ec8389/src/ui/highlighterMenu.ts) показывает именованные цвета, вызывает команды. Проверенный HEAD — 2022 год; вывод о текущей совместимости делать нельзя.

**Перенос:** выделение с семантическим цветом и необязательной аннотацией. Сохранить стабильный block/range anchor и revision; при утрате текста показывать orphan annotation, не прикреплять к случайному совпадению. Plain Markdown экспорт может сохранять безопасный mark либо ==highlight== плюс sidecar с цветом, с явной потерей дополнительного оформления. Исходный HTML/css не исполнять как произвольный документ.

### 3.4 Buttons

[Codeblock entry](https://github.com/shabegom/buttons/blob/0fc70f37ff983353925882f0aebb51cb63e05ac6/src/index.ts), [command](https://github.com/shabegom/buttons/blob/0fc70f37ff983353925882f0aebb51cb63e05ac6/src/buttonTypes/command.ts), [chain](https://github.com/shabegom/buttons/blob/0fc70f37ff983353925882f0aebb51cb63e05ac6/src/buttonTypes/chain.ts): типизированные действия из Markdown, команды, URL, templates и цепочки. Command ищется по человекочитаемому имени; chain ловит ошибку и продолжает следующие действия. Это конкретное поведение референса, которое не подходит для надёжной ROX automation без адаптации.

**Перенос:** action block содержит стабильный commandId, типизированные аргументы и ожидаемые права. Click/Enter создаёт invocation с idempotency key; текущий CommandRegistry/host dispatch проверяет ACL. Цепочка имеет явную политику fail-stop/continue и журнал по шагам. Reader не получает write из-за кнопки. Markdown не предоставляет JS eval или запуск shell сам по себе.

### 3.5 Dragger и md-dragger

[Текущий adapter](https://github.com/Ariestar/obsidian-dragger/blob/8096da6246dd58948553d34892001de3900ee5fa/src/platform/codemirror/obsidian-dragger.ts) импортирует публичные md-dragger/domain, /runtime, /runtime/modules, /adapter/codemirror. Boundary test запрещает импорт внутренних dist/src. Plugin 2.0.0 зависит от **^2.0.2**; отдельно проверен [md-dragger HEAD b41a93c…](https://github.com/Ariestar/md-dragger/commit/b41a93c323b890beb5d35c6367a155d08487b498), package **2.0.3**, [MIT](https://github.com/Ariestar/md-dragger/blob/b41a93c323b890beb5d35c6367a155d08487b498/LICENSE). Npm metadata 2.0.2 также прочитана, установка не выполнялась. README Dragger всё ещё показывает старый /drag import; текущие exports важнее этого примера.

**Перенос:** drag handle, subtree move, multi-selection, visible drop seam, auto-scroll, cancellation и мобильная gesture policy. ROX редактор — Tiptap; CodeMirror extension не подключается непосредственно. Два допустимых пути: собственная Tiptap transaction либо headless DraggerRuntime с отдельным Tiptap adapter и доказанным соответствием offset/block ID. Dependency decision отложена до адаптерного прототипа и аудита его пакета.

### 3.6 Dynamic Views

Точная идентичность: **churnish/dynamic-views**, ID dynamic-views. [main.ts](https://github.com/churnish/dynamic-views/blob/0cd0300bb4d39414ae51513191a4e31d766098de/main.ts) регистрирует Bases Grid и Masonry. [Virtual scroll](https://github.com/churnish/dynamic-views/blob/0cd0300bb4d39414ae51513191a4e31d766098de/src/core/virtual-scroll.ts), card-data, image extraction, property rendering и [spatial keyboard navigation](https://github.com/churnish/dynamic-views/blob/0cd0300bb4d39414ae51513191a4e31d766098de/src/core/keyboard-nav.ts) существуют. Обнаружены старые внешние упоминания Datacore; текущий entry не регистрирует Datacore, поэтому в scope не включён как verified adapter.

**Перенос:** дополнительный Gallery renderer: Grid/Masonry, cover/poster, видимые свойства и lazy media; общий query result остаётся тем же. URL/вложение проверяется общим File/Media resolver. Renderer не вычисляет собственную ACL и не сканирует недоступные страницы ради cover.

### 3.7 Charted Roots

Существуют [GEDCOM importer](https://github.com/banisterious/obsidian-charted-roots/blob/d17bc8ce8b78339bc62afde5624772769aeee2d4/src/gedcom/gedcom-importer-v2.ts), [Gramps importer](https://github.com/banisterious/obsidian-charted-roots/blob/d17bc8ce8b78339bc62afde5624772769aeee2d4/src/gramps/gramps-importer.ts), geography MapView, FictionalDateParser и [EvidenceService](https://github.com/banisterious/obsidian-charted-roots/blob/d17bc8ce8b78339bc62afde5624772769aeee2d4/src/sources/services/evidence-service.ts) для source coverage по фактам. [Roadmap](https://github.com/banisterious/obsidian-charted-roots/blob/d17bc8ce8b78339bc62afde5624772769aeee2d4/wiki-content/Roadmap.md) прямо отмечает интерактивную pan/zoom timeline как Planning; календарь, статические и research timelines — другая уже реализованная поверхность. Deferred/Planned IRN workflow и Calendarium не считаем реализованными.

**Перенос:** необязательный evidence graph package: entity/fact/source/citation, coverage и неизвестность, geographic package: координаты/place hierarchy/map projection. Генералогия, GEDCOM/Gramps и fictional calendars — специализированные пакеты, не core Bases. Диаграмма связей не доказывает истинность факта; provenance всегда доступна.

### 3.8 Codeblock Customizer

[Entry](https://github.com/mugiwara85/CodeblockCustomizer/blob/a5e131dbae4c89cfc8525868620b484227dc2498/src/main.ts) подключает editor extensions и reading postprocessors; [Parsing](https://github.com/mugiwara85/CodeblockCustomizer/blob/a5e131dbae4c89cfc8525868620b484227dc2498/src/Parsing.ts) поддерживает fence options, labels, line highlighting; grouped code blocks/folding реализованы. ExecuteCode.ts взаимодействует с существующими run-code DOM кнопками — не универсальный безопасный runtime.

**Перенос:** filename/language header, copy, line numbers, fold и подсветка в Docs. Enter/Space на copy/fold, keyboard focus и reduced motion. Run появляется только через существующий execution broker с требуемыми правами/контекстом; статический Markdown export содержит код и параметры, не результат выполнения без provenance.

### 3.9 Day Planner

[Entry](https://github.com/ivan-lednev/obsidian-day-planner/blob/78672f68d2e96343c0875cd76dd4b7c442e31fd6/src/main.ts) имеет timeline/multi-day/time-tracker, clocks и ICS scheduler; [ViewDiff handler](https://github.com/ivan-lednev/obsidian-day-planner/blob/78672f68d2e96343c0875cd76dd4b7c442e31fd6/src/create-update-handler.ts) и [diff writer](https://github.com/ivan-lednev/obsidian-day-planner/blob/78672f68d2e96343c0875cd76dd4b7c442e31fd6/src/service/diff-writer.ts) преобразуют drag/resize в scoped Markdown edits.

**Перенос:** дневная шкала поверх PersonalTask.startAt и CalendarEvent. Существующая задача сохраняет ID после планирования; read-only ICS event остаётся read-only. Новые scheduling duration/end metadata добавляются в существующий task payload по миграции, не в скрытый второй calendar store. Timer использует общий time session record и pause/resume recovery.

### 3.10 Obsidian Tabs / Markdown Tabs

Название неоднозначно: **xhuajin/obsidian-tabs** имеет manifest **Markdown Tabs**, ID tabs, 1.2.1; это вкладки внутри документа. **gitobsidiantutorial/obsidian-tabs** — старый отдельный плагин pane management; его источник здесь не аудирован. [Entry](https://github.com/xhuajin/obsidian-tabs/blob/d6ab1814196d62aee7f071862b805b7cd58939d4/src/main.ts) регистрирует tabs fence, [Tabs](https://github.com/xhuajin/obsidian-tabs/blob/d6ab1814196d62aee7f071862b805b7cd58939d4/src/components/tabs/tabs.ts) парсит вкладки и хранит temporary cache active tab, который сбрасывается при active-leaf-change.

**Перенос:** tabs/sections block в Docs, активная вкладка как локальный preference по page/block ID; содержимое всех tabs сохраняется в общем документе и экспортируется. Не имитировать системные вкладки приложения. Tabs ARIA: tablist/tab/tabpanel, стрелки, Home/End, Enter/Space; hidden tab content не исчезает из экспорта.

### 3.11 Notion Bases

[types.ts](https://github.com/bgarciamoura/obsidian-notion-bases-plugin/blob/ae2dd75f21f5fee7dca382325cb48b5ce8dcdd96/src/types.ts) действительно содержит **7** типов view и **18** ColumnType: title/text/number/select/multiselect/date/checkbox/url/email/phone/status/formula/relation/lookup/rollup/image/audio/video. Это подтверждено кодом, независимо от README с разными счетчиками.

[DatabaseManager](https://github.com/bgarciamoura/obsidian-notion-bases-plugin/blob/ae2dd75f21f5fee7dca382325cb48b5ce8dcdd96/src/database-manager.ts) хранит config в _database.md frontmatter, данные строк — в обычных note properties. Lookup и rollup выполняются по title matching в другой folder database; это риск коллизий при переносе, поэтому ROX использует EntityRef. [Formula engine](https://github.com/bgarciamoura/obsidian-notion-bases-plugin/blob/ae2dd75f21f5fee7dca382325cb48b5ce8dcdd96/src/formula-engine.ts) — tokenizer/parser/interpreter, не просто отображение README примера. Таблица, Board/Gallery/List/Calendar/Timeline/Chart компоненты присутствуют, UI не запускался.

**Перенос:** ровно 7 core views и 18 типов в [ROX Bases design](05-rox-bases-design.md). GPL-v3 metadata conflict сохраняется; plugin engine/code не включается в ROX.

## 4. Проверенные текущие ROX seams

Все пути ниже относятся к baseline SHA; это возможность интеграции, не утверждение о готовом новом продукте.

| Слой | Путь / символ | Что есть сейчас | Требуемая доработка |
|---|---|---|---|
| Canonical entity/ref/permission/event/result | packages/core/src/rox2/platform-contract.ts: Rox2Entity, Rox2EntityRef, Rox2Relation, Rox2Event | kind включает page/note/task; workspace refs, permissions, execution/verification triad | contentKind отсутствует; добавить proposed page payload, не новую общую identity/ACL |
| Notes adapter | packages/core/src/rox2/notes-repository.ts: createNotesRepository | In-memory repository, принимает только kind=note | Не объявлять его готовым page store; явная совместимость старых note refs |
| Notes model | packages/core/src/rox2/notes-engine.ts: createNativeNotesEngine, save, parseBlocks | Required expectedRevision, sidecar revisions, HTML block markers | stampBlockMarkers нормализует целый Markdown; unsuitable для lossless tree/frontmatter |
| Реальная Notes RPC | packages/server-core/src/handlers/rpc/notes.ts: saveNote, registerNotesHandlers | Markdown на диске, optional revision check, watcher/index, properties writes | Обязательный revision для мутаций, сериализация check+write/atomic commit; patch frontmatter вместо полной пересериализации |
| Vault projection | packages/server-core/src/knowledge/vault-markdown.ts: parseVaultMarkdown; vault-index.ts | Frontmatter/wiki/block IDs/tasks/assets индексируются из Markdown | Это производный индекс; parser не lossless serializer |
| Existing views | apps/electron/src/renderer/pages/notes/note-views.ts: NoteBaseView, projectNoteRows, parseJsonCanvas | Table/base v1, 4 fixed formulas, canvas/outline/graph | Общий typed query/field registry; migration view config из localStorage |
| View host | apps/electron/src/renderer/pages/notes/NotesViewHost.tsx: NotesViewHost | Table/canvas/outline/graph; local saved views, canvas | Общий query snapshot и renderer contract, shared persisted definitions |
| Document structure | apps/electron/src/renderer/pages/notes/document-ia.ts: parseNoteDocument, extractComments, roundTripNoteMarkdown | Comments/columns/wiki/tasks/folds, helper returns raw Markdown | roundTrip helper сам по себе не доказывает Tiptap/full-save сохранение |
| Mind map | packages/core/src/mindmap/derive-note.ts: deriveNoteMindMap | Производный map из headings/backlinks | Новый list-tree edit adapter; не считать editable map уже готовым |
| Editor/renderer | packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx; Markdown.tsx | Tiptap official/legacy engines; markdown widgets/renderers | Block/range stable identity, retained raw unknown blocks, lossless export tests |
| Tasks | packages/core/src/tasks/personal/{types,store}.ts: PersonalTask, PersonalTaskStore | task source/links, parentId, checklist, recurrence, start/due/reminder fields | Field mapping и single canonical mutation; no duplicate TaskNotes store |
| Tasks persistence/RPC | packages/server-core/src/tasks/personal-persist.ts: PersonalTaskPersistStore; handlers/rpc/personal-tasks.ts | Per-task JSON, monotonic revision, changed push | PUT не имеет expectedRevision в текущей сигнатуре; shared writes требуют CAS |
| Calendar | packages/core/src/calendar/types.ts: CalendarEvent, calendarEventIdentity, MergedTodayItem | Account/calendar scoped event identity; события не Tasks | Agenda projection, timezone/date precision, scheduler integration |
| Commands/resources | packages/core/src/platform/{commands,resources}/registry.ts | Context-aware contributions + host execution/search routing | Action blocks должны вызывать существующие stable IDs и общий permission gate |
| Plugin reference bridge | packages/server-core/src/handlers/rpc/plugin-bridge.ts | SiYuan-only manifest projections/Bazaar RPC; third-party code не исполняется | Не называть Obsidian compatibility host. Новые packages на ROX capabilities |

**Исполненный ROX probe:** createNativeNotesEngine.create с YAML в начале, CRLF, block IDs, неизвестным geometry field: original bytes не равны сохранённым, начало файла становится HTML block comment, YAML уже не в позиции frontmatter. Unknown geometry text остаётся; актуальный save возвращает ok, stale revision — conflict. Это ограниченная проверка чистого engine, не NotesPage. Для настоящей Notes RPC saveNote revision optional; READ+writeFile не сериализованы одной транзакцией, UPDATE_PROPERTIES пересериализует frontmatter. Эти различия нужно закрыть до общей редактируемой Bases/UI поверхности.

## 5. Контракт одного Markdown дерева для ROX

### 5.1 Вход, представления и выход

Вход: canonical Page/legacy Note EntityRef, full original Markdown bytes, revision, разрешённые attachment refs и выбор tree region. Список — единственный источник parent/child/order/text/task state; geometry — только расположение/сворачивание/визуальные free links. Одинаковый node ID в Outliner, Mind map и Free Canvas. Переключение view меняет renderer и selection, не делает новое сохранение содержания само по себе.

Выход: bounded source patch + expectedRevision, сохранённая новая revision, source map blockId→raw span, receipt/readback, undo command. Markdown export без стороннего плагина остаётся читаемым outline; геометрия в явном versioned comment block. Предлагаемый ROX marker отличается от бренда Ideascape; импорт известных ideascape/idea-map markers допускается через форматный adapter, не через копирование parser.

### 5.2 Обязательное сохранение

1. Retained syntax tree хранит raw spans и BOM/EOL; YAML parser предоставляет typed read, а lossless YAML/CST patcher изменяет только собственные keys. Неизвестные frontmatter keys, YAML comments, style/quoting и порядок сохраняются при несвязанной tree edit.
2. Node IDs читаются из существующих Obsidian ^block-id; новые уникальны в пределах документа. Дубли IDs диагностируются; ссылки не переназначаются молча. ROX HTML block markers и Obsidian IDs имеют explicit mapping, не two independent node identity spaces.
3. Text до/между/после дерева, fenced code, HTML/Obsidian comments, math, tabs, custom checkbox states и текст после geometry сохраняются. Span ownership исключает разбор примеров списков в code/comments как реальных узлов.
4. Unknown geometry/look fields сохраняются как opaque data с ограничением размера и защитой ключей прототипа; будущая версия не понижается. Malformed geometry показывается с состоянием «Раскладка повреждена», остаётся raw; операции структуры доступны лишь если можно безопасно записать tree region, layout edit блокируется до repair.
5. Unknown blocks/actions/tabs не пересериализуются редактором в другой формат. Delete branch имеет preview subtree count, one undo и сохраняет отделённый не принадлежащий ветке текст в задокументированном anchor месте. Export показывает unsupported block report вместо потери данных.

### 5.3 Редактирование и конфликт

Первый реализуемый контракт — **CAS + operation log**, не заявленный CRDT. Запрос: entityRef, baseRevision, commandId, node/block IDs, edits и idempotencyKey. Server под общим permission gate сериализует проверку revision+write; успех возвращает committedRevision, а readback проверяет дерево и сохранившиеся opaque bytes. У каждого запроса один durable result. Late callback attachment/import проверяет page identity+generation+baseRevision перед commit.

При stale revision UI показывает «Документ изменён»: base/local/current diff, автор/время если доступны, сохранить локальную копию, выбрать merged result и повторить CAS. Автоматический rebase допустим только для независимых node fields/spans без перекрытий и с проверенным anchor; move/delete ancestor против insert/edit descendant всегда требует conflict resolution. Нет silent overwrite. Undo после external epoch применяет inverse operation к текущей revision с проверкой preconditions; не восстанавливает весь старый документ поверх чужой работы.

Поздняя realtime collaboration может использовать CRDT для стабильных block/node IDs, текста и ordered children, а scalar geometry — versioned map register. Перед включением нужно доказать convergence, cycle prevention/repair, preserve unknown spans и export/import equivalence. CRDT snapshot не второй document database; он commit/update format общего Page content service. До этой проверки UI честно показывает revision sync/conflict, без заявления simultaneous edit.

### 5.4 Interactions и состояния

| Действие | Input → output | Keyboard | Состояния и доказательство |
|---|---|---|---|
| Add child/sibling | selected node + title → source patch, retained parent/order | Tab / Enter; Shift+Enter newline | Empty, editing, saving, saved, denied; новый ID виден во всех views и Markdown после reload |
| Indent/outdent | selected sibling range → parent/order patch | Tab/Shift+Tab при structural focus; текстовый editor имеет другой контекст | Invalid parent/cycle не коммитится; keyboard и pointer дают одинаковую tree |
| Move subtree | source IDs + target parent/order → один command | Alt+arrows / menu «Переместить»; Escape cancel | Pending drop seam, invalid target, conflict; descendant/provenance/unknown spans сохраняются |
| Toggle/shape | same IDs/Markdown → new renderer/layout metadata | Explicit commands in common palette; arrows, Home/End navigate | Selection retained, no content duplication; switch+reload не меняет unrelated bytes |
| Fold/focus | node ID → per-view focus or persisted collapsed metadata | Left/Right, Enter | Hidden descendants остаются в export/query; focus не меняет ACL |
| Free link | source/target IDs → typed visual link metadata | Relation dialog reachable by keyboard | Deleted/denied endpoint скрывается; export link unresolved report, не новый task relation |
| Convert node to Task | node sourceRef + revision → existing PersonalTask + link back | Common command palette | Idempotency; same task ID in Tasks/Base/Doc; cancellation/conflict leave no orphan duplicate |
| Export | selected/full page + format → Markdown/Canvas/OPML + portability report | Menu/command Enter | Success/readback; unsupported formats list losses; attachments mapped explicitly |

## 6. Пакеты и готовность к реализации

**Core Docs/Bases/Tasks:** lossless Markdown, block actions, annotations, retained tabs/code headers, typed query/views, current Tasks/Calendar adapters. **Дополнительные packages:** dynamic media cards; geography; evidence graph; genealogy import/export; fictional time. Package получает projection/query result и typed mutation commands; не хранит зеркальный документ, не задаёт вторую ACL и не отправляет собственные уведомления.

Реализация начинается после платформенного решения о Page contentKind и явной legacy-note совместимости. Оставшиеся исследовательские ограничения: UI плагинов не проверен; 10 плагинов не запускались; license conflicts не разрешены владельцами; md-dragger Tiptap adapter не существует в ROX; realtime/ACL/aggregate и 7 новых Base renderers описаны как будущая работа. Эти ограничения входят в acceptance реализации, а не маскируются под уже готовую интеграцию.
