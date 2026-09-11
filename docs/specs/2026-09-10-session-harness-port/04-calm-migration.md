# H-04. Спокойная миграция: что нужно и в каком порядке

- **Doc ID:** H-04
- **Статус:** In Review
- **Дата:** 2026-09-10 (дополнено тем же днём после живого импорта DSH Desktop)
- **Наследует:** ADR-0019, H-00…H-03
- **Не заменяет:** Suite S, UEW, ADR-0001

Это операционный слой поверх карты H-01 и волн H-02. Без него легко начать «портировать плагины» и сломать Rox.

## 1. Одна формула спокойствия

```
DSH остаётся референсом UX
        │
        ▼
Rox принимает возможность как свой вклад
  Panel / Surface / Skill / Source / Automation / Status
        │
        ▼
флаг default OFF → PR → тесты + i18n×10 → ручной чеклист
        │
        ▼
включаем флаг у оператора → DSH Desktop можно не открывать для этой фичи
```

Спокойно = **каждая волна самодостаточна**. Откат = флаг OFF. DSH Desktop не удаляем, пока оператор сам не скажет, что паритет по этой волне есть.

Запрещено: «перенесём все 29 пакетов, потом включим». Это не миграция, это второй harness.

## 2. Что нужно до первой строки продукта

Иначе H1–H5 будут писать в мёртвые слоты или второй workbench.

| # | Пререквизит | Зачем | Доказательство готовности |
|---|---|---|---|
| G0 | ADR-0019 + RX-SPC-0021 приняты | Один контракт, не спор в PR | этот каталог + `RX-EPC-0001` |
| G1 | Влить `docs/specs/2026-08-25-unified-execution-workbench/` с `origin/main` | На этой ветке каталога **нет**. Терминал без UEW = третий workbench | `test -d docs/specs/2026-08-25-unified-execution-workbench` |
| G2 | Флаги `workbench.harness.*` в `packages/core/src/platform/workbench/flags.ts` + Appearance | Каждая волна выключается без реверта схемы | флаги default `false`, тест на default |
| G3 | Живой инспектор сессии | `InspectorHost` сейчас монтируется **только** при `featureUnifiedShellAtom` ON; `AppShell` держит `isRightSidebarVisible={false}`; live-секция только `info` | H1 включает колонку и при unified-shell OFF |
| G4 | Не трогать OMP как единственный агентный контур | UEW §2.1 / ADR-0019 | grep `dsh-` / `@deepseek-ai/dsh` в `apps/` `packages/` пуст |
| G5 | Импорт пишет **Rox-сессии**, не `~/.dsh` | Сегодняшний DSH-импорт доказал: scan ≠ persist ≠ list | H5 DoD: ни одного обращения к `~/.dsh` |
| G6 | i18n × 10 и `bun run rx:validate` на каждый PR | Иначе волна не мержится | CI / локальный validate |

G0 уже выполнен документами. G1–G2 — закрытие H0 перед кодом H1. G3 = H1. G5 = H5.

## 3. Хост DSH Desktop — это не плагины

Карта H-01 покрывает community-пакеты. Сам Desktop 2.0.9 ещё даёт хром хоста. Его **нельзя** тащить пакетом; строка всё равно нужна, иначе «фича DSH» всплывёт как запрос без владельца.

| Фича хоста DSH | Что это | Вердикт в Rox | Куда |
|---|---|---|---|
| Список сессий + workspace folders | `~/.dsh/sessions/` + `storages/workspace.json` | **reuse** | Craft sessions + workspace. Не копировать jsonl.zstd |
| Persistence `session.jsonl.zstd` (кадр 1 = только header) | Формат DeepSeek Harness | **skip** | Транскрипт Rox / sidecar OMP. Импорт *конвертирует в Rox*, не пишет zstd |
| Compatibility mode / Remote control | Chrome Electron Desktop | **skip** | Нет аналога; не цель |
| Slash-команды `/import` | Команды без round-trip модели | **extend** | Существующий command palette / `actions/` |
| Plugin marketplace Cordis | pnpm в `~/.dsh/profiles/desktop` | **skip** | Extension Center (H4), marketplace SHA-pin |
| Preset `danger-full-access` | YOLO sandbox | **reuse осторожно** | Rox уже `allow-all` для новых сессий. UEW PTY **MUST** нести свой `ExecutionPolicy` |
| Cookie-auth loopback `:43120` | HTTP API панели импорта | **skip** | Rox RPC, не HTTP cookie-стенка |
| Scan-cache `dsh-chat-import/scan-cache.json` | Индекс чужих чатов | **port как индекс Rox** | Кэш в workspace Rox, не `~/.dsh` |

Итог: «перенести DSH» ≠ «перенести Electron-хост». Хост остаётся референсом. В продукт идут только возможности из колонки «Куда».

## 4. Импорт чатов — отдельный жёсткий контур (H5)

