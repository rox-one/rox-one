# Инструкции кодовым агентам — ROX Meeting Agents

Эта программа расширяет существующий ROX. Перед любым изменением читать корневой AGENTS.md, [PRD](PRD.md), [SPEC](SPEC.md), свою карточку в [PLAN](PLAN.md), [TESTS](TESTS.md) и связанные существующие issues из [SOURCE-AUDIT](SOURCE-AUDIT.md).

## 1. Рабочий контракт

Ты реализуешь одну проверяемую вертикальную возможность, а не имитацию состояния. Тестовый ответ, тип TypeScript, пункт меню или HTTP 202 не доказывают выполнение. Нельзя закрывать issue только добавлением документа или теста на присутствие строки в исходнике.

Не заменять OMP/runtime, native Notes/Tasks/Calendar, source registry и identity. Не создавать вторые хранилища одинаковых рабочих объектов. Новые типы Meeting/Proposal/Operation расширяют общий Rox2 seam с совместимыми codecs. Conation копируется/встраивается только по подтверждённым исходникам/лицензии/схеме; неизвестные operations блокируются. Core ROX не должен зависеть от доступности внешнего conation.dev.

Пользовательский default — готовые установленные определения и настроенные разрешённые маршруты. Он не означает постоянный capture, silently expanded grants, доступ к любым документам, автоматическую отправку и бесконечный бюджет. Не отключать safety test ради default-ready.

## 2. Как выбрать следующую задачу

`issues.json` — карта work-package→GitHub issue/requirements/dependencies/tests; не независимый глобальный backlog и не источник текущего GitHub state. Читай живые issue/PR и проверяй acceptance code. Статус closed не доказывает выполненную возможность, если задача была закрыта доставкой документов.

I029 выполняется рано после I001/I002/I003. I027 предшествует доменным I021–I026. #333 развивается параллельно и блокирует неподтверждённый Conation, но не native M0. I034 — общий финальный gate, не prerequisite каждой задачи. Граф по `depends_on` не должен иметь циклов; external issues не сопоставлять по цифровым суффиксам ROX2/ROX-AUD.

Начальные дорожки: I002 bootstrap; #320/#321→I001 contracts; #333 source/API access. После них I003 и I029; далее capture/streaming и router по PLAN. Не запускать сразу все 34 задачи: это создаст гонки контрактов.

## 3. Роли исполнителей

Координатор выбирает ready work packages, назначает владельцев и блокирует общие файлы. Архитектор держит platform-contract/entity/event/result/RPC compatibility. Device-агент отвечает за mic/system/screen/overlay и native evidence. Runtime-агент — маршрутизацию/queue/grants/budget. Domain-агент — proposals/native actions/Conation adapters. UI-агент — реальные существующие surfaces, accessibility/i18n. QA-агент — independent tests и evidence, не ручное дописывание expected success в отчёт. Reviewer проверяет отдельно соответствие SPEC и качество реализации.

Общие файлы с одним владельцем: `packages/core/src/rox2/platform-contract.ts`, `apps/electron/src/transport/index.ts`, `packages/server-core/src/handlers/rpc/index.ts`, `packages/shared/src/agent/session-tool-defs.ts`, `package.json`, lockfile, глобальные registry. Перед редактированием записать reservation в parent issue; release reservation после merge/отмены. Независимые leaf-файлы допустимы параллельно.

## 4. Старт в отдельном worktree

Команды предназначены для локального checkout, не для чтения аккаунтных секретов. Перед запуском заменить только значение I-кода на выбранную ready задачу. Скрипт не удаляет директории и не force-push.

```sh
cat > /tmp/rox-meeting-worktree.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "Ошибка на строке %s; рабочие файлы не удалены.\n" "$LINENO" >&2' ERR
TASK="${1:-I002}"
[[ "$TASK" =~ ^I[0-9]{3}$ ]] || { echo 'Ожидается I-код, например I002' >&2; exit 2; }
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[[ -z "$(git status --porcelain)" ]] || { echo 'Исходный worktree содержит изменения. Сначала сохраните их.' >&2; exit 2; }
git fetch origin main
BASE="$(git rev-parse origin/main)"
BRANCH="feat/rma-${TASK,,}"
PARENT="$(dirname "$ROOT")/rox-meeting-worktrees"
DEST="$PARENT/$TASK"
mkdir -p "$PARENT"
[[ ! -e "$DEST" ]] || { printf 'Каталог уже существует: %s\n' "$DEST" >&2; exit 2; }
git show-ref --verify --quiet "refs/heads/$BRANCH" && { echo 'Ветка уже существует; не перезаписываю.' >&2; exit 2; }
git worktree add -b "$BRANCH" "$DEST" "$BASE"
printf 'TASK=%s\nBASE=%s\nWORKTREE=%s\n' "$TASK" "$BASE" "$DEST"
EOF
bash /tmp/rox-meeting-worktree.sh I002
```

На macOS системный Bash 3.2 не поддерживает `${TASK,,}`. Перед выполнением на таком shell заменить вычисление BRANCH на `BRANCH="feat/rma-$(printf '%s' "$TASK" | tr '[:upper:]' '[:lower:]')"`; предпочтительная переносимая строка именно эта. Не устанавливать новый shell ради worktree. Если программа-документация ещё не merged, получить её branch отдельно для чтения либо использовать paths PR; feature branch строить от согласованного integration base, не слепо от устаревшей docs branch.

## 5. RED → минимальная реализация → GREEN

Сначала прочитать реальный код, трассировать handler→domain→storage/adapter. Создать один тест на нарушенный инвариант. Пример I006 полностью приведён в TESTS §5. Запустить его отдельно и сохранить вывод. Затем реализовать минимальный путь и повторить. Тест должен сломаться при удалении исправления, иначе он ничего не доказывает.

