# Источники, исходное состояние и ограничения проверки

Проверка: 2026-09-13. Зафиксированная база `rox-one/rox-one`: [`665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899`](https://github.com/rox-one/rox-one/commit/665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899). Документы описывают желаемое поведение, если явно не указано «статически подтверждено».

## 1. Подтверждённые точки расширения

| Источник | Свидетельство | Граница вывода |
|---|---|---|
| [AGENTS.md](https://github.com/rox-one/rox-one/blob/665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899/AGENTS.md) | OMP backend, host tools, skills discovery, ROX model aliases, allow-all defaults | описание интеграции не заменяет текущий runtime тест |
| [package.json](https://github.com/rox-one/rox-one/blob/665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899/package.json) | Bun workspace, Electron ^39.2.7, typecheck/build/i18n/rx scripts | caret range не фиксирует реально установленную версию; читать lockfile при исполнении |
| [VoiceHost](https://github.com/rox-one/rox-one/blob/665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899/packages/shared/src/voice/host.ts) | `stop()` объединяет chunks и вызывает transcribe; overlay streaming=false; duration=0; hash=byteLength | статический разрыв данного пути, не доказательство отсутствия всех других voice путей |
| [Voice contracts](https://github.com/rox-one/rox-one/blob/926ce03f819332b3c55b47f798bcfbbd5dca22f3/packages/shared/src/voice/contracts.ts) | api.rox.one/v1, bootstrap/capabilities/audio-transcriptions/process, rocks-t1 | прочитано в предыдущем проходе на указанном SHA; не доказано, что endpoint сейчас живой или поддерживает streaming |
| [Rox2 contract](https://github.com/rox-one/rox-one/blob/665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899/packages/core/src/rox2/platform-contract.ts) | общие entity/event/context/result; live связан с ok; queued записан как error | нужны совместимые codecs, не второй конкурирующий контракт |
| [Soup client](https://github.com/rox-one/rox-one/blob/926ce03f819332b3c55b47f798bcfbbd5dca22f3/packages/core/src/conation/soup/client.ts) | ping/list/group read-only | прочитан на прежнем указанном SHA; права и live доступ не проверены |
| [Soup types](https://github.com/rox-one/rox-one/blob/926ce03f819332b3c55b47f798bcfbbd5dca22f3/packages/core/src/conation/soup/types.ts) | 11 типов; mutation опущены; subscription types only | комментарий об introspection 2026-09-11 — свидетельство автора файла, не наш повторный live probe |
| [DSS client](https://github.com/rox-one/rox-one/blob/926ce03f819332b3c55b47f798bcfbbd5dca22f3/packages/core/src/conation/dss/client.ts) | list/read/meta/content, нет upload/delete/move | пути записи и signing schema не подтверждены |
| [Notes bridge](https://github.com/rox-one/rox-one/blob/926ce03f819332b3c55b47f798bcfbbd5dca22f3/packages/core/src/conation/notes/bridge.ts) | getNote ограничен загруженной страницей; ACL fail closed | регрессионная задача уже существует #323; перед изменениями проверить текущий main |
| [ROX2 registry](https://github.com/rox-one/rox-one/blob/665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899/plans/rox2/registry.ts) | программа генерирует карточки из inventory и RPC files | нельзя сопоставлять карточки по цифрам; часть номеров зависит от порядка генерации |
| [Program follow-up #342](https://github.com/rox-one/rox-one/issues/342) | два реестра ROX2 и ROX-AUD; требуется содержательный crosswalk | новый RMA реестр — только delta программы, не замена обоих реестров |

Предыдущие данные не выдаются за свежую перепроверку. Каждый исполнитель получает новый exact SHA и подтверждает затронутые paths. Поисковый индекс GitHub возвращал пустые code results даже при наличии файлов; пустой поиск не использовался как доказательство отсутствия реализации.

## 2. Переиспользуемые задачи — не создавать дубликаты

| Existing issue | Что остаётся у существующего владельца | Как RMA использует результат |
|---|---|---|
| [#320](https://github.com/rox-one/rox-one/issues/320) | EntityRef/ExternalBinding, миграция идентичности | I001/I021–I027 потребляют общий seam |
| [#321](https://github.com/rox-one/rox-one/issues/321) | версионированная онтология/domain validation | I001 добавляет Meeting/Proposal/Operation к общему контракту |
| [#323](https://github.com/rox-one/rox-one/issues/323) | pagination NotesBridge | I021 не реализует второй обход |
| [#324](https://github.com/rox-one/rox-one/issues/324) | единый NoteRepository и точный origin | I011/I021 используют его, не отдельную Conation Notes копию |
| [#325](https://github.com/rox-one/rox-one/issues/325) | реальное workflow execution вместо simulated done | I018 запускает production только через проверенный executor |
| [#329](https://github.com/rox-one/rox-one/issues/329) | calendar account/occurrence identity | I026 сохраняет этот namespace |
| [#330](https://github.com/rox-one/rox-one/issues/330) | calendar revisions/conflict/revoke | I026/I027 используют те же guard/invariants |
| [#331](https://github.com/rox-one/rox-one/issues/331) | запрет fake voice production | I005 дополняет streaming, не повторяет fixture-factory исправление |
| [#332](https://github.com/rox-one/rox-one/issues/332) | канонический TaskRepository | I011 создаёт native Task через него, не через localStorage |
| [#333](https://github.com/rox-one/rox-one/issues/333) | полный доступ/API/source/license inventory Conation | I020–I027 блокируют неподтверждённые external operations |
| [#334](https://github.com/rox-one/rox-one/issues/334) | собственный Notes engine | I011/I015 работают без обязательного SiYuan |
| [#335](https://github.com/rox-one/rox-one/issues/335) | membership без копирования Session | meeting links сохраняют один объект |
| [#336](https://github.com/rox-one/rox-one/issues/336) | домены отношений/удаление/циклы | I001/I015/I022 расширяют словарь, не создают свой граф |
| [#337](https://github.com/rox-one/rox-one/issues/337) | Map/Reduce выбранного контекста | I016/I030 могут переиспользовать проверенный outcome pipeline |
| [#338](https://github.com/rox-one/rox-one/issues/338) | SurfaceContextProvider и ACL snapshots | I014 передаёт тот же контекст в live assist |
| [#339](https://github.com/rox-one/rox-one/issues/339) | temporal occurrence для календаря работы | I018/I026 связывают встречу и activity, не редактируют activity как event |
| [#340](https://github.com/rox-one/rox-one/issues/340) | основной onboarding | I002/I031 добавляют роли/готовность, не переписывают wizard |
| [#341](https://github.com/rox-one/rox-one/issues/341) | брендинг и совместимость | I013/I031 переиспользуют UI tokens/иконки, не меняют protocol IDs |

В registry crosswalk использовать `reuses`, `extends`, `independent` и exact title/path. `ROX2-012` не равно `ROX-AUD-012`. Статус GitHub issue и статус продуктовой возможности независимы; перед исполнением прочитать связанные PR и code, а не только флаг closed.

## 3. Conation — блокер с узкой областью действия

Повторный authenticated GitHub GET `https://api.github.com/repos/agisota/conation` вернул 404. Причина неизвестна: отсутствие доступа, переименование или отсутствие репозитория. Не утверждается, что репозитория не существует. Не подтверждены license, deploy dependencies, полный перечень бизнес-функций, write inputs, subscriptions, signing, migrations и hosted-service constraints.

#333 должен получить доступный exact repository/ref либо предоставленную пользователем версионированную схему вместе с разрешённым источником кода для реального переноса. До этого: native работы RMA не блокировать; code перенос, неизвестные mutations, live integration claims и заявления о полном покрытии Conation запрещены. Контрактные тесты на локальном образце разрешены только как fixture. У API adapter нет права «догадаться» о новом endpoint.

## 4. Официальные продуктовые источники

Прочитано 2026-09-13. Краткие пересказы, без копирования материалов и маркетинговых метрик.

- [Cluely](https://cluely.com/): контекст встречи, мгновенная помощь, заметки и перемещаемый overlay. Заявление производителя о незаметности не принимается как инженерная гарантия ROX.
- [Tana agentic meetings](https://tana.inc/agentic-meetings): действия во время разговора, общая память, интеграции; собственные комнаты и сторонний capture различаются.
- [Tana agents](https://tana.inc/agents): готовые сценарии подготовки, digest, feedback routing и контроля обещаний между встречами.
- [Supernormal Agents](https://help.supernormal.com/en/articles/13943209-supernormal-agents): создание рабочих артефактов по контексту встреч.
- [Supernormal Linear](https://www.supernormal.com/integrations/linear): создание/изменение issues и выбор рабочего target из разговора.
- [Fireflies real-time](https://fireflies.ai/product/real-time): живые заметки, поручения, транскрипт, вопросы, bookmarks и clips.
- [Fireflies Desktop Live Assist](https://guide.fireflies.ai/articles/2679406774-live-assist-on-the-fireflies-desktop-app-real-time-notes-and-suggestions): floating pane, ручные заметки, catch-up, `/` skills, подсказки и обзор встречи.
- [Fireflies capture modes](https://fireflies.ai/): desktop, meeting bot, imports, mobile и API как разные входы.

Это не полное инструментальное тестирование платных тарифов/регионов/платформ. Цифры точности, пользователей, языков, заявленная безопасность и сертификации не переносились в требования как доказанные свойства ROX. Для поиска использовались только указанные официальные домены; похожие сторонние домены не считаются первоисточником.

## 5. Официальные инженерные источники

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer): main-process capture, OS-различия, NSAudioCaptureUsageDescription на macOS 14.2+, риск мёртвого audio stream, ограничения PipeWire. Проверять точную версию поставляемого Electron, не считать latest docs тождественными lockfile.
- [Playwright Electron](https://playwright.dev/docs/api/class-electron): экспериментальная Electron automation через `_electron.launch`; native dialogs и security fuses требуют отдельного подхода. Это инструмент E3, не замена аппаратной приёмке.

## 6. Что сделано и что не запускалось

В этой доставке создаются проектные документы, GitHub issues и инструкции для кодовых агентов. Production код не реализуется. Source review — чтение конкретных файлов/задач через GitHub. Полный checkout в контейнер не получен: codeload DNS недоступен; Bun в контейнере отсутствует. Полный typecheck, Electron build, тесты приложения, live gateway и native media — NOT_RUN. Этот факт не означает, что CI репозитория неисправен; состояние CI здесь не выводилось из невозможности локального запуска.

Тесты документационного реестра и readback опубликованных артефактов фиксируются отдельно в README/PR. Любая будущая отметка passed обязана указывать exact SHA, команду, время, стенд и файл результата. Не закрывать implementation issues этим документационным PR.
