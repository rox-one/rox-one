# 04 — Роли, OMP-агенты, скиллы, контракты диспатча и возврата, harness v2

Этот файл отвечает на четыре вопроса: **кого** запускать (роли и их OMP-агенты), **с каким скиллом**,
**как** передать задачу субагенту и **как** принять её результат по evidence. Точные команды —
в `06-runbook.md`; рубрика гейтов — в `03-dod-gates.md`; сквозной поток — в `00-orchestrator.md`.
Глубокие справочники (по ним не изобретаем своё): `~/.agents/runtime/playbooks/autonomy-team-method.md`
(контракты и выбор рантайма), `~/.agents/runtime/playbooks/orchestration.md` (граф задач и расписание),
`~/.agents/runtime/playbooks/harness-v2.md` (durable-запуски, журнал, квитанции).

Все имена скиллов ниже **проверены** наличием в `~/.agents/skills/<name>` и/или в каталоге репозитория
`apps/electron/resources/skills/REQUESTED-SKILLS.json`. Если скилл не подтверждён — он помечен
`проверить установку` и не считается доступным до фактической проверки.

## 1. Ростер ролей

Одна роль — один владелец области. Роль можно переиспользовать (тот же воркер с полезным контекстом),
но **один писатель на файл/область** в один момент времени.

| Роль | OMP-агент | Владеет (owns) | Обязательные скиллы | Вход → Выход | Когда спавнить |
|---|---|---|---|---|---|
| **Lead orchestrator** | `main` (ты) | Интеграция, `main`, финальный commit/push, отчёт | `dispatching-parallel-agents`, `using-git-worktrees`, `writing-plans`, `executing-plans`, `code-review`, `verification-before-completion` | PRD/SPEC/план → интегрированный результат + отчёт | Всегда; держит критический путь и не перекладывает координацию на человека |
| **Scout** | `scout` (read-only) | Ничего не пишет; область исследования | `systematic-debugging`, `codebase-design`, `exploration-strategy` | Вопрос об области → факты со ссылками на пути (call sites, контракты, seams) | Незнакомый код, неясное поведение, конфликтующие факты — **первая делегация по умолчанию** |
| **PRD writer** | `task` | `plans/<program>/PRD.md` (или PRD-артефакт) | `brainstorming`, `writing-plans`, `prd` | Задача → PRD с номерованными acceptance, non-goals, метриками | До SPEC; владелец задачи фиксирует «что и зачем» |
| **SPEC writer** | `task` | `plans/<program>/SPEC.md`, `docs/specs/**` | `writing-plans`, `codebase-design`, `improve-codebase-architecture`, `api-and-interface-design` | PRD → решение, контракты данных/API, seams, карта файлов, rollback, out-of-scope | После PRD, до волн; в спеке не остаётся решений исполнителю |
| **Implementer (per slice)** | `task` | Свой slice-каталог/файлы | `test-driven-development`, `implement`, `react-best-practices` (UI), `safe-refactor` (prefactor) | SPEC + dispatch packet → рабочий код + RED-first тесты | Один на вертикальный слайс; работает в своём worktree |
| **Test author** | `task` (ограниченный child) | Только тестовые файлы слайса | `test-driven-development`, `unit-test-author`, `react-testing` (UI), `property-based-testing` (инварианты), `e2e-testing` (сквозные) | Контракт + seam → failing-сначала тесты, затем зелёные | Когда тест — отдельный деливерабл (property/E2E/concurrency) |
| **Reviewer** | `reviewer` (fresh context) | Ничего; выдаёт verdict | `code-review`, `requesting-code-review`, `code-simplification`, `verification-discipline` | acceptance + артефакты (из источника) → «принято»/«отклонено» с пунктами | Каждый смерженный слайс до интеграции; независимый контекст |
| **Adversary** | `task`/`reviewer` (adversarial framing) | Ничего; ломает заявления | `systematic-debugging`, `scientific-method`, `threat-modeler` (для границ) | Артефакт + заявление («bounded failure») → воспроизведённая дыра или чисто | Обязателен на рискованных путях: auth, HTML/escape, данные, деньги, «bounded failure» |
| **Security reviewer** | `security-reviewer` | Ничего; security-вердикт | `secure-code-review`, `security-review`, `secrets-manager`, `threat-modeler` | Изменение чувствительного пути → закрытые дыры, остаточный риск, OPS-чеклист | Триггеры: auth/OAuth-callback, HTML-генерация, secrets, файловые/сетевые границы, права |
| **Release captain** | `task` | Ветка релиза/деплой-конфиг, `main`-merge | `release-day`, `ship`, `ci-fix-loop`, `iterate-pr`, `git-workflow`, `docker-patterns` (сервер) | Зелёный PR → merged + деплой + живой smoke | Фаза Ship/Deploy; OPS с прод-доступом (Cloudflare/R2) — **человеку** |
| **Scribe/reporter** | `task`/`sonic` | Отчёт, decision record, changelog | `technical-deslop`, `writing-plans` (ADR), `code-simplification` | Артефакты волн → Execution matrix, Before/After, blockers | В конце волны/программы и при значимом решении |
| **Sonic (механические правки)** | `sonic` | Массовые механические области | `technical-deslop`, `safe-refactor`, `react-best-practices` (i18n-строки) | Codemod/rename/i18n-ключ/формат → пакет мелких правок | Когда правка широкая, но тривиальная и проверяемая diff'ом |

