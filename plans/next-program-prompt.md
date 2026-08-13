# Промпт — Rox Next Program (lead integration agent)

Скопируй этот файл целиком как задание следующему lead-агенту. Не повторяй аудит. Не реализуй managed SiYuan. Не переименовывай appId. Не удаляй remote-ветки.

---

Ты — lead integration agent репозитория `rox-one/rox-one`.

## Цель

Довести продукт от «P0 больше не висят» до «чистая машина либо пишет первый turn, либо останавливается на одном credential-шаге». Закрыть остаточные дыры публичного контура. Смонтировать уже написанный knowledge→session путь. Сделать один настоящий вклад в unified shell или честно оставить флаг experimental. Начать identity expand без stranding. Разрезать session/config god-module так, чтобы следующая фича не сериализовалась через два файла.

## Обязательные документы (прочитай до диспатча)

1. `plans/problem-inventory.md` — полный список недочётов
2. `plans/next-program-spec.md` — spec
3. `plans/next-program/README.md` + `plans/next-program/tickets/*.md`
4. `docs/superpowers/plans/2026-08-13-next-program.md` — оркестрация
5. `plans/identity-migration-plan.md` — что нельзя переименовывать
6. `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md` — managed kernel запрещён
7. `AGENTS.md` — Bun, i18n, OMP
8. `docs/omp-rpc-notes.md` — если трогаешь транспорт OMP

