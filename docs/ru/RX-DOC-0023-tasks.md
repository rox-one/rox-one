---
rx-id: RX-DOC-0023
title: Консолидированные задачи
status: active
---

# Консолидированные задачи (RX-DOC-0023)

Всего задач: **53**. В работе: **3**, Заблокировано: **6**, Готово: **25**, Отменено: **2**, Запланировано: **17**.

Блоки волн: 0100–0111 · 0300–0399 безопасность · 0400–0599 бэкапы · 0600–0699 сборка · 0700–0799 связи · 0800–0899 harness.

## Из аудита функций

| Код | Задача | Статус |
|-----|--------|--------|
| `RX-TSK-0100` | Активировать cloud-runs-conformance: задать секреты CLOUD_RUNS_* в settings репозитория | Запланировано |
| `RX-TSK-0101` | E2B: получить креды и добавить e2b-provider по образцу modal-provider | Запланировано |
| `RX-TSK-0102` | Подтвердить env CCI-проекта для craft-gateway-deploy (CLOUDFLARE_*, CLOUD_RUNS_TOKEN) | Запланировано |
| `RX-TSK-0103` | Disposition 15 локальных веток rox/* (native-серия): классифицировать и смержить/удалить | Готово |
| `RX-TSK-0104` | Удалить мёртвые ручки корневого package.json | Отменено |
| `RX-TSK-0105` | Обновить устаревший комментарий кодовой базы (repo-known-issues §2) | Отменено |
| `RX-TSK-0106` | Оформить операционные ограничения headless-сервера R1 в тикеты и документацию | Заблокировано |
| `RX-TSK-0107` | ACP/OMP v2: принять решение ADR и портировать клиент либо закрыть PRD | Запланировано |
| `RX-TSK-0108` | iOS: сборка и smoke на симуляторе, фиксация статуса | Запланировано |
| `RX-TSK-0109` | WebUI vs viewer: аудит назначения, запись вердикта в реестр поверхностей | Готово |
| `RX-TSK-0110` | Свести typecheck:all к зелёному — устранить довесок до включения rx-main | Готово |
| `RX-TSK-0111` | Перевести потребителей CONFIG_DIR на ленивый getConfigDir | Готово |
| `RX-TSK-0112` | UI-панель аудита OpenClaw (renderer) | Готово |

## Безопасность

| Код | Задача | Статус |
|-----|--------|--------|
| `RX-TSK-0300` | Перевести credentials.enc на мастер-ключ из OS-keychain | Готово |
| `RX-TSK-0301` | Выставлять chmod 0600 для credentials.enc.bak | Готово |
| `RX-TSK-0302` | Убрать печать CRAFT_SERVER_TOKEN в stdout по умолчанию | Готово |
| `RX-TSK-0303` | Fail-closed контракт PreToolUse-hook и canary-проверка при старте сессии | В работе |
| `RX-TSK-0304` | Сделать defaults.permissionMode обязательным в task-spec | Готово |
| `RX-TSK-0305` | Egress-политика для канала server:invokeOnServer | Готово |
| `RX-TSK-0306` | Перевести validateToken на timingSafeEqual | Готово |
| `RX-TSK-0307` | Заменить bash -lc на bash -c с фиксированным PATH в host-bash | Запланировано |

## Из бэкапов сессий

| Код | Задача | Статус | Происхождение |
|-----|--------|--------|---------------|
| `RX-TSK-0400` | Перенести доводку инспектора Connection Fabric | Заблокировано | `session-recovery-20260821-craft-agents` |
| `RX-TSK-0401` | Дефолт-лейбл для сессий OMP-провайдера | Готово | `session-recovery-20260821-craft-agents` |
| `RX-TSK-0402` | Перенести платформу команд OMP фазы 0–7 | Запланировано | `session-recovery-20260821-craft-agents-cf2-restored` |
| `RX-TSK-0403` | UI контролируемой миграции credentials CF-2 | Запланировано | `session-recovery-20260821-craft-agents-cf2-restored` |
| `RX-TSK-0404` | Панель аудита OpenClaw | В работе | `session-recovery-20260821-craft-agents-cf2-restored` |
| `RX-TSK-0405` | Решить судьбу и перенести rox-sidecar | Заблокировано | `session-recovery-20260821-marklindgreen` |
| `RX-TSK-0406` | Перенести WP-UI поверхности закрытого цикла | Запланировано | `session-recovery-20260821-marklindgreen` |
| `RX-TSK-0407` | Перенести command.approve и command.deny | Готово | `session-recovery-20260821-marklindgreen` |
| `RX-TSK-0408` | Перенести session intelligence W1–W5 | Запланировано | `session-recovery-20260821-do-it-all-security-slices` |
| `RX-TSK-0409` | Удержать PSI W6–W8 за гейтом | Готово | `session-recovery-20260821-do-it-all-security-slices` |
| `RX-TSK-0410` | Убрать credentialValue из identity.connect | Заблокировано | `session-recovery-20260821-do-it-all-security-slices` |
| `RX-TSK-0411` | Сделать UI импорта Notes | Готово | `session-recovery-20260821-do-it-all-security-slices` |
| `RX-TSK-0412` | Довести OwnedRootPolicy | Готово | `session-recovery-20260821-do-it-all-security-slices` |
| `RX-TSK-0413` | Исправить clone URL в README | Готово | `session-recovery-20260821-do-it-all-security-slices` |
| `RX-TSK-0414` | Перенести корпус docs/security | Готово | `session-recovery-20260821-do-it-all-security-slices` |
| `RX-TSK-0415` | Origin-scoped remote TLS | Готово | `session-recovery-20260821-security-external-access-20260811` |
| `RX-TSK-0416` | Default-deny для публичного messaging | Запланировано | `session-recovery-20260821-security-external-access-20260811` |
| `RX-TSK-0417` | Подтверждение владельца перед transform_data | Готово | `session-recovery-20260821-security-external-access-20260811` |
| `RX-TSK-0418` | Изоляция исполнения в microVM | Заблокировано | `session-recovery-20260821-security-external-access-20260811` |
| `RX-TSK-0419` | Pairing устройств, SHARE_ORIGIN и подписанные релизы | Готово | `session-recovery-20260821-security-external-access-20260811` |
| `RX-TSK-0420` | Собрать факты Gate 0 у владельца | Заблокировано | `session-recovery-20260821-do-it-all-security-slices` |

## Порт DSH-harness (`RX-EPC-0001`, ветка `rox/session-harness-port`)

| Код | Задача | Статус |
|-----|--------|--------|
| `RX-TSK-0800` | H0 — ADR, спека, реестр, H-04 спокойная миграция | В работе |
| `RX-TSK-0801` | H1 — инспектор сессии (files/git/browser); терминал = SurfaceTab UEW | Запланировано |
| `RX-TSK-0802` | H2 — хром чата (история ввода, прогресс, cost, notify, editor) | Запланировано |
| `RX-TSK-0803` | H3 — интеллект агента (context, MCP lens, fallbacks, auto-review) | Запланировано |
| `RX-TSK-0804` | H4 — единый Extension Center | Запланировано |
| `RX-TSK-0805` | H5a импорт P0 в Rox-сессии; H5b advisor/simplify/workflow | Запланировано |
| `RX-TSK-0806` | H6 — freeze skip-list и closeout | Запланировано |