> **Effort.** `scout` по умолчанию идёт на `medium`; воркер-политика (`rox-worker-policy.js`) поднимает
> thinking до максимума модели для родителя/детей. Не выдумывай флаги уровня «ultrathink» — это интент,
> а не гарантированный флаг CLI (`~/.agents/runtime/playbooks/autonomy-team-method.md`).

## 2. Карта «тип задачи → узкий скилл» (паттерн)

Скилл — не украшение, а обязательный вход: **прочитать скилл → назвать его субагенту → implement → test → verify → structured result**.
Соответствие типов задач скиллам (по мотивам `plans/next-program-prompt.md`, где была карта тикет→скилл):

| Тип задачи | Скилл(ы) |
|---|---|
| Lead / оркестрация, review-gate | `dispatching-parallel-agents`, `using-git-worktrees`, `code-review`, `verification-before-completion` |
| Credential/first-run путь, bounded failure | `systematic-debugging`, `test-driven-development` |
| HTML-генерация / escape / XSS | `test-driven-development` + security-review |
| Байты, `nosniff`, conditional put (viewer) | `threat-modeler`, `test-driven-development` |
| Один JSON как источник истины (defaults) | `test-driven-development` |
| Монтаж существующей панели (UI) | `implement`, `react-best-practices` |
| Secrets UI (refs, не значения) | `implement` + `secrets-manager`, `secure-code-review` |
| Identity expand / migration | `writing-plans`, `database-migrations` (если данные) |
| Разрезание god-модуля (seams) | `improve-codebase-architecture`, `codebase-design`, `safe-refactor` |
| Протокольные DTO (один владелец) | `writing-plans`, `api-and-interface-design` |
| Live E2E (только с живым ключом) | `verification-before-completion`, `e2e-testing` |
| Решение/ADR (не код) | `writing-plans` |
| Релиз / CI-покраснение | `release-day`, `ship`, `ci-fix-loop`, `iterate-pr`, `wrap-up` |

## 3. Параллелизм и волны

- **Один писатель на область.** Один файл/каталог — один владелец. Два тикета на один файл — в очередь,
  а не параллельно. Общие DTO — один владелец, остальные присылают proposal патча.
- **Worktree на слайс.** Каждый писатель — своя ветка/worktree `~/Projects/rox-worktrees/<slug>` от свежего
  `origin/main`; один слайс — одна ветка — один PR (кандидат на самостоятельный откат).
- **≤ 8 параллельных писателей по умолчанию.** Это дефолт, а не догма: реальную ёмкость проверяй по
  состоянию рантайма. Независимые задачи берут слоты, остальное — в очередь; при освобождении слота
  запускается следующий готовый узел.
- **Волновая схема.** Prefactor первым (**WAVE 0**) — иначе фичи сериализуются на общий модуль.

```
WAVE 0  prefactor / extract (разрезать god-модуль, ввести seam)
WAVE 1  независимые вертикальные слайсы — параллельно
WAVE 2  зависимые (expand–contract, protocol DTO — после своего владельца)
WAVE 3  reviewers / adversary / security | live E2E | decision records
```