База: `rox-integration-remediation-7c33` (PR #5). Не начинай с `main` @ `5797f431`.

## Скиллы (обязательная карта)

Инвентаризируй скиллы в `~/.agents/skills` и репозитории. Назначь узкий скилл на каждый тикет. Паттерн: прочитать скилл → сказать субагенту какой скилл → implement → test → verify → structured result.

| Тикет | Скилл(ы) | Зачем |
|---|---|---|
| Lead | `dispatching-parallel-agents`, `using-git-worktrees`, `code-review`, `verification-before-completion` | оркестрация, review gate |
| 01 first-run | `systematic-debugging`, `test-driven-development` | credential path, bounded failure |
| 02 callback XSS | `test-driven-development` + security review | escape — единственный HTML builder |
| 03 viewer residuals | threat-model / `test-driven-development` | bytes, nosniff, conditional put |
| 04 defaults | `test-driven-development` | один JSON = истина |
| 05 knowledge mount | `implement`, `react-best-practices` | смонтировать существующий panel |
| 06 secrets UI | `implement` + secure secrets handling | refs only, no values in renderer |
| 07 identity expand | `writing-plans` + migration plan | `getEnv` / config-dir, no appId |
| 08 webui/hygiene | `implement` | manifest, stub, dead scripts |
| 09 session deepen | `improve-codebase-architecture`, `codebase-design` | internal seams, тот же public interface |
| 10 leftover MCP | `writing-plans` (expand–contract) | stop staging → delete |
| 11 one panel | `react-best-practices` + browser verification | go/no-go флага |
| 12 OMP codes | `test-driven-development` | protocol union |
| 13 live E2E | `verification-before-completion` + browser automation | только с живым ключом |
| 14 decisions | `writing-plans` | ADR, не код |

Каждый субагент возвращает:

```
STATUS
ROOT CAUSE
SKILL(S) USED
FILES CHANGED
IMPLEMENTATION
TESTS ADDED
TESTS RUN
RUNTIME VERIFICATION
RISKS
REMAINING GAPS
COMMIT(S)
```

Ответ без evidence недостаточен.

## Как строить работу (улучшение прошлого цикла)

Прошлый цикл сработал: 8 worktree, ownership map, TDD, независимые R1–R4, adversary нашёл дыры, которые suite пропустил. Улучши так:

1. **Сначала prefactor (тикет 09), не фичи в SessionManager.** Иначе Wave 1 снова встанет в очередь на один файл.
2. **Один тикет = один вертикальный slice**, не «весь identity» и не «весь knowledge».
3. **Не мержить в `main`.** Integration branch → reviewers → E2E → PR.
4. **Не чинить всё в lead-контексте.** Верни субагента с конкретными комментариями.
5. **Adversary обязателен** на 01, 02, 03, 06. Прошлый R4 окупился.
6. **Live turn (13) не фейкается зелёным.** Нет ключа — статус BLOCKED с именем секрета.
7. **Decision tickets не становятся кодом.** G2/WeChat/appId — письмо, не PR с бинарём SiYuan.
8. **Пиши per-ticket `writing-plans`** с failing test в теле плана. Этот файл — оркестрация, не 200 шагов.

## Ownership (conflict avoidance)

| Владелец | Файлы |
|---|---|
| 09 only, пока extract не влит | `packages/server-core/src/sessions/SessionManager.ts` |
| 04 затем 07 | `packages/shared/src/config/storage.ts`, `config-defaults.json` |
| 01 / 12 | `packages/shared/src/agent/omp-agent.ts`, `agent/errors.ts` (additive) |
| 03 | `apps/viewer/functions/**` |
| 02 | `packages/shared/src/auth/callback-page.ts` |
| 05 / 11 | `apps/electron/src/renderer/knowledge/**`, `renderer/platform/**` |
| 06 | `packages/shared/src/secrets/**`, settings RPC additive |
| 10 | `scripts/build/**`, `runtime-resolver.ts` |
| 08 | `apps/webui/**`, root `package.json`, `docs/cli.md` |

Протокольные DTO: один владелец (12). Остальные — patch recommendation.

## Волны

```
WAVE 0  тикет 09
WAVE 1  01 02 03 04 05 06 08 10 15   параллельно
WAVE 2  07 (после 04)  11 (после 05)  12 (после 09)
WAVE 3  reviewers (integration / browser / security / adversary)
        13 live E2E
        14 decisions — в любой момент, человеком
```

## Definition of Done

Не достаточно: «планы написаны», «тесты зелёные», «PR открыт».

Готово, когда:

- чистая машина: install → boot → либо stream ответа, либо один credential-step → retry успешен
- 02 и 03 закрыты тестами (escape + UTF-8 bytes + nosniff + no lost-update)
- Knowledge CTA смонтирован и mention переживает create session
- Settings secretRef не отдаёт value в renderer
- `ROX_*` читается, `CRAFT_*` жив
- SessionManager extract влит, следующий diff по сессии не в 10k-строчном файле
- unified shell: либо одна живая панель, либо KEEP_EXPERIMENTAL с датой
- каждый негативный путь: bounded + typed + idle + actionable
- live E2E либо VERIFIED, либо BLOCKED с именем секрета
- G2 по-прежнему fail-closed

## Ожидаемый финальный отчёт

### 1. Execution matrix

`Ticket | Subagent | Skill(s) | Branch | Commit | Status | Tests | Runtime verified | PR`

### 2. Before / after

На каждый OPEN из inventory, который вы взяли: BEFORE / ROOT CAUSE / FIX / TEST / RUNTIME / REMAINING.

### 3. Fresh-machine

VERIFIED / MOCK-VERIFIED / BLOCKED + почему. Отдельно: stream, host tool, MCP tool, permission.

### 4. Security

Закрытые дыры, остаточный риск, OPS, что осталось человеком (CF rule, R2 cleanup).

### 5. Architecture

Что вынесено из SessionManager/storage. Deletion test: если вернуть extract обратно, сложность расползается по callers или нет?

### 6. PRs

Порядок merge. Не в `main` до E2E.

### 7. Blockers

Только настоящие: нет ключа, нет website access, G2 legal, appId policy.

## Запреты

- Не копировать чужой код.
- Не менять production Cloudflare/R2 из агента. OPS — чеклист человеку.
- Не бандлить SiYuan.
- Не flip `appId` / `productName`.
- Не удалять remote branches.
- Не включать unified shell по умолчанию без живой панели.
- Не репортить модель, которую OMP не использовал.
- Не оставлять permanent spinner.

## Старт

1. Прочитай скиллы и документы выше.
2. Создай integration branch от `rox-integration-remediation-7c33`.
3. Сразу запусти WAVE 0 (09) и параллельно WAVE 1 (01, 02, 03, 04, 05, 06, 08, 10, 15).
4. Не останавливайся после планирования. Первый коммит — либо extract, либо failing test тикета 01/02/03.
