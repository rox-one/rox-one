---
rx-id: RX-DOC-0025
title: Аудит заявленных функций
status: active
---

# Аудит заявленных функций (RX-DOC-0025)

Дата: 2026-08-22. Метод: сверка README и docs против кода (grep + точечное чтение); тесты не запускались.
Вердикты: **работает** — реализация и тесты; **частично** — реализация есть, есть пробел; **не работает** — заявлено, но не функционирует; **замысел** — существует лишь в документации.
Итого проверено: **32** функций. Работает: **23**, частично: **5**, не работает: **1**, замысел: **3**.

## Сводная таблица

| Код | Функция | Источник заявления | Вердикт | Тесты |
|-----|---------|--------------------|---------|-------|
| `RX-FEA-0001` | Research-раны: pack-модель, resume/cancel/параллельные сабтаски | docs/cloud-runs-features-spec.md F1-F3 | работает | да |
| `RX-FEA-0002` | Real research-раннер: multi-tool loop (6 rounds / 15 tool calls) | docs/cloud-runs-features-spec.md F4 | работает | да |
| `RX-FEA-0003` | Structured artifacts: schema-выход brief.json | docs/cloud-runs-features-spec.md F5 | работает | да |
| `RX-FEA-0004` | Scheduled runs + интеграция с Automations | docs/cloud-runs-features-spec.md F8 | работает | да |
| `RX-FEA-0005` | Публичные share-страницы по токену (mint/revoke) | docs/cloud-runs-features-spec.md F15 | работает | да |
| `RX-FEA-0006` | WS-стриминг прогресса прогонов (hibernation-safe) | docs/cloud-runs-features-spec.md W3/F14 | работает | да |
| `RX-FEA-0007` | Marp-слайды на Cloudflare | docs/cloud-runs-features-spec.md F16 | работает | — |
| `RX-FEA-0008` | Personas в ранах | docs/cloud-runs-features-spec.md F19-F22 | работает | да |
| `RX-FEA-0009` | Conformance CI workflow облачных прогонов | .github/workflows/cloud-runs-conformance.yml; спека F17 | частично | — |
| `RX-FEA-0010` | E2B-провайдер песочниц | docs/cloud-runs-features-spec.md F18 | замысел | — |
| `RX-FEA-0011` | OMP-runner внутри Cloudflare-контейнера | docs/cloud-runs-features-spec.md F21 | частично | — |
| `RX-FEA-0012` | Реестры поверхностей/панелей/режимов/команд Unified Shell | docs/specs/2026-08-07-unified-shell/ | работает | да |
| `RX-FEA-0013` | Омнибокс | docs/specs/2026-08-07-unified-shell/04-omnibox.md | работает | да |
| `RX-FEA-0014` | Extension Center: маркетплейс с подписью каталога | docs/specs/2026-08-07-unified-shell/05-extension-center.md | работает | да |
| `RX-FEA-0015` | Identity Center / Connection Fabric | docs/specs/2026-08-11-rox-connection-fabric | работает | да |
| `RX-FEA-0016` | Knowledge P1-P7: провайдер, writeback, distill, views, автоматизации | plans/branch-disposition.md (MERGED PR #4-#12) | работает | да |
| `RX-FEA-0017` | SiYuan-интеграция: контракт knowledge-provider, поверхности публикации | docs/specs/2026-08-07-siyuan-integration/ | работает | да |
| `RX-FEA-0018` | Mindmap | README Features | работает | да |
| `RX-FEA-0019` | Workgraph (Case/Action/Outcome) | packages/core identity | работает | да |
| `RX-FEA-0020` | Branch chat groups (дизайн-спека) | docs/specs/2026-08-06-branch-chat-groups-design.md | замысел | — |
| `RX-FEA-0021` | Toolchain Download Manager (11 инструментов, sha256) | docs/superpowers/specs/2026-08-06-toolchain-download-manager-design.md | работает | да |
| `RX-FEA-0022` | Runtime-context marketplace | docs/runtime-context-marketplace-prd.md | работает | да |
| `RX-FEA-0023` | Messaging: gateway + Discord/WhatsApp workers | packages/messaging-* | работает | да |
| `RX-FEA-0024` | Modal gateway | apps/modal-gateway | работает | да |
| `RX-FEA-0025` | Headless remote server (токен, TLS, CLI-подключение) | README Remote Server; docs/repo-known-issues.md §3 | работает | да |
| `RX-FEA-0026` | Electron desktop (вибранность, окна, IPC) | README Desktop App Features | работает | да |
| `RX-FEA-0027` | iOS-приложение (CraftAgentKit + CraftAgentsApp) | apps/ios/README.md | частично | — |
| `RX-FEA-0028` | CLI-клиент (self-contained, JSON, pipe) | README CLI Client | работает | да |
| `RX-FEA-0029` | WebUI как самостоятельная поверхность (отличная от viewer/share) | apps/webui | частично | — |
| `RX-FEA-0030` | Native substrate на Rust | docs/specs/2026-08-12-native-substrate/ | частично | — |
| `RX-FEA-0031` | Мёртвые ручки корневого package.json | docs/repo-known-issues.md §Root dead knobs | работает (устранено, tickets 08/16) | — |
| `RX-FEA-0032` | ACP/OMP v2 мост агентов | docs/omp-v2-prd.md | замысел | — |

## Что нужно, чтобы заработало

### `RX-FEA-0009` — Conformance CI workflow облачных прогонов
- Задать секреты репозитория CLOUD_RUNS_TOKEN, CLOUD_RUNS_MODAL_GATEWAY_URL, CLOUD_RUNS_CLOUDFLARE_GATEWAY_URL — workflow активируется автоматически

### `RX-FEA-0010` — E2B-провайдер песочниц
- Получить креды E2B и реализовать provider по образцу cloudflare-provider.ts / modal-provider.ts

### `RX-FEA-0011` — OMP-runner внутри Cloudflare-контейнера
- Подтвердить user-managed env CCI проекта: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUD_RUNS_TOKEN — ежедневный cron уже настроен

### `RX-FEA-0020` — Branch chat groups (дизайн-спека)
- Либо портировать реализацию из донорской истории, либо закрыть спеку ADR-решением

### `RX-FEA-0027` — iOS-приложение (CraftAgentKit + CraftAgentsApp)
- Собрать и прогнать smoke на симуляторе; зафиксировать статус в доке

### `RX-FEA-0029` — WebUI как самостоятельная поверхность (отличная от viewer/share)
- Провести аудит назначения webui vs viewer, зафиксировать вердикт в реестре поверхностей

### `RX-FEA-0030` — Native substrate на Rust
- Разобрать 15 веток rox/native-* по методике plans/branch-disposition.md: ревью → merge/delete

### `RX-FEA-0031` — Мёртвые ручки корневого package.json (задокументировано)
- Удалить неработающие скрипты-ручки из корневого package.json согласно известному списку

### `RX-FEA-0032` — ACP/OMP v2 мост агентов
- Портировать ACP-клиент (наработка skills/consult/acp) либо закрыть PRD решением ADR

## Незавершённые сессии

### Локальные ветки без merge (15 шт.)

`git branch --no-merged main`: extension-broker, fabric-fail-closed, host-bash-sandbox, host-tool-bash-omp, journal-primary-pi-bash, native-docs-status, native-exec-cwd, native-health-check, native-index-cap, native-index-incremental, native-index-status, native-index-watch, native-provider-exec, native-sidecar-settings, native-toolchain.

Классификация по методике `plans/branch-disposition.md` вынесена в задачу `RX-TSK-0103`. Серия `native-*` соответствует активной спеке native-substrate (`RX-FEA-0030`).

### Расхождение с origin

- `main` впереди `origin/main` на 31 коммит и позади на 2 (на момент начала волны); синхронизация — отдельным решением.

## Сводный список задач

| Код | Задача | Связана с |
|-----|--------|-----------|
| `RX-TSK-0100` | Активировать cloud-runs-conformance: задать секреты CLOUD_RUNS_* в settings репозитория | `RX-FEA-0009` |
| `RX-TSK-0101` | E2B: получить креды и добавить e2b-provider по образцу modal-provider | `RX-FEA-0010` |
| `RX-TSK-0102` | Подтвердить env CCI-проекта для craft-gateway-deploy (CLOUDFLARE_*, CLOUD_RUNS_TOKEN) | `RX-FEA-0011` |
| `RX-TSK-0103` | Disposition 15 локальных веток rox/* (native-серия): классифицировать и смержить/удалить | — |
| `RX-TSK-0104` | Удалить мёртвые ручки корневого package.json | `RX-FEA-0031` |
| `RX-TSK-0105` | Обновить устаревший комментарий кодовой базы (repo-known-issues §2) | — |
| `RX-TSK-0106` | Оформить операционные ограничения headless-сервера R1 в тикеты/документацию | — |
| `RX-TSK-0107` | ACP/OMP v2: принять решение ADR и портировать клиент либо закрыть PRD | `RX-FEA-0032` |
| `RX-TSK-0108` | iOS: сборка и smoke на симуляторе, фиксация статуса | `RX-FEA-0027` |
| `RX-TSK-0109` | WebUI vs viewer: аудит назначения, запись вердикта в реестр поверхностей | `RX-FEA-0029` |