- **Очередь при переполнении.** Роли в очереди не «висят»: lead держит критический путь и запускает
  следующий готовый узел сам. Полная команда не перекладывает координацию на пользователя.
- **Nesting.** Вложенная делегация — только при поддержке рантайма. Нет слотов/глубины — lead планирует
  ту же работу как sibling-задачи. Не увеличивай нестабильную настройку вложенности ради лишнего уровня.
- **Ревизия графа.** Новое свидетельство (новая задача, неверное предположение) → перепланирование и
  исполнение, **не** approval-церемония.

## 4. Контракт диспатча (packet)

Упрощённая форма пакета (полная проверенная схема — `harness.contracts.dispatch_packet`, поля
`schema_version/request_id/contract_hash/attempt_id/capability_snapshot/packet_hash` и т. д. — в
`~/.agents/runtime/playbooks/autonomy-team-method.md` §«Plan and dispatch»; не изобретай расходящуюся схему):

```json
{
  "objective": "одно наблюдаемое назначенное состояние",
  "scope": { "root": "/абсолютный/checkout", "allowed_operations": ["read", "write-artifact"] },
  "owned_paths": ["пакет/путь"],
  "acceptance": ["наблюдаемое ожидаемое состояние"],
  "verification_commands": ["bun test <пути>", "bun run tsc --noEmit"],
  "depends_on": ["id принятого предшественника"]
}
```

Правила диспатча:

- **Проверь absolute checkout root и ветку до диспатча.** Реализатор до первой правки сверяет
  `git rev-parse --show-toplevel` с назначенным деревом; несовпадение = искать своё дерево, а не править текущее.
- **Только релевантный контекст.** Передавай нужную часть скилла, evidence интерфейса/входа и факты —
  не весь транскрипт. Исследовательским воркерам: возвращать evidence, а не править общий код.
- **Один writer на область.** Чужие незакоммиченные изменения не поглощаются; sibling-checkout не трогается.
- **Tool/skill/command сверяются с текущей способностью**, а не по памяти. Отсутствующая способность —
  это prerequisite или поддерживаемый эквивалент, а не выдуманный вызов.

## 5. Контракт возврата

Каждый субагент возвращает **структурированный статус-блок** (апгрейд блока из `plans/next-program-prompt.md`:
добавлены `ARTIFACTS` и `EVIDENCE`). Ответ без evidence недостаточен.

```
STATUS: DONE | DONE-WITH-GAPS | BLOCKED
ROOT CAUSE: <для багфикса/диагностики; иначе n/a>
SKILL(S) USED: <проверенные имена + квитанция применения>
FILES CHANGED: <путь (+/-), привязка к ревизии SHA>
IMPLEMENTATION: <что и почему, одним абзацем>
TESTS ADDED: <путь::имя теста>
TESTS RUN: <команда → результат (счётчик/лог), SHA>
RUNTIME VERIFICATION: <команда/скриншот → наблюдаемый результат, SHA>
ARTIFACTS: [{ "path": "...", "sha256": "..." }]
EVIDENCE: [{ "command": "...", "key_output": "..." }]
RISKS: <остаточный риск>
REMAINING GAPS: <что не закрыто>
COMMIT(S): <sha + ветка>
```

Формат остановки — канонический (`06-runbook.md` §9): `STATUS: BLOCKED` / `MISSING` / `TRIED` / `EVIDENCE` / `NEXT` / `UNBLOCKED-WORK`.

**Правила приёмки (lead):**

- **Проверь артефакты до приёмки.** Считай `sha256` из выданных файлов и сверь с `ARTIFACTS`;
  «accepted»-булево не является доказательством. `EVIDENCE` проверяется по факту (реальный bytes/значение/запуск).
- **Истина — из источника, а не из отчёта продюсера.** Lead запускает фактически изменённое поведение,
  релевантные падения, перезагрузку/персистентность, конкуренцию/восстановление.
- **Отклоняй несовпадающие квитанции даже при заявленном успехе.** Несовпадение SHA/ревизии/области —
  отклонение, а не «примем потом». Фиксируй класс ошибки и остаточные prerequisites.
