---
rx-id: RX-DOC-0032
title: Платформа команд — фаза 0 (дизайн к RX-TSK-0402/0407)
status: active
---

# Command Gateway, фаза 0: restart-safe хранилище команд и approve/deny

## Контекст

- Источник переноса для approval-flow (коммит `d48efe66`) недоступен — бэкенд
  строится с нуля (см. note в RX-TSK-0407).
- Протокол и точка отсчёта интеграции зафиксированы в `docs/upstream/omp/`.
- UI уже существует в recovery: `AdminApprovalRequest.tsx` ожидает данные
  `{ appName, reason, command, impact?, requiresSystemPrompt?,
  rememberForMinutes? }` и колбэки `onApprove({rememberForMinutes}) /
  onCancel` — контракт данных фазы 0 обязан ему соответствовать.

## Модель данных: PendingCommand

```ts
interface PendingCommand {
  id: string                    // 'cmd-' + randomUUID, одноразовый
  workspaceId: string           // изоляция как у openclaw-хендлеров
  source: 'task-runner' | 'messaging' | 'session'
  appName: string               // проекция на AdminApprovalRequest
  command: string
  reason: string
  impact?: string
  requiresSystemPrompt?: boolean
  createdAt: number
  expiresAt: number             // TTL по умолчанию 10 мин
  status: 'pending' | 'approved' | 'denied' | 'expired'
  decidedBy?: string            // кто решил (owner id / 'auto-expiry')
  decidedAt?: number
}
```

## Хранилище: restart-safe

- Файл `{configDir}/command-gateway/pending.json` — атомарная запись через
  temp+rename (паттерн extension-url-allowlist).
- При старте: записи с `expiresAt < now` переводятся в `expired`; `approved`
  переживают рестарт — исполнитель добирает решение по id после подъёма.
- Объём: список активных команд мал (десятки), полная перезапись приемлема;
  при росте — ротация в журнал решённых.

## State machine

```
create → pending → approved → (исполнитель забирает) → [удалено]
                ↘ denied
pending → expired (TTL)
```

Одобрение с `rememberForMinutes` дополнительно пишет правило в permission-
store (существующий PermissionManager), чтобы следующие такие команды не
спрашивались.

## RPC-контракт (новые каналы)

| Канал | Вход | Выход | Права |
|---|---|---|---|
| `command:list` | `{ workspaceId }` | `PendingCommand[]` (только pending) | owner-only |
| `command.approve` | `{ workspaceId, id, rememberForMinutes? }` | `{ ok: true }` | owner-only |
| `command.deny` | `{ workspaceId, id }` | `{ ok: true }` | owner-only |
| `command.create` (внутр.) | без RPC — только из кода исполнителей | `PendingCommand` | n/a |

Авторизация повторяет паттерн `authorizeWorkspace` из openclaw-хендлеров
(проверка callerWorkspaceId, WORKSPACE_ID_PATTERN).

## Интеграционные точки

1. **TaskRunner**: перед диспетчем узла, требующего выхода за permissionMode,
   создавать команду вместо тихого `'allow-all'` (усиление RX-TSK-0304).
2. **Messaging**: публичные входящие → `public-inbox` (RX-TSK-0416) создаёт
   команду на владельца вместо автоответа.
3. **UI**: `AdminApprovalRequest` подписывается на `command:list`
   (poll или push-канал в фазе 1).

## Не входит в фазу 0

Push-уведомления владельцу, batch-операции, аудит-журнал решений
(достаточно поля decidedBy/decidedAt), интеграция с OMP.

## Критерии готовности фазы 0

1. Store переживает рестарт процесса: approved сохраняются, expired гасятся
   (юнит-тест с двумя «запусками» над одним каталогом).
2. Approve/deny работают через RPC с авторизацией воркспейса; чужой
   workspaceId → invalid request.
3. TTL-истечение покрывает и файл, и выдачу по list.
4. Контракт данных совместим с AdminApprovalRequest без правок того файла.
