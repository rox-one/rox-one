# ROX Meeting Agents

**Программа:** [#356](https://github.com/rox-one/rox-one/issues/356). **Реализация:** 34 issues [#357](https://github.com/rox-one/rox-one/issues/357)–[#390](https://github.com/rox-one/rox-one/issues/390). **Требования:** R01–R64. **Сквозная проверка:** E01–E34.

Версия 1.0 · 2026-09-13 · База аудита `665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899`.
Документационная ветка: `docs/meeting-agents-program-20260913`.

## Статус

Созданы проектные материалы и реальные GitHub issues. Продуктовый код в этой доставке не реализован; Bun/typecheck/Electron build/live gateway/native media и продуктовые E2E не запускались. Подготовленные примеры тестов — задания реализации, не результаты их прохождения.

Полный `agisota/conation` возвращает 404 подключению GitHub; причина не установлена. [#333](https://github.com/rox-one/rox-one/issues/333) остаётся владельцем доступа/исходной схемы/лицензий. Неподтверждённые операции и перенос кода заблокированы, но нативные агенты/Notes/Tasks/встречи от этого не зависят.

Цель: восемь предустановленных и преднастроенных ролей, полезные сценарии Cluely/Tana/Supernormal/Fireflies и нативные функции Conation. Не iframe, не внешние ссылки вместо функций, не второй agent runtime и не копии одинаковых рабочих объектов.

## Документы

| Файл | Для чего читать |
|---|---|
| [PRD.md](PRD.md) | Продуктовая цель, 8 ролей, 64 требования, сценарии, milestones, метрики и границы |
| [SPEC.md](SPEC.md) | Архитектура, карта файлов, контракты/состояния, storage/CAS/outbox, capture, policies, Conation |
| [PLAN.md](PLAN.md) | 34 карточки: точные paths, изменения, зависимости, RED-тесты, команды, E2E и rollback |
| [TESTS.md](TESTS.md) | 34 группы сквозных сценариев, negative/recovery, media/semantic corpus, harness, native/live gates |
| [AGENTS.md](AGENTS.md) | Запуск исполнителей, shared-file ownership, worktree, TDD, review и три готовых промпта |
| [SOURCE-AUDIT.md](SOURCE-AUDIT.md) | Проверенные и непроверенные источники, current/older SHA, ограничения, переиспользование старых issues |
| [issues.json](issues.json) | Машиночитаемая карта требования → work package → реальная issue → dependencies → E-case |

## Навигация по задачам

| Контур | Issues |
|---|---|
| Общие контракты, установка и разрешения | [#357](https://github.com/rox-one/rox-one/issues/357), [#358](https://github.com/rox-one/rox-one/issues/358), [#359](https://github.com/rox-one/rox-one/issues/359) |
| Захват, streaming и transcript revisions | [#360](https://github.com/rox-one/rox-one/issues/360), [#361](https://github.com/rox-one/rox-one/issues/361), [#362](https://github.com/rox-one/rox-one/issues/362) |
| Runtime, извлечение, approval и executor | [#363](https://github.com/rox-one/rox-one/issues/363), [#364](https://github.com/rox-one/rox-one/issues/364), [#365](https://github.com/rox-one/rox-one/issues/365), [#366](https://github.com/rox-one/rox-one/issues/366) |
| Первый native E2E, Meetings UI и overlay | [#367](https://github.com/rox-one/rox-one/issues/367), [#368](https://github.com/rox-one/rox-one/issues/368), [#369](https://github.com/rox-one/rox-one/issues/369) |
| Assist, знания, материалы и trackers | [#370](https://github.com/rox-one/rox-one/issues/370), [#371](https://github.com/rox-one/rox-one/issues/371), [#372](https://github.com/rox-one/rox-one/issues/372), [#373](https://github.com/rox-one/rox-one/issues/373) |
| Подготовка, follow-up и профили | [#374](https://github.com/rox-one/rox-one/issues/374), [#375](https://github.com/rox-one/rox-one/issues/375) |
| Conation capability/поставка и общий sync | [#376](https://github.com/rox-one/rox-one/issues/376), [#383](https://github.com/rox-one/rox-one/issues/383) |
| Conation Notes/Projects, Board/Fund, Files, Mail, CRM, Calendar/Calls | [#377](https://github.com/rox-one/rox-one/issues/377), [#378](https://github.com/rox-one/rox-one/issues/378), [#379](https://github.com/rox-one/rox-one/issues/379), [#380](https://github.com/rox-one/rox-one/issues/380), [#381](https://github.com/rox-one/rox-one/issues/381), [#382](https://github.com/rox-one/rox-one/issues/382) |
| Security, E2E harness, качество и упаковка | [#384](https://github.com/rox-one/rox-one/issues/384), [#385](https://github.com/rox-one/rox-one/issues/385), [#386](https://github.com/rox-one/rox-one/issues/386), [#387](https://github.com/rox-one/rox-one/issues/387) |
| Команда/экспорт, комнаты и финальная приёмка | [#388](https://github.com/rox-one/rox-one/issues/388), [#389](https://github.com/rox-one/rox-one/issues/389), [#390](https://github.com/rox-one/rox-one/issues/390) |

## С чего начинать

Не брать задачи по возрастанию GitHub номера. Начать #358 независимо; параллельно владельцы #320/#321 готовят общий seam для #357, а #333 подтверждает Conation. После #357/#358/#359 поднять **#385 — ранний E2E harness**, затем capture/streaming/transcript и runtime/extraction/approval/executor. Первый принимаемый результат — **#367**:

```
Чистая установка → 8 ролей → разрешённая встреча
                 → транскрипт → предложение → подтверждение
                 → настоящая Task + Note → readback → restart
```

#383 sync выполняется перед доменными #377–#382. #333 не блокирует этот нативный сценарий. Existing Tasks/Notes/identity/Calendar задачи не дублировать: смысловой crosswalk находится в SOURCE-AUDIT.

Одна task/ветка, один владелец shared contracts/transport/registry. Итерация: RED → минимальная реализация → GREEN → реальный UI/RPC/store/provider readback → negative/recovery → native/live по необходимости → независимый review → PR. Не merge/deploy автоматически. Документационный PR не закрывает #356 или дочерние implementation issues.

## Проверка этой доставки

Выполнены D0-проверки локальным Python: 34 уникальных I/issue IDs; полное покрытие 64 требований; E01–E34 уникальны; все внутренние зависимости разрешимы, циклов нет; I027 до I021–I026; I029 зависит только от I001/I002/I003 для старта. GitHub readback `issues.json` вернул blob SHA `c593dce8794e9e7fb650b58abd5172e9ba206c33`, совпадающий с локально проверенными байтами.

Worktree-скрипт AGENTS проверен `bash -n` и на временном локальном Git origin: неверный I-код отвергнут, грязный worktree сохранён, новая ветка/worktree создана, повторный каталог отвергнут. Это проверка инструкций в контейнере, не тест native macOS приложения.

Повторить структурную проверку из checkout (Python 3.9+):

```sh
python3 - <<'PY'
import json
from pathlib import Path
from graphlib import TopologicalSorter
p = Path('plans/meeting-agents/issues.json')
d = json.loads(p.read_text(encoding='utf-8'))
w = d['workPackages']
g = {x['id']: set(x['depends_on']) for x in w}
assert len(w) == len(g) == len({x['issue'] for x in w}) == 34
assert {r for x in w for r in x['requirements']} == {f'R{i:02}' for i in range(1,65)}
assert {x['test'] for x in w} == {f'E{i:02}' for i in range(1,35)}
assert all(v <= g.keys() and k not in v for k,v in g.items())
order = list(TopologicalSorter(g).static_order())
assert all(order.index('I027') < order.index(f'I{i:03}') for i in range(21,27))
assert g['I029'] == {'I001','I002','I003'}
assert all((p.parent / name).is_file() for name in d['documents'])
print('PASS: planning graph, requirements, case IDs and document paths')
print('Dependency order:', ', '.join(order))
PY
```

Эта команда не проверяет актуальные статусы GitHub, полноту реализации и правильность product code. Все продуктовые tests остаются NOT_RUN в этой доставке. Live gateway и native audio/overlay требуют отдельного стенда и evidence; отсутствие Bun/сетевого checkout в текущем контейнере не означает неисправность CI репозитория.
