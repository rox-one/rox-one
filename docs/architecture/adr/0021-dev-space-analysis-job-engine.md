# ADR-0021: Job-движок пайплайнов анализа Developer Space (O3)

- **ID:** `RX-ADR-0021`
- **Status:** Accepted
- **Date:** 2026-10-09
- **Branch:** `feat/devspace-w2`
- **Spec:** [02-SPEC-foundations §6](../../specs/2026-10-09-dev-space-and-playbooks/02-SPEC-foundations.md), [05-PLAN §В2](../../specs/2026-10-09-dev-space-and-playbooks/05-PLAN.md)
- **Refs:** `RX-FEA-0034`, `RX-RSK-0001`

RFC 2119: MUST / MUST NOT / SHOULD / MAY.

## Context

Пайплайн анализа Developer Space — стадии `reconcile → structural tools → LLM-слой → publish`
(02 §6.1). Это длительные операции: загрузка/парсинг репозитория, tree-sitter, генерация wiki и
подкаста. Требуется один движок, покрывающий критерии 02 §6.3:

| Критерий | Требование |
|---|---|
| длительность/прогресс | > 20 c, потоковый прогресс, возобновление, отмена |
| локальность | без обязательного облачного эгресса; локальный прогон по умолчанию |
| изоляция | cwd = рабочий каталог репо; запрет выхода за `allowedRoots` |
| переиспользование | существующие spawn/аудит-паттерны; минимум нового кода |
| платформы | macOS + Windows (D14) |

**Почему не `shell:exec`.** `apps/electron/src/main/handlers/system.ts:314` задаёт `/bin/zsh -lc`
с таймаутом **20 с** и лимитом вывода **1 MiB** — длинные пайплайны гарантированно не укладываются
(риск брифа R1, `RX-RSK-0001`). `shell:exec` MUST NOT использоваться для стадий анализа.

## Decision

Принят **локальный in-process job-runner**, собранный из двух существующих паттернов:

1. **Спавн — по паттерну agent SDK subprocess** (`packages/shared/src/agent/omp-agent.ts`):
   ленивый спавн внешнего бинарника, NDJSON-over-stdio, `cwd` = sandbox-корень сессии, маппинг
   режима разрешений. Из этого паттерна берётся **форма запуска и владения процессом**, не сам
   агентный рантайм.
2. **Модель прогона — job-machine/push по образцу `voice:JOB`/`voice:OVERLAY`**
   (`packages/shared/src/voice/job-machine.ts`, `packages/shared/src/voice/host.ts`): типизированное
   состояние задачи с монотонным `seq`, переходы `queued → running → …`, отмена и публикация
   событий. `DevSpaceRun` (02 §6.2) повторяет эту форму.

**Решения по контракту:**

1. **Stage-registry.** Стадии (`reconcile`/`structural`/`llm`/`publish`) регистрируются единым
   реестром; structural-стадия допускает параллельный запуск независимых адаптеров, LLM-стадия —
   с ограничением параллелизма (общий пул задач job-runner, 02 §6.4).
2. **Прогресс — push `devSpace:runProgress`.** Renderer не опрашивает; UI показывает скелет сразу,
   фон дописывает (D5, 05 §В2).
3. **`startRun` — fire-and-forget.** RPC-хендлер запускает прогон и немедленно возвращает
   `runId`; управление — через `devSpace:cancel` (`AbortController`) и `devSpace:listRuns`.
4. **Идемпотентность по `(repositoryId, snapshotId, planHash)`.** `run-id` детерминирован
   (`devrun_<sha256(…)>`); успешный прогон для данного снапшота — no-op (кэш-хит), пока `planHash`
   не изменён (смена набора инструментов/версий → новый `planHash`). Возобновление — повторный
   запуск с тем же `snapshotId` продолжает только незавершённые стадии по журналу прогона.
5. **Отмена и журнал — как в контуре В1.** Отмена через реестр активных запросов + `AbortSignal`
   (образец — `requests` в `packages/server-core/src/handlers/rpc/code-intelligence.ts`, отмена в
   `packages/server-core/src/devspace/clone.ts`); журнал — `projects/<slug>/dev-space/runs/<runId>.json`,
   аудит — `audit.jsonl` по паттерну `packages/server-core/src/services/privileged-execution-broker.ts`.
6. **Таймауты.** Явный per-инструмент таймаут (больше `shell:exec`) и общий дедлайн стадии; при
   превышении — `status:'partial'` с перечнем незавершённых артефактов (02 §6.4).

## Rejected alternatives

| Вариант | Почему нет |
|---|---|
| `shell:exec` (`zsh -lc`) | 20 с / 1 MiB (`system.ts:314`); длинные стадии не укладываются (R1). |
| automations + workflows-движок (`packages/server-core/src/handlers/rpc/automations.ts`, `packages/server-core/src/workflows/*`) | Пользовательский граф сценариев, не инфраструктурный пайплайн; RPC-каналов `workflows:*` нет. |
| Extension host (`main/extension-host/*`) | Лишняя UI-расширяемость для серверных стадий анализа. |
| Второй агентный рантайм | Нарушает инвариант «нет второго рантайма» (ADR-0019, UEW §2.1). |

## Consequences

- Переиспользуются существующие spawn- и job-паттерны; объём нового кода минимален (реестр стадий +
  `DevSpaceRun` + push-канал).
- Изоляция обеспечивается `cwd` = рабочий каталог репо и policy `allowedRoots`; эгресс отсутствует
  (D6, `dataEgress:'deny'` по умолчанию).
- **Резерв усиленной изоляции** — cloud-runner local (`packages/cloud-runner/src/local-provider.ts`,
  run-dir `spec.json`/`state.json`/`events.jsonl`/`runner.pid`/`artifacts/`). Подключается только
  при доказанной потребности в сильной изоляции, не в v1.

**Ограничения:**

- **Windows.** Спавны (git, tree-sitter, внешние бинарники) имеют платформенные нюансы
  (`GIT_ASKPASS`-эквивалент, кодировка вывода, сигналы отмены); контракт job-runner MUST NOT
  опираться на POSIX-only семантику.
- **Возобновление по `snapshotId`.** Продолжаются только незавершённые стадии; частично записанные
  артефакты стадии переполняются, опубликованное не перезаписывается молча (§7.4).
- **Кэш завязан на `planHash`.** Изменение набора/версий инструментов инвалидирует кэш снапшота и
  запускает полный прогон.