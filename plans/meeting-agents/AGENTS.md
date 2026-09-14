# Инструкции кодовым агентам — ROX Meeting Agents

Программа #356 расширяет существующий ROX. Перед изменением читать корневой AGENTS.md, [PRD](PRD.md), [SPEC](SPEC.md), свою карточку в [PLAN](PLAN.md), [TESTS](TESTS.md), [SOURCE-AUDIT](SOURCE-AUDIT.md) и [issues.json](issues.json).

## 1. Рабочий контракт

Реализуй одну проверяемую возможность, не имитацию состояния. Тип TypeScript, пункт меню, тестовый ответ или HTTP 202 не доказывают выполнение. Source-string assertion не заменяет behavioral test.

Не заменять OMP/runtime, native Notes/Tasks/Calendar, source registry и identity. Не создавать вторые хранилища одинаковых рабочих объектов. Meeting/Proposal/Operation расширяют общий Rox2 seam с совместимыми codecs. Conation переносится только по подтверждённым исходникам/лицензии/схеме; неизвестные операции blocked. Нативный M0 не зависит от внешнего conation.dev.

Default означает предустановленные определения и настроенные разрешённые маршруты, а не постоянный capture, бесконечный бюджет, все документы и автоматическую отправку. Не расширять grants обновлением пакета. Не выключать safety tests ради default-ready. Секреты не попадают в renderer, опубликованные артефакты, prompts или логи.

## 2. Как выбрать следующую задачу

`issues.json` связывает work-package→GitHub issue→requirements→dependencies→tests. Это planning snapshot, не актуальное состояние GitHub и не ещё один глобальный backlog. Читай живые issues/PR и проверяй фактический acceptance code. Closed не доказывает готовую возможность, если issue закрыли доставкой документов.

Начальные дорожки: **#358 / I002** bootstrap; **#320/#321 → #357 / I001** contracts; **#333** доступ/инвентаризация Conation. После контракта — **#359 / I003**, затем ранний **#385 / I029** E2E harness. Далее capture/streaming и router по PLAN. Первый результат — **#367 / I011** через настоящий UI. **#383 / I027** предшествует Conation domain tasks #377–#382. **#390 / I034** — финальный gate, не prerequisite каждого шага.

Не запускать одновременно все 34 задачи. Граф `depends_on` ацикличен; external dependencies тоже проверяются. Нельзя сопоставлять ROX2/ROX-AUD по цифровым суффиксам. Частичные security/packaging проверки для M0 идут до завершения всех cross-cutting задач; release scope фиксируется конкретными cases, а не флагом closed всей issue.

## 3. Роли исполнителей и shared-file ownership

Координатор выбирает ready задачи и назначает владельцев. Архитектор держит общие schemas/identity/events/result/RPC. Device-агент — mic/system/screen/overlay и native evidence. Runtime-агент — jobs/grants/budgets. Domain-агент — proposals/native actions/Conation. UI-агент — реальные surfaces/i18n/a11y. QA-агент — независимые behavioral tests и evidence. Reviewer проверяет отдельно соответствие SPEC и качество кода.

Один активный владелец на `packages/core/src/rox2/platform-contract.ts`, `apps/electron/src/transport/index.ts`, `packages/server-core/src/handlers/rpc/index.ts`, `packages/shared/src/agent/session-tool-defs.ts`, `package.json`, lockfile и глобальные registries. Reservation записать в #356 перед изменением; снять после merge/отмены. Независимые leaf-файлы допускаются параллельно. Не создавать копию интерфейса ради обхода reservation.

## 4. Изолированная ветка/worktree

Запускать из локального checkout ROX. Скрипт совместим с Bash 3.2+, не удаляет каталоги и не force-push. Значение I-кода выбирать по готовности зависимостей.

```sh
cat > /tmp/rox-meeting-worktree.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "Ошибка на строке %s; рабочие файлы не удалены.\n" "$LINENO" >&2' ERR
TASK="${1:-I002}"
[[ "$TASK" =~ ^I[0-9]{3}$ ]] || { echo 'Ожидается I-код, например I002' >&2; exit 2; }
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[[ -z "$(git status --porcelain)" ]] || { echo 'Исходный worktree содержит изменения; сначала сохраните их.' >&2; exit 2; }
git fetch origin main
BASE="$(git rev-parse origin/main)"
BRANCH="feat/rma-$(printf '%s' "$TASK" | tr '[:upper:]' '[:lower:]')"
PARENT="$(dirname "$ROOT")/rox-meeting-worktrees"
DEST="$PARENT/$TASK"
mkdir -p "$PARENT"
[[ ! -e "$DEST" ]] || { printf 'Каталог уже существует: %s\n' "$DEST" >&2; exit 2; }
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo 'Ветка уже существует; не перезаписываю.' >&2
  exit 2
fi
git worktree add -b "$BRANCH" "$DEST" "$BASE"
printf 'TASK=%s\nBASE=%s\nWORKTREE=%s\n' "$TASK" "$BASE" "$DEST"
EOF
bash /tmp/rox-meeting-worktree.sh I002
```

Если документационный PR ещё не merged, читать документы его ветки отдельно. Feature branch строить от согласованного integration base; не подменять его устаревшей docs branch. Если эквивалентная реализация уже появилась, проверить acceptance и переиспользовать её. Не удалять чужие ветки и незакоммиченные изменения.

## 5. RED → минимальная реализация → GREEN

