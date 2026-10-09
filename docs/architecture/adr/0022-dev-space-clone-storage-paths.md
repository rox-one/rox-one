# ADR-0022: Правило путей хранения клонов (O4)

- **ID:** `RX-ADR-0022`
- **Status:** Accepted
- **Date:** 2026-10-09
- **Branch:** `feat/devspace-w2`
- **Spec:** [02-SPEC-foundations §4.3/§5](../../specs/2026-10-09-dev-space-and-playbooks/02-SPEC-foundations.md), [05-PLAN §В2](../../specs/2026-10-09-dev-space-and-playbooks/05-PLAN.md)
- **Refs:** `RX-FEA-0034`

RFC 2119: MUST / MUST NOT / SHOULD / MAY.

## Context

Developer Space клонирует репозитории в управляемое пространство (02 §5.2) и строит из них
репо-проекты. Открытый вопрос O4 — **где хранить клоны**. Ограничения:

- handler code intelligence уже ожидает путь `resolve(workspaceRoot, 'projects', slug)` и folder
  `project.folderPath` — фактически зашитое правило (`packages/server-core/src/handlers/rpc/code-intelligence.ts:89-93`).
- каталог репозиториев Dev Space — server-owned (`dev-space-repositories.json`, 02 §4.2); запись
  каталога — тонкая обёртка над `RepositoryBinding`.
- отчуждать проект-контейнер от существующей модели проектов нельзя: `saveProjectConfig` /
  `loadProjectConfig` (`@rox/shared/projects`) уже оперируют `projects/<slug>`.

## Decision

**Клон/привязка живёт в `projects/<slug>/<repo-dir>` как репо-проект.**

1. Клон git-url и привязка local-folder размещаются внутри `projects/<slug>/` — это проект-контейнер
   (`project.config.workingDirectory` + `folderPath`), согласованный с существующей моделью проектов.
2. Правило **согласовано с резолвом code-intelligence**: путь проекта — `resolve(workspaceRoot, 'projects', slug)`,
   иных корней не вводится.
3. Локальная папка как источник (§5.4) переиспользует существующий `bindRepository(...)` +
   PREVIEW/BIND и тот же проект-контейнер через `saveProjectConfig`.

## Rejected alternatives

| Вариант | Почему нет |
|---|---|
| Отдельный корень `repos/` | Потребовал бы правок резолва проекта (`code-intelligence.ts:89-93`) и нового класса владения; отклоняется для v1. |
| Клон в произвольный пользовательский путь | Ломает единое правило путей, изоляцию `allowedRoots` и per-repo аудит/согласие (§8). |

## Consequences

- Одно правило путей для всех потребителей: code-intelligence, артефакты (§7.1: складка
  `projects/<slug>/dev-space/…`), freshness (§5.6) и очистка `removeRepository` (§5.5).
- Удаление записи каталога при подтверждении удаляет рабочий каталог и
  `code-intelligence/<bindingId>/`; запись в `audit.jsonl` (§8.4).
- Смена правила в будущем — миграция существующих проектов; в v1 изменения не предусмотрены.

## Ссылки на реализацию (контур В1)

- Транспорт клона/pull: `packages/server-core/src/devspace/clone.ts` (git через `execFile` с
  `AbortSignal` и длинным таймаутом, `GIT_ASKPASS` для токена, прогресс по фазам; не `shell:exec`).
- RPC-контур и каталог: `packages/server-core/src/handlers/rpc/dev-space.ts`
  (`devSpace:listRepositories|addRepository|startClone|refreshRepository|cancel`), server-owned
  `dev-space-repositories.json` под корнем workspace.