Живой прогон 2026-09-10 на Desktop: скан нашёл 4652 сессии, persist не случился, пока не написали Rox-совместимый артефакт вручную. Это не баг «кнопки», это четыре разных шага.

```
discover  →  convert  →  persist Rox session  →  attach workspace  →  refresh list
  (scan)      (parser)     (craft transcript)      (не $HOME)           (индекс UI)
```

Правила, которые H5 **MUST** соблюдать (иначе снова «импорт не работает»):

1. **Scan ≠ import.** Панель показывает индекс. Сессия появляется только после persist + attach.
2. **Целевой store — Rox**, не `~/.dsh`. Ни header DSH, ни zstd-кадры.
3. **cwd `$HOME` запрещён как workspace.** Grok/Claude часто пишут cwd = домашняя папка. Attach идёт в *текущий* workspace Rox (как Documents у оператора), иначе сессия невидима в открытом списке.
4. **Идемпотентность.** Повтор того же `sourcePath` не плодит копии (skip / append / force) — семантика dsh-chat-import REQ-24, реализация first-party.
5. **Список не обязан live-обновляться.** После импорта — явное обновление индекса сессий (как в DSH docs). Не считать это багом, если есть кнопка refresh.
6. **Не импортировать 4652 сразу.** Пустые grok-сессии (0 байт history) skip. P0-форматы оператора ниже.
7. **Секреты.** Конвертер не кладёт ключи/cookies в транскрипт Rox; hit → anomaly в результате, не в git.

Приоритет форматов (по фактическому диску оператора 2026-09-10):

| Приоритет | Формат | Зачем первым |
|---|---|---|
| P0 | `grokbuild`, `claude`, `codex`, `opencode`, `hermes` | Тысячи локальных сессий, ежедневный контур |
| P1 | `cursor`, `chatgpt`, `kimi`, `pi` | Есть, меньше |
| P2 | остальные 11 из dsh-chat-import 0.11.0 | По запросу, те же интерфейсы |

DoD первой поставки импорта: **один** Claude JSONL **и** один Grok-каталог (`summary.json` + `chat_history.jsonl`) → две новые Rox-сессии в текущем workspace, без `~/.dsh`.

## 5. Порядок поставки (чтобы не мешать живому Rox)

Пользователь продолжает работать в текущем Rox. DSH Desktop остаётся запасным окном, пока волна не включена.

```
сейчас
  Rox = чат + OMP + skills/MCP/notes/notify
  DSH Desktop = референс UX (инспектор, cost, import, context)

H1  инспектор files/git/browser     ← максимальный «нравится как DSH»
H2  хром чата (история, cost, progress)
H3  context / MCP lens / fallbacks   ← зависит от слота инспектора
H4  один Extension Center            ← параллельно H2
H5  import P0 + advisor/simplify
H6  freeze skip-list
```

Параллелить безопасно: **H2 ∥ H4** после типов H1. Не параллелить H1 и H3 (оба пишут инспектор). Не смешивать импорт и инспектор в одном PR.

Каждая волна:

1. Флаг OFF в `main` / в линии оператора.
2. PR только этой волны.
3. Тест контракта из H-02 + i18n × 10.
4. Ручной чеклист на Electron (не только unit).
5. Включить флаг локально. Если больно — выключить. DSH Desktop не удалять.

## 6. Что уже не надо портировать

Это спокойствие со стороны Rox: не делать работу дважды.

| Уже в Rox | Не копировать из DSH |
|---|---|
| Paste / drag-drop ввода | `dsh-paste-input` |
| OS-notify конца хода | `dsh-notification` / session-buddy |
| Annotations | `dsh-annotation` |
| Notes + RX-DOC-0029 | `dsh-md-notes` |
| Superpowers skill pack | `superpowers-dsh` |
| Skills discovery + OMP G4 | `dsh-skills-manager` |
| Automations | `@michengai/dsh-automation` |
| Memory / self-learning specs | `dsh-mnemon` |
| Fan-out `spawn_session` | `dsh-agent-teams` |
| `browser_tool` / vision models | `modlens` как CLI |
| Exa/Tavily/Firecrawl в операторском контуре | `modsearch` как вшитый ключ |

## 7. Критерий «волна спокойна»

Волна закрыта, только если верно всё:

- Пользователь видит фичу **в Rox**, не в DSH, при флаге ON.
- Флаг OFF возвращает предыдущий UX без битых маршрутов.
- В `package.json` / `bun.lock` нет `dsh-*` / `@dsh-*` / `@deepseek-ai/dsh`.
- Нет записи в `~/.dsh` из процесса Rox.
- Новые строки — все 10 локалей.
- Для импорта: сессия в **текущем** workspace, не «негруппировано» / не `$HOME`.

Пока критерий не зелёный — DSH Desktop остаётся валидным обходным путём. Это не провал миграции.
