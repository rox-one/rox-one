# September program — handoff

## Что это

Пакет передачи требований и организации исполнения для Rox, Conation, RMA и Golden Gate на основе исходного экспорта, его аудита, текущих issues и нового запроса OKR каждого проекта. Канонический план: [docs/plan.md](../plan.md); [PRD](PRD.md), [Specs](../spec.md), [общий execution contract](execution-contract.md), [109 атомарных задач / DAG](task-registry.json), [issue index](issue-index.md). [484 исторические requirement rows](requirements-full.json) и [5 новых OKR rows](requirements-addendum.json) имеют одного primary issue-владельца каждая; [61 экран / 219 контролов](screen-control-coverage.json) сохраняют полный prior Macro planning inventory и proposal disposition. Все десять исходных промптов с общим контрактом: [ten-prompts.md](ten-prompts.md); первоначальный backlog и аддитивный OKR-запрос: [source-backlog.md](source-backlog.md). Частные overlays/история/вложения учтены отдельно: [handoff.md](handoff.md).

**Статус пакета: PUBLISHED_VERIFIED.** Все 109 issue-creation receipts наблюдались как `created`; publisher подтвердил точное совпадение удалённого содержимого 109 issues, включая titles, bodies, labels и dependency links. Это подтверждает публикацию задач, а не их исполнение: поведение продукта — `NOT STARTED`, задачи — `NOT RUN`. Исходный аудит Rox опирался на `f63294ba4fffa7238b46b24e918925a313ad0b12`; опубликованный пакет документов зафиксирован commit `e7b32c9d2b931c71aaa383546aebfbafe50aa4a6` ветки `docs/september-program-20260930`. Аудит экранов, реализация приложений и проверка на заявленных ОС остаются невыполненными; публикация issues не подтверждает текущее поведение.

## Публичная публикация

- Корневая issue программы: [PROGRAM-01 · #1157](https://github.com/rox-one/rox-one/issues/1157).
- [Публичная папка документов](https://github.com/rox-one/rox-one/tree/docs/september-program-20260930/docs/september-program), [109 задач и DAG](https://github.com/rox-one/rox-one/blob/docs/september-program-20260930/docs/september-program/task-registry.json), [issue index](https://github.com/rox-one/rox-one/blob/docs/september-program-20260930/docs/september-program/issue-index.md).
- Исходный commit опубликованного пакета: [e7b32c9d2b931c71aaa383546aebfbafe50aa4a6](https://github.com/rox-one/rox-one/commit/e7b32c9d2b931c71aaa383546aebfbafe50aa4a6) на `docs/september-program-20260930`. Финальная запись handoff/metadata будет зафиксирована отдельно; этот commit не следует считать её commit.

## Границы и правила

- Все 30 подтверждённых групп U01–U31 покрываются (U25 исключена из подтверждённых задач и оставлена отдельным вопросом). Разбиение на группы — не исчерпывающий список экранов или критериев.
- Private transcripts, attachments, personal messages, local patches, paths, secrets and infrastructure details are excluded from public issues. Private source coordinates and raw source exports are not linked or reproduced. Public traceability uses `Uxx`/`seqNNN`, existing issue URLs and safe requirement/spec/plan documents.
- Исходный seq и U-номера сохранять как точные координаты происхождения требований, не цитируя закрытый текст. `requested`, `verification-gap`, `proposal-audit`, `decision-reconciliation` не смешивать.
- Existing RMA/GG/Conation issues остаются primary implementations; September cards ограничены своими residual/audit/acceptance задачами. CALLS-01 отвечает только за #382 binding, RMA-03 — за acceptance существующего #389, без второго media writer. Ни closed status, ни наличие новой карточки не означают автоматического reopen/close старых issues.
- Один владелец/интегратор контролирует общие registry/route IDs, RPC/schema, локали/catalogs, lockfiles и общие UI primitives. Domain-потоки не редактируют эти файлы напрямую и не меняют сигнатуру интерфейса самостоятельно.
- Донор Conation — отдельный репозиторий. Повторное использование должно проходить проверку лицензии/прав и provenance; корень Macro имеет AGPL/зарезервированные права веб-части. Не копировать код без разрешённого правового основания.
- Mail для локального Stalwart `@rox.one` и внешний production mail — разные acceptance. Локальная loopback-проверка не доказывает интернет-доставку; MX не менять автоматически. Meeting Whisper не является ответом о модели STT обычной сессии; microphone-only не даёт согласия на system audio.
- Не добавлять U25 default-переключение без независимого надёжного основания. Не добавлять Zed importer, Liquid Glass, bot-suggested extras или проект типа arena/council как обязательные работы.

## Источники и текущие пробелы

Источники требований сведены из исторического экспорта, аудита, существующих issues, исходных промптов и исследовательских заметок по коду/issues. Полный реестр источников приватен; публичный пакет содержит только безопасные source refs и выводы без raw prompt-текста. Ключевые расхождения: #385 E3 по-прежнему не доказана merge'ем #991; #387 остаётся на hold до реального prerequisite; Golden Gate #541 включает 25 child issues (#553, #555–#578), поэтому нельзя считать диапазон 553–578 полным непротиворечивым набором; локали сообщены как 10 и 12, требуется решение по фактическому issue/current behavior; #389 установлен как media SFU/rooms/screenshare/reconnect/s…

Найдена отдельная, продолжающая обновляться read-only реконструкция источников: исторический seed 484 rows/30 confirmed U groups, действующие ownership/task packets и screen-case preparation. Её pinned private copies сохранены отдельно; source `current_user_stage` относится к другому контексту, не является новым полномочием реализовать весь backlog. До запуска продуктового потока RECON переиспользует эти артефакты и сверяет действующего владельца, чтобы не создать второй аудит или конкурирующую программу.

## Переход к исполнению

Порядок плана: RECON-01 → AUDIT-01 → владелец общих интерфейсов → независимые bounded streams → последовательная интеграция → RELEASE-01 реальная acceptance. Все инструменты/окружения, cloud доступы, ключи, права и сырые источники сначала подтверждаются безопасной инвентаризацией. Для Linux/cloud, Mac native, Windows native и отдельно native iOS Sharing Conation требуются собственные наблюдения: отсутствие среды/учётных данных маркируется BLOCKED/UNVERIFIED, а не заменяется smoke на другой ОС или заявлением о будущем provisioning. OKR-02 требует реально исполненного ежедневного worker/check-in и наблюдаемого уведомления; публикация задач не запускает такой мониторинг.
