# Локальные срезы product-security — 2026-08-13, продолжение

Нет APPLY. Нет Gate 0. Нет переключения по умолчанию на `~/ROX`.

## `migrateNotes` — LOCAL_ONLY

`knowledge:migrateNotes` импортирует хранилище хоста в локальные Notes. Он больше не `REMOTE_ELIGIBLE`.

- `packages/shared/src/protocol/routing.ts`
- test: `knowledge P4.4 migrateNotes is LOCAL_ONLY`

## OwnedRootPolicy (частично)

| Экспорт | Роль |
|---|---|
| `getConfigDir()` | Разрешается после загрузки; тесты внедряют `setOwnedRootAdapter` |
| `CONFIG_DIR` | Заранее вычисленный снимок, сохранён для существующих импортёров |
| `assertNotesImportPaths` | Относительные источник/назначение отклоняются до импорта |

Состояние owned по умолчанию остаётся `~/.craft-agent`. Его изменение на `~/ROX` по-прежнему требует выбора владельца.

`importNotes()` вызывает `assertNotesImportPaths` до работы с форматом и файловой системой.

## Соединения CF-5 WorkGraph (частично)

Схема v2 хранит Connection + привязки без колонок полезной нагрузки. `revokeConnectionAndRevalidate` аннулирует аренды брокера, отзывает копию провайдера, добавляет строку реестра `connection-revoked`, содержащую только метаданные, а затем повторно валидирует только это рабочее пространство.

```text
bun test packages/server-core/src/workgraph
# 18 pass / 0 fail
```

## CF-5 / CF-6.1

Соединения CF-5 WorkGraph, привязки, неизменяемый аудит, замыкание в области рабочего пространства и отзыв/ревалидация уже в дереве исходников. CF-6.1 добавляет LOCAL_ONLY RPC list/get/create. CF-6.2 включает боковую панель Connections в Workbench, маршрут и нативную страницу с вкладками. CF-6.3 выводит метаданные через `workgraph.listConnections` и отклоняет секретные поля. CF-7.1 импортирует `GH_TOKEN`/`GITHUB_TOKEN`, брокирует запрос GitHub `/user` внутри `perform`, после чего revoke уничтожает неиспользуемые аренды. CF-7.2 предпросматривает/импортирует эти токены со вкладки Imports в Connections. CF-9.2 делает то же самое для локального пути gitconfig-хелпера. CF-7.3 отзывает соединение из списка после подтверждения. Тесты внедряют `fetch`/заглушку хелпера; они не обращаются к api.github.com и не запускают git. Устаревший AppShell `links[]` остаётся без изменений.

## CF-4 брокер (частично)

CF-4.1 внутрипроцессный брокер + CF-4.2 хранилище грантов / восстановление / реестр доставки. По-прежнему нет RPC, WorkGraph или бинарников хелпера.

| Поверхность | Роль |
|---|---|
| `InProcessCredentialBroker` | аренды с запретом по умолчанию; `perform` один раз; аудит метаданных |
| `JsonAccessGrantStore` | файл гранта, содержащий только метаданные; при секретных полях — отказ (fail closed) |
| `selectDeliveryMechanism` | выбор с минимальным раскрытием; только opt-in для `env-legacy` |
| `revalidateConsumer` | `ok` / `denied` / `repair_required` |

## Проверка

```text
bun test packages/shared/src/protocol/__tests__/routing.test.ts
         packages/shared/src/config/__tests__/owned-root-policy.test.ts
         packages/server-core/src/knowledge/__tests__/notes-migration.test.ts
# 29 pass / 0 fail

bun test packages/shared/src/credentials
# 40 pass / 0 fail
cd packages/shared && bun run tsc --noEmit
```
