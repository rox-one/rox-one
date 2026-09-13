# H-05. Каталог истории #92 vs `origin/main`

- **Issue:** [#92](https://github.com/rox-one/rox-one/issues/92)
- **Снимок:** локальные и remote-tracking ветки из Mac-инвентаря (не заявление о готовности)
- **Правило:** дедуп одинаковых refs; merge только того, чего ещё нет на main

## Уже на `origin/main` (этот каталог)

| Тема | Источник в инвентаре | Main |
|---|---|---|
| H0–H6 session harness | `rox/session-harness-port` | [#72](https://github.com/rox-one/rox-one/pull/72) |
| H5 import append | follow-up H5 | [#209](https://github.com/rox-one/rox-one/pull/209) |
| Host-tool Bash jail | `rox/host-bash-sandbox` | [#201](https://github.com/rox-one/rox-one/pull/201) |
| Agent Teams skill + flag | `rox/harness-agent-teams` | [#81](https://github.com/rox-one/rox-one/pull/81) |
| Durable `.agent-teams/` | `rox/harness-agent-teams-durable` | [#82](https://github.com/rox-one/rox-one/pull/82) |
| Session tool `agent_teams` | worktree ROXO-151 | [#207](https://github.com/rox-one/rox-one/pull/207) |
| Captain-only identity | leftover #91 | [#275](https://github.com/rox-one/rox-one/pull/275) |

Issues [#84](https://github.com/rox-one/rox-one/issues/84)–[#91](https://github.com/rox-one/rox-one/issues/91) закрыты: DoD волн H0–H6 зелёный на main; #91 — identity leftover.

## Не merge из этого каталога

| Класс | Примеры из #92 | Почему |
|---|---|---|
| Checkpoints | `checkpoint/session-audit-20260821-*` | Снимки деревьев, не продукт-PR |
| Чужой `main` / `origin/main` | десятки `main <sha>` из других репо | Не этот tree |
| Ops / bots / gateway | `feat/authaccessbot-*`, `codex/rox-fleet-infra-*`, `feat/rox-hub-*` | Другой продукт |
| Atlas / knowledge / shell suite | `feature/atlas-*`, `origin/feat/knowledge-*`, `origin/feat/shell-w*` | Другие эпики |
| UEW docs already on main | `docs/uew-m*` | Уже влиты документами |
| Native / conation / backups | `rox/native-*`, `origin/backup/*` | Не session-audit harness |

Полный список refs остаётся в теле #92. Этот файл — disposition, не повтор инвентаря.

## Остаток вне H0–H6

Автономный Team orchestrator (авто-spawn без капитана) **не** входит в H6 skip-list exception: first-party skill + store + tool достаточно. Cordis `@nanmicoder/dsh-agent-teams` остаётся freeze.