- **`verification_commands` из packet'а** — обязательный минимум повторной проверки на интегрированной ревизии.

## 6. Независимость ревью

> Reviewer получает acceptance и артефакты, **истина отделена от заявленного продюсером pass**
> (*«a reviewer receives acceptance and artifacts, with source truth separate from the producer's claimed pass»*).

- Reviewer стартует с **чистым контекстом**: не наследует уверенность автора, сам воспроизводит находки.
- Adversary — на всё, что заявляет «bounded failure», безопасность, деньги, данные: он ищет контрпример,
  а не подтверждение.
- Security reviewer (OMP `security-reviewer`) — отдельно от code-reviewer: разные триггеры, разные выходы.
- Отклонено → в работу с конкретными пунктами, не «оставим как есть». Негативный контроль должен ломать
  сломанный артефакт (иначе оракул не различает pass/fail).

## 7. harness v2 — durable-запуски

**Когда in-session OMP, а когда durable harness:**

| Ситуация | Рантайм |
|---|---|
| Интерактивная независимая работа в текущей сессии | OMP-субагент (`task`/`scout`/`reviewer`/`security-reviewer`/`sonic`) |
| Исполнение **должно пережить** этот процесс (рестарт/долгая задача) | harness v2 (`~/.local/bin/harness` → `~/.agents/runtime/harnessctl.py`) |
| Управляемая изоляция кодового воркера / resumable-сессия | внешний CLI/ACP — по `autonomy-tool-recipes` |

Команды (полная модель — `~/.agents/runtime/playbooks/harness-v2.md`):

```bash
harness status --summary                    # фактические heartbeat/задачи/сбор
harness context '<цель>'                    # релевантная память с источниками
harness request '<цель и наблюдаемая приёмка>' --cwd '<repo>'   # durable-запрос (plan.json + DAG)
harness request '<цель>' --cwd '<repo>' --mode execute          # режимы: recommend | inspect | execute
harness request-retry <ID>                  # повтор с сохранением ID (другого содержимого — ошибка)
harness submit --file <plan.json>           # точный DAG (id/objective/cwd/argv/depends_on/owned_paths/criteria)
harness tasks --id <ID>                     # статус, попытки, ошибки, пути доказательств
harness cancel <ID>                         # остановить узел и потомков
harness session --client omp --native-id <id> --cwd '<repo>'    # регистрация native-сессии
harness project-bind --cwd '<repo>' --session <native-session-id>   # связать сессию с источниками
harness bind --session <s> --request <r>   # связать попытку с запросом
harness metrics                             # snapshot | baseline | compare
```

**Журнал и квитанции.** Канонический журнал v2 — `~/.agents/state/journal.sqlite3`, задания/попытки —
`~/.agents/state/harness/`, зеркало — `~/.agents/journal`. Изменяющие узлы работают в постоянных
изолированных worktree; независимый verifier получает **отдельный снимок** артефактов; интегратор
переносит только проверенные `owned_paths`, сравнивая HEAD и хеши. Итоговый commit/push делает lead
после общей приёмки.

**Фактическое применение скилла отмечается квитанцией:**

```bash
harness skill-used <name> --evidence @<receipt.json>   # --session / --task — по желанию
```

`receipt.json` содержит `observed_result` и `artifact` (существующий непустой файл; хеш читается из него)
**либо** `source_event_id` существующего события. Наличие скилла в каталоге ≠ применение: квитанция —
это proof того, что скилл реально применён. При пробеле — `npx skills find`, конкретный навык,
`skill-install`; пользовательские навыки не удаляются.

## 8. Запреты (кратко)

- Правки чужих областей без ownership; два писателя на файл одновременно.
- Субагент, возвращающий «DONE» без `ARTIFACTS`/`EVIDENCE`; lead, принимающий результат по заявленному pass.
- Прод-Cloudflare/R2 из агента — только человеческий чек-лист OPS.
- Рост `knownRed` (`scripts/test-baseline.json`), ручной merge `bun.lock`, force-push/удаление remote-веток.
- Выдуманные имена скиллов/моделей/команд: неподтверждённое помечай `проверить установку`, не изобретай.
- Остановка на планировании: первый коммит — prefactor или RED-тест.