Для UI теста использовать настоящую страницу и RPC/store. Fake provider находится на границе сети, не внутри React с заранее созданной финальной карточкой. Failure injection: до записи, после эффекта до receipt, после receipt до verification, перед restart. Для каждого места проверить idempotency, status и readback.

После unit GREEN выполнить E-кейс задачи и regression связанных packages. Нативный capture/overlay проверяется упакованным приложением отдельно. Кейс на fixture gateway не закрывает live voice или Conation integration. При отсутствии стенда оставить blocked, owner и точное требуемое действие.

## 6. Изоляция и логирование тестов

Не использовать реальный профиль пользователя. Для тестового запуска создать `mktemp -d`, выставить `ROX_CONFIG_DIR` и `CRAFT_CONFIG_DIR` на один sandbox; harness изолирует HOME и credential adapters. Не выводить `env`, токены, cookies, private transcripts или неотредактированные HAR в лог. Тестовые подключения только fake/sandbox tenants; live provider — явное разрешение владельца.

```sh
set -Eeuo pipefail
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/rox-rma-test.XXXXXX")"
export ROX_CONFIG_DIR="$SANDBOX/config"
export CRAFT_CONFIG_DIR="$ROX_CONFIG_DIR"
mkdir -p "$ROX_CONFIG_DIR" "$SANDBOX/evidence"
# После реализации scripts задачи I029:
bun run test:meetings:unit 2>&1 | tee "$SANDBOX/evidence/unit.log"
bun run test:meetings:e2e 2>&1 | tee "$SANDBOX/evidence/e2e.log"
printf 'Свидетельства: %s\n' "$SANDBOX/evidence"
```

До I029 эти scripts отсутствуют; не запускать их и не считать отсутствие тестов успехом. Использовать точные существующие команды из TESTS §8 и тесты собственной issue. Не удалять sandbox автоматически до анализа failure; удалять только каталог, который создал этот запуск, после сохранения разрешённых evidence.

## 7. Подтверждение результата и отчёт

Каждая новая мутация должна иметь operationId, source revisions, policy decision, receipt и verification. UI «Проверено» требует production+succeeded+verified. Readback сверяет ожидаемые поля, а не только наличие ID. Нет idempotency/reconcile — unknown требует ручной проверки, не повторной отправки.

В PR обязательно: exact baseline/head SHA; что изменено; какие R закрыты; actual call path; RED/GREEN команды; E-case/result/level; platform/build/model/schema versions; миграция/backup/readback; rollback; оставшиеся blockers. Для baseline failures приложить два запуска одной команды: baseline и branch. «Похоже на старую ошибку» не считается доказательством.

Проверка completion: последняя проверка должна относиться к текущему HEAD после всех правок. Не ссылаться на зелёный тест до последнего коммита. Автор не утверждает, что сам провёл независимый review. Request review другого агента/человека; merge оставляется владельцу репозитория.

## 8. Готовый промпт координатору

```text
Работай в rox-one/rox-one над программой plans/meeting-agents.
Прочитай корневой AGENTS.md, PRD.md, SPEC.md, PLAN.md, TESTS.md,
SOURCE-AUDIT.md и issues.json. Получи актуальный main SHA и состояние
связанных issues/PR. Не начинай с массового переписывания платформы.
Выбери ready задачу по acceptance dependencies; I029 запускается рано,
I027 до Conation domain adapters. #333 не блокирует native M0.
Назначь одного владельца общих contracts/transport/registry файлов.
Для каждой задачи: isolated branch/worktree → RED → минимальная
реализация → GREEN unit/RPC → реальный E2E → native/live, где требуется
→ независимый review → PR. Не merge и не deploy автоматически.
Сохраняй source revisions, grants, operation receipts и readback.
Не называй fixture, queued, документ или тип готовой функцией.
Каждый итог: выполненные R, exact SHA, команды, pass/fail/blocked/not_run,
артефакты evidence, rollback и следующий ready шаг. Не закрывай parent
или полную программу после первого вертикального среза.
```

## 9. Готовый промпт исполнителю одной задачи

```text
Реализуй только выбранную GitHub issue программы ROX Meeting Agents.
Найди её I-код и зависимости в plans/meeting-agents/issues.json.
Прочитай соответствующий раздел PLAN и нормативные SPEC/PRD/TESTS.
Сначала проверь реальное состояние затронутых файлов на текущем main.
Если эквивалентная реализация уже merged, проверь acceptance и используй
её; не создавай дубликат. Подтверди reservation общих файлов.
Напиши failing behavioral test с negative/recovery кейсом, затем
реализуй фактический UI→RPC→domain→adapter/storage→readback путь.
Все новые пользовательские строки локализуй во всех фактических locales.
Не расширяй права и не включай capture/send/расходы по одному enabled flag.
Недоступные native/provider проверки оставь blocked с точной причиной.
Открой отдельный PR с exact SHA, RED/GREEN, E2E evidence и rollback.
Не merge, не переписывай чужие ветки, не закрывай другие задачи.
```

## 10. Готовый промпт независимому reviewer

```text
Проверь PR независимо от отчёта автора. Сначала соответствие SPEC и
PRD R-кодам, затем фактический code path и тесты. Найди ложный success,
fixture production path, unvalidated input, actor spoofing, source ACL
leak, stale approval, duplicate side effect, потерю revisions/данных,
молчаливый fallback в облако и отсутствующий packaged resource.
Повтори указанные тесты на точном HEAD, проверь evidence levels.
Для provider action требуй readback; для mic/system/overlay — native
доказательства. Source-string tests не заменяют E2E. Не требуй unrelated
refactor. Итог: approve либо конкретные blocking defects с file:line,
repro, минимальным исправлением и regression test. Не merge сам.
```
