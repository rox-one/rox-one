---
rx-id: RX-DOC-0023
title: Консолидированные задачи
status: active
---

# Консолидированные задачи (RX-DOC-0023)

Всего задач: **46**. В работе: **1**, Заблокировано: **5**, Готово: **19**, Отменено: **2**, Запланировано: **19**.

Блоки волн: 0100–0111 · 0300–0399 безопасность · 0400–0599 бэкапы · 0600–0699 сборка · 0700–0799 связи.

## Из аудита функций

| Код | Задача | Статус | Файл |
|-----|--------|--------|------|
| `RX-TSK-0100` | Активировать cloud-runs-conformance: задать секреты CLOUD_RUNS_* в settings репозитория | Запланировано | — |
| `RX-TSK-0101` | E2B: получить креды и добавить e2b-provider по образцу modal-provider | Запланировано | — |
| `RX-TSK-0102` | Подтвердить env CCI-проекта для craft-gateway-deploy (CLOUDFLARE_*, CLOUD_RUNS_TOKEN) | Запланировано | — |
| `RX-TSK-0103` | Disposition 15 локальных веток rox/* (native-серия): классифицировать и смержить/удалить | Готово | — |
| `RX-TSK-0104` | Удалить мёртвые ручки корневого package.json | Отменено | — |
| `RX-TSK-0105` | Обновить устаревший комментарий кодовой базы (repo-known-issues §2) | Отменено | — |
| `RX-TSK-0106` | Оформить операционные ограничения headless-сервера R1 в тикеты и документацию | Заблокировано | — |
| `RX-TSK-0107` | ACP/OMP v2: принять решение ADR и портировать клиент либо закрыть PRD | Запланировано | — |
| `RX-TSK-0108` | iOS: сборка и smoke на симуляторе, фиксация статуса | Запланировано | — |
| `RX-TSK-0109` | WebUI vs viewer: аудит назначения, запись вердикта в реестр поверхностей | Готово | — |
| `RX-TSK-0110` | Свести typecheck:all к зелёному — устранить довесок до включения rx-main | Готово | — |
| `RX-TSK-0111` | Перевести потребителей CONFIG_DIR на ленивый getConfigDir | Готово | — |
| `RX-TSK-0112` | UI-панель аудита OpenClaw (renderer) | Запланировано | — |

## Безопасность

| Код | Задача | Статус | Файл |
|-----|--------|--------|------|
| `RX-TSK-0300` | Перевести credentials.enc на мастер-ключ из OS-keychain | Готово | `packages/shared/src/credentials/backends/secure-storage.ts` |
| `RX-TSK-0301` | Выставлять chmod 0600 для credentials.enc.bak | Готово | `packages/shared/src/credentials/backends/secure-storage.ts` |
| `RX-TSK-0302` | Убрать печать CRAFT_SERVER_TOKEN в stdout по умолчанию | Готово | `packages/server/src/index.ts` |
| `RX-TSK-0303` | Fail-closed контракт PreToolUse-hook и canary-проверка при старте сессии | Запланировано | `packages/shared/src/agent/claude-agent.ts` |
| `RX-TSK-0304` | Сделать defaults.permissionMode обязательным в task-spec | Запланировано | `packages/server-core/src/tasks/TaskRunner.ts` |
| `RX-TSK-0305` | Egress-политика для канала server:invokeOnServer | Готово | `apps/electron/src/main/index.ts` |
| `RX-TSK-0306` | Перевести validateToken на timingSafeEqual | Готово | `packages/server-core/src/bootstrap/headless-start.ts` |
| `RX-TSK-0307` | Заменить bash -lc на bash -c с фиксированным PATH в host-bash | Запланировано | `packages/session-tools-core/src/handlers/host-bash.ts` |

## Из бэкапов сессий

| Код | Задача | Статус | Происхождение | Файл |
|-----|--------|--------|---------------|------|
| `RX-TSK-0400` | Перенести доводку инспектора Connection Fabric | Заблокировано | `session-recovery-20260821-craft-agents` | `apps/electron/src/renderer/pages/ConnectionsPage.tsx` |
| `RX-TSK-0401` | Дефолт-лейбл для сессий OMP-провайдера | Готово | `session-recovery-20260821-craft-agents` | `docs/omp-integration-gap.md` |
| `RX-TSK-0402` | Перенести платформу команд OMP фазы 0–7 | Запланировано | `session-recovery-20260821-craft-agents-cf2-restored` | `docs/omp-v2-prd.md` |
| `RX-TSK-0403` | UI контролируемой миграции credentials CF-2 | Запланировано | `session-recovery-20260821-craft-agents-cf2-restored` | `packages/shared/src/credentials` |
| `RX-TSK-0404` | Панель аудита OpenClaw | В работе | `session-recovery-20260821-craft-agents-cf2-restored` | `apps/electron/src/renderer/pages` |
| `RX-TSK-0405` | Решить судьбу и перенести rox-sidecar | Запланировано | `session-recovery-20260821-marklindgreen` | `packages` |
| `RX-TSK-0406` | Перенести WP-UI поверхности закрытого цикла | Запланировано | `session-recovery-20260821-marklindgreen` | `apps/electron` |
| `RX-TSK-0407` | Перенести command.approve и command.deny | Запланировано | `session-recovery-20260821-marklindgreen` | `packages` |
| `RX-TSK-0408` | Перенести session intelligence W1–W5 | Запланировано | `session-recovery-20260821-do-it-all-security-slices` | `apps/electron/src/renderer` |
| `RX-TSK-0409` | Удержать PSI W6–W8 за гейтом | Запланировано | `session-recovery-20260821-do-it-all-security-slices` | `apps/electron/src/renderer` |
| `RX-TSK-0410` | Убрать credentialValue из identity.connect | Заблокировано | `session-recovery-20260821-do-it-all-security-slices` | `packages/server-core/src/handlers/rpc/identity.ts` |
| `RX-TSK-0411` | Сделать UI импорта Notes | Запланировано | `session-recovery-20260821-do-it-all-security-slices` | `apps/electron/src/renderer/pages/NotesPage.tsx` |
| `RX-TSK-0412` | Довести OwnedRootPolicy | Готово | `session-recovery-20260821-do-it-all-security-slices` | `packages/shared/src/config/paths.ts` |
| `RX-TSK-0413` | Исправить clone URL в README | Готово | `session-recovery-20260821-do-it-all-security-slices` | `README.md` |
| `RX-TSK-0414` | Перенести корпус docs/security | Готово | `session-recovery-20260821-do-it-all-security-slices` | `docs` |
| `RX-TSK-0415` | Origin-scoped remote TLS | Готово | `session-recovery-20260821-security-external-access-20260811` | `apps/electron/src/main/handlers/workspace.ts` |
| `RX-TSK-0416` | Default-deny для публичного messaging | Запланировано | `session-recovery-20260821-security-external-access-20260811` | `packages/messaging-gateway/src/types.ts` |
| `RX-TSK-0417` | Подтверждение владельца перед transform_data | Готово | `session-recovery-20260821-security-external-access-20260811` | `packages` |
| `RX-TSK-0418` | Изоляция исполнения в microVM | Заблокировано | `session-recovery-20260821-security-external-access-20260811` | `packages` |
| `RX-TSK-0419` | Pairing устройств, SHARE_ORIGIN и подписанные релизы | Запланировано | `session-recovery-20260821-security-external-access-20260811` | `docs` |
| `RX-TSK-0420` | Собрать факты Gate 0 у владельца | Заблокировано | `session-recovery-20260821-do-it-all-security-slices` | `docs` |

## Сборка и CI

| Код | Задача | Статус | Файл |
|-----|--------|--------|------|
| `RX-TSK-0600` | Настроить автобилд репозитория | Готово | `Dockerfile.build` |
| `RX-TSK-0601` | Зафиксировать контракт сборочных секретов | Готово | `docs/ru/RX-DOC-0005-build.md` |

## Связи репозиториев

| Код | Задача | Статус | Файл |
|-----|--------|--------|------|
| `RX-TSK-0700` | Слинковать приватные смежные репозитории как сабмодули | Готово | `.gitmodules` |
| `RX-TSK-0701` | Написать валидатор системы кодов RX-* | Готово | `scripts/rx-validate.ts` |

