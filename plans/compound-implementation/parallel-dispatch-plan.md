# ROX compound workspace — план оставшихся работ и параллельного запуска

Источник данных: `plans/compound-implementation/progress.json` (143 пакета), `plans/macro-integration/work-packages.json` (52),
`plans/lark-suite-reference/work-packages.json` (46 + 15 в `code-intelligence.json`), `docs/rox-suite/published/RS-*.md` (30).
Состояние зафиксировано на ветке `feat/rox-compound-workspace-20260930`, HEAD `b922e52e`.

## 0. Итог в числах

| Показатель | Значение |
|---|---|
| Всего пакетов | 143 |
| В работе | 6 |
| Не начато | 137 |
| Уровней зависимости | 15 (L0…L14) |
| Длина критического пути | 15 пакетов |
| Разблокирует транзитивно | `LSX-WP-001` → 52, `WP-01` → 50, `WP-02` → 49, `WP-03` → 48 |

Критический путь программы:

```
WP-01 → WP-02 → WP-03 → WP-04 → WP-08 → WP-09 → WP-11 → WP-12
      → WP-31 → WP-32 → WP-33 → WP-34 → WP-38 → WP-41 → WP-46
```

Вывод: identity-цепочка WP-01…WP-04 — единственный путь, который нельзя распараллелить.
Всё остальное — широкие веера. Стартовать надо с `WP-01` и с изолированных пакетов без зависимостей.

## 1. Правила параллелизма (обязательны до запуска)

`shared_file_ownership` в `plans/lark-suite-reference/work-packages.json` отводит **31 общий путь**
одному `integration-owner` с `writer_count: 1`. Это не формальность: без сериализации агенты будут
затирать друг друга.

1. **Воркер пишет только свои новые файлы** (`proposed_new_files` / `newFiles` из спецификации пакета).
2. **Патч в существующий общий файл** оформляется как запрос интеграции, применяется интегратором
   последовательно, в порядке зависимостей.
3. Самые горячие точки (несколько пакетов на один файл):
   `packages/server-core/src/handlers/rpc/notes.ts` (5), `apps/electron/src/renderer/pages/NotesPage.tsx` (5),
   `packages/server-core/src/tasks/personal-tasks-service.ts` (2), `packages/core/src/rox2/platform-contract.ts` (2),
   `packages/core/src/types/page.ts` (2), `packages/core/src/rox2/notes-repository.ts` (2),
   `packages/core/src/rox2/notes-engine.ts` (2), `packages/server-core/src/handlers/rpc/personal-tasks.ts` (2).
4. Точка навигации `apps/electron/src/renderer/components/app-shell/nav-destinations.ts` — общая для
   всех новых suite-destinations (RS-MSG, RS-MTG, RS-DRV, RS-ADM). Правки сериализуются одним владельцем.
5. `packages/shared/src/protocol/channels.ts`, `routing.ts`, `dto.ts`, `types.ts` сейчас **незакоммичены**
   волной 0. До её коммита новые RPC-каналы вводить нельзя — сначала коммит, потом каналы.

## 2. Волна 0 — закрыть (6 пакетов, всё написано, нужен финал)

| Пакет | Статус | Что осталось |
|---|---|---|
| `LSX-WP-001` Page content descriptor | ROOT_INTEGRATION | коммит; проставить статус в `progress.json` |
| `LSX-WP-003` Атомарная запись Markdown | ROOT_INTEGRATION | коммит |
| `LSX-WP-005` Lossless Markdown/YAML patch | WORKER_IMPLEMENTING | довести property dictionary до сохранения свойств Notes |
| `LSX-WP-006` Stable block/node anchors | WORKER_IMPLEMENTING | дописать, зависит от LSX-WP-005 |
| `CI-001` Repository binding и снимки | WORKER_INTEGRATING | финальная интеграция панели в Assets |
| `RS-FOCUS-01` Focus-индикатор быстрого ввода | WORKER_VERIFYING | визуальная приёмка в Electron |

Проверки, которые нужно повторить перед коммитом (уже зелёные, но не зафиксированы в git):

```bash
bun run --cwd apps/electron build:main      # 51.5 MB
bun run --cwd apps/electron build:preload   # 15.5 MB
bun run --cwd apps/electron build:renderer
bun test tests/lark-suite-extension/lsx-wp-001.test.ts \
        tests/lark-suite-extension/lsx-wp-003.test.ts \
        tests/lark-suite-extension/lsx-wp-005.test.ts \
        tests/lark-suite-extension/lsx-wp-006.test.ts \
        tests/lark-suite-extension/property-dictionary.test.ts \
        tests/lark-suite-extension/content-rpc.test.ts \
        tests/lark-suite-extension/content-source-boundary.test.ts \
        tests/lark-suite-extension/ci-001-rpc.test.ts \
        packages/shared/src/code-intelligence/__tests__/contracts.test.ts
# ожидается 127 pass / 0 fail
python3 plans/compound-implementation/prepare-dispatch.py --self-test
git diff --check
```

Известный флак: `LSX-WP-001 … unknown future and malformed descriptor bytes` упирается в таймаут 5000 мс
под параллельным прогоном. В изоляции проходит. Если снова — прогнать этот файл отдельно, а не чинить код.

Затем одним коммитом: 44 изменённых пути + `progress.json` со статусами в трёх категориях
(готовый механизм / проверенный UI / полный DoD) — по формулировке последнего сообщения агента.

