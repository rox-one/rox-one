---
rx-id: RX-DOC-0033
title: Default-deny messaging — редизайн режимов доступа (к RX-TSK-0416)
status: active
---

# Default-deny для публичного messaging: режимы public-inbox / owner-control / disabled

## Текущее состояние (факты)

- `BindingAccessMode = 'inherit' | 'allow-list' | 'open'` (`messaging-gateway/src/types.ts:270`);
  воркспейс-уровень `PlatformAccessMode` с наследованием и legacy-фолбэком
  `'open'` для конфигов без поля (`types.ts:339-342`) — осознанная
  prod-непрерывность.
- Evaluator: `access-control.ts` — bot-sender silent-drop, `owner-only`,
  `allow-list`; `open` пропускает всех.
- Потребители: `gateway.ts`, `commands.ts`, `registry.ts`, UI
  `MessagingSettingsPage`, i18n-лейблы ×10.

## Целевая семантика (из RX-TSK-0416)

Три режима вместо трёх старых, default-deny по умолчанию:

| Новый | Смысл | Замещает |
|---|---|---|
| `disabled` | Бот не принимает сообщения вовсе (кроме owner-команд?) | — (новый) |
| `owner-control` | Только владельцы; все остальные — отказ | `owner-only`, `allow-list` (сужение) |
| `public-inbox` | Публичные отправители попадают в pending-inbox на решение владельца (через Command Gateway, RX-DOC-0032) вместо авто-роутинга | `open`, `inherit` |

Ключевое изменение поведения: **публичный отправитель больше никогда не
маршрутизируется автоматически** — только через inbox-подтверждение.

## Миграция сохранённых конфигов

| Было | Стало | Обоснование |
|---|---|---|
| `open` (workspace или binding) | `public-inbox` | Сохранить способность принимать новых, но за гейтом |
| `inherit` | `public-inbox` | Наследование упраздняется; дефолт системы — гейт |
| `allow-list` | `owner-control` + перенос `allowedSenderIds` в owners | Список допущенных ≈ расширение owners |
| `owner-only` | `owner-control` | Прямое соответствие |
| (отсутствует поле, legacy) | `public-inbox` | Default-deny по умолчанию |

Миграция — при загрузке конфига (нормализующая функция с журналированием
факта замены), без отдельного файла-версии.

## Evaluator-матрица (после)

- `disabled`: всё, кроме команд владельца → reject `mode-disabled`.
- `owner-control`: owner → allow; иначе reject `not-owner` (cooldown-reply).
- `public-inbox`: owner → allow; иначе → **pending-inbox record** + вежливый
  ответ «заявка отправлена владельцу» (новый verdict-тип `queued`, не reject).

## UI и i18n

- `MessagingSettingsPage`: селектор трёх режимов (лейблы + описания ×10
  локалей), удаление UI для `allowedSenderIds` (мигрируют в owners).
- Inbox-очередь: фаза 1 — переиспользовать CommandGatewaySection-паттерн
  (список + approve/deny), источник — pending-senders store.

## Не входит

Реальная отправка сообщений из inbox-очереди (фаза 1), антиспам-лимиты
сверх существующего cooldown, изменения протокола платформенных адаптеров.

## Критерии готовности

1. Ни один путь роутинга не допускает публичного отправителя мимо inbox.
2. Миграция покрывает все 5 legacy-состояний, тест на каждый.
3. Evaluator-матрица покрыта таблицей тестов (3 режима × owner/не-owner/bot).
4. UI-селектор и i18n синхронизированы ×10.