Прочитать реальный код, проследить UI→RPC→domain→storage/adapter. Написать один failing behavioral test; пример I006 дан в TESTS §5. Запустить отдельно и сохранить RED. Реализовать минимальный путь, повторить до GREEN. Удаление исправления должно снова ломать тест.

Для UI использовать настоящую страницу и RPC/store. Fixture provider находится только на внешней границе, не внутри React с заранее подставленной итоговой Task. Failure injection: до записи, после эффекта до receipt, после receipt до verification, перед restart. Проверить status, idempotency и readback на каждом разрыве.

После unit GREEN выполнить E-кейс и regression затронутых packages. Capture/overlay и упаковка требуют N5, реальные providers — L4. E3 fixture gateway не закрывает native/live capability. Нет стенда — blocked с владельцем и точным следующим действием, не pass. No-tests-found и skip не превращать в успех.

## 6. Изоляция тестов и свидетельства

Не использовать реальный профиль. Harness изолирует HOME, config и credential adapters. Live provider — только с явным разрешением владельца на тестовые данные/аккаунт. Не печатать env, tokens, cookies, raw private transcripts или неотредактированные HAR.

```sh
set -Eeuo pipefail
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/rox-rma-test.XXXXXX")"
export ROX_CONFIG_DIR="$SANDBOX/config"
export CRAFT_CONFIG_DIR="$ROX_CONFIG_DIR"
mkdir -p "$ROX_CONFIG_DIR" "$SANDBOX/evidence"
# Эти scripts добавляет I029; до их реализации использовать команды своей issue.
bun run test:meetings:unit 2>&1 | tee "$SANDBOX/evidence/unit.log"
bun run test:meetings:e2e 2>&1 | tee "$SANDBOX/evidence/e2e.log"
printf 'Свидетельства: %s\n' "$SANDBOX/evidence"
```

Точные существующие scripts базы — TESTS §8. Не перегенерировать lockfile молча при failed frozen install. Sandbox удалять только после сохранения разрешённых evidence и только если он создан этим запуском. При baseline failure повторить ту же команду на baseline worktree и приложить оба лога; сходство ошибок недостаточно.

## 7. PR и завершение

Каждая мутация имеет source revisions, approval payloadHash, current grant, operationId, receipt и verification. UI «Проверено» требует production+succeeded+verified. Readback сравнивает ожидаемые поля, не только наличие ID. Неоднозначный внешний эффект без idempotency/reconcile требует ручной проверки, не повторной отправки.

PR содержит baseline/head SHA, закрываемые R, точные файлы и реальный call path, RED/GREEN команды, E-cases с result/level, platform/build/model/schema/corpus версии, evidence, backup/migration/readback, rollback и blockers. Последние тесты должны относиться к текущему HEAD после всех правок. Автор не объявляет собственный self-review независимым.

Запросить отдельный review. Не merge/deploy автоматически и не закрывать parent #356 либо все requirements одним срезом. Документационный PR ничего не меняет в готовности функций. Статусы tests: passed/failed/blocked/not_run, не «почти работает».

## 8. Промпт координатору

```text
Работай в rox-one/rox-one над программой #356, plans/meeting-agents.
Прочитай корневой AGENTS.md и все документы программы, включая issues.json.
Получай актуальный main SHA и состояние связанных issues/PR.
Начни с ready задач: #358; #320/#321→#357; #333 параллельно.
После contracts/grants подними #385, не оставляй E2E на конец.
#383 выполняется до Conation domain adapters. #333 не блокирует native M0.
Назначь одного владельца общих contracts/transport/registry файлов.
Каждая задача: isolated branch → RED → реализация → GREEN unit/RPC →
реальный E2E → native/live по требованиям → независимый review → PR.
Не merge и не deploy автоматически. Не переписывай всю платформу.
Сохраняй source revisions, grants, operation receipts и readback.
Не называй fixture/queued/документ/тип готовой функцией.
Итог каждой итерации: R, exact SHA, команды, результаты tests,
evidence, rollback, blockers и следующий ready шаг.
Первый принимаемый результат — #367; он не закрывает всю программу.
```

## 9. Промпт исполнителю одной задачи

```text
Реализуй только выбранную issue программы ROX Meeting Agents.
Разреши I-код и dependencies через plans/meeting-agents/issues.json.
Прочитай PLAN/SPEC/PRD/TESTS и реальный затронутый код на текущем main.
Эквивалентную уже merged реализацию проверь и используй, не дублируй.
Согласуй reservation общих файлов. Напиши failing behavioral test
с negative/recovery кейсом, затем реализуй UI→RPC→domain→adapter/store→readback.
Новые пользовательские строки локализуй во всех фактических locales.
Не расширяй права и не включай capture/send/расходы по одному enabled flag.
Native/provider tests без стенда оставь blocked с точной причиной.
Открой отдельный PR: exact SHA, RED/GREEN, E2E evidence и rollback.
Не merge, не трогай чужие ветки, не закрывай другие задачи.
```

## 10. Промпт независимому reviewer

```text
Проверь PR независимо от отчёта автора: SPEC/PRD requirements, реальный
code path и tests. Ищи false success, fixture production route,
unvalidated input, actor spoofing, ACL leak, stale approval, duplicate effect,
потерю данных/revisions, молчаливый cloud fallback и missing packaged resources.
Повтори tests на exact HEAD и проверь evidence levels.
Provider actions требуют readback; mic/system/overlay — native evidence.
Source-string assertions не заменяют E2E. Не требуй unrelated refactor.
Итог: approve либо blocking defects с file:line, repro, минимальным fix
и regression test. Не merge самостоятельно.
```