**Важно про коммит:** «44 изменённых пути» из `git status` — это только отслеживаемые файлы.
Каталог `plans/compound-implementation/` не отслеживается вообще (`git ls-files` по нему даёт 0,
при этом он не в `.gitignore`). В нём лежат `progress.json`, `prepare-dispatch.py`,
`typecheck-baseline.json`, `runtime-discovery.json` и этот план. Без их добавления коммит
фиксирует код, но теряет состояние программы. Проверено: `git check-ignore` молчит,
`git add -A` подхватит каталог целиком.

## 3. Волна 1 — стартовать параллельно сейчас (7 пакетов, зависимостей нет)

Запускать одновременно, отдельным агентом на пакет. Конфликтов по файлам между ними нет,
кроме навигационного реестра (п. 1.4).

| # | Пакет | Роль | Размер | Суть |
|---|---|---|---|---|
| 1 | `WP-01` | identity-implementation | **XL** | Private shared Project: A открывает, B без членства получает 403 и не видит заголовок; клиент не может подделать principal/workspace |
| 2 | `WP-48` | commands-implementation | L | SBOM и code-origin gate: lock-pinned перечень, конфликты root/web помечены, копирование файла запрещено без решения |
| 3 | `RS-ADM-01` | suite | — | Organization и capability Admin Hub в существующих Settings |
| 4 | `RS-AUT-01` | suite | — | Automations: визуальный canvas с palette, ports и inspector поверх существующего graph editor |
| 5 | `RS-DRV-01` | suite | — | Docs/Drive: единая библиотека Recent, Owned, Shared, Favorites, table/grid поверх `PagesHome` |
| 6 | `RS-MSG-01` | suite | — | Messenger: трёхпанельная human-поверхность; ChannelRef общий с Project→Channels, Sessions остаются агентскими |
| 7 | `RS-MTG-01` | suite | — | Meetings landing: action tiles + история, локальная запись сохранена, без имитации работающего SFU |

`WP-01` — приоритет №1: он один разблокирует 50 пакетов и стоит в начале критического пути.
`WP-48` и пакеты suite к identity не привязаны и идут свободным концом.

## 4. Волна 2 — стартовать сразу после коммита волны 0 (4 пакета)

| Пакет | Зависит от | Суть |
|---|---|---|
| `CI-002` | `CI-001` | Repository scope, exclusion и egress policy |
| `LSX-WP-002` | `LSX-WP-001` | Личные Task source bindings и изолированный picker |
| `LSX-WP-007` | `LSX-WP-001` | Сохраняемая BaseDefinition и private/shared views |
| `LSX-WP-026` | `LSX-WP-003/005/006` | Existing Tiptap binding, durable draft и history restore |

`LSX-WP-002` и `LSX-WP-007` оба бьют в `packages/core/src/rox2/platform-contract.ts` — отдать
интегратору, не двум воркерам сразу.

## 5. Дальнейшие волны (разблокируются по мере закрытия)

| Уровень | Пакетов | Состав |
|---|---|---|
| L2 | 13 | `CI-003`, `CI-004`, `CI-005`, `LSX-WP-004`, `LSX-WP-011`, `WP-03`, `RS-APR-02`, `RS-AUT-02`, `RS-DOC-01`, `RS-FORM-01`, `RS-MSG-03`, `RS-SIG-01` |
| L3 | 15 | `CI-006`, `CI-007`, `CI-009`, `LSX-WP-009`, `LSX-WP-040`, `WP-04`, `WP-49`, `RS-AUT-03`, `RS-HD-01`, `RS-NOTE-01`, `RS-SHEET-01`, `RS-SIG-02`, `RS-SLIDE-01`, `RS-WIKI-01` |
| L4 | 11 | — |
| L5 | 19 | — |
| L6 | 18 | — |
| L7 | 15 | — |
| L8 | 16 | — |
| L9 | 5 | — |
| L10 | 3 | — |
| L11–L14 | 5 | хвост критического пути, включая `WP-46` |

L4…L14 не расписаны поимённо сознательно: они не стартуют раньше своего уровня, а состав
уточняется по мере реальных коммитов. Разворачивать их в агенты заранее — выдавать работу
по бумажным зависимостям.

## 6. Раскладка по слотам

| Слот | Роль | Что делает |
|---|---|---|
| 1 | integration-owner | коммит волны 0, лезы на 31 общий путь, применение запросов на патчи |
| 2 | worker `WP-01` | identity, XL, разблокирует половину программы |
| 3 | worker `WP-48` | SBOM и лицензии, изолирован |
| 4 | worker `RS-ADM-01` | Admin Hub |
| 5 | worker `RS-AUT-01` | canvas автоматизаций |
| 6 | worker `RS-DRV-01` | Docs/Drive библиотека |
| 7 | worker `RS-MSG-01` | Messenger |
| 8 | worker `RS-MTG-01` | Meetings landing |

Минимум для параллельной работы — 8 слотов. Узкое место не в количестве агентов, а в
`integration-owner`: всё, что проходит через 31 общий путь, встаёт в очередь к нему.

## 7. Блокеры среды

`prepare-dispatch.py` в текущем состоянии отдаёт `readyForSubmission: false`, `unresolvedGates: 139`:
lead не передал реальные команды приёмки. До этого долгоживущий runner не запускается — приёмочные команды
должны быть настоящими критериями Harness, а не проверкой существования файла. Это решение lead,
а не воркеров, и оно блокирует автоматический запуск, но не ручную работу по пакетам выше.
