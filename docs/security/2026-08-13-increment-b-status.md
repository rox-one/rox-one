# Статус Increment B — полномочия публичного обмена сообщениями

- **Дата:** 2026-08-13
- **Вердикт:** Задача 4 + Задача 5 + Задача 6 влиты. Increment B завершён на этом дереве.

## Задача 4 — явные режимы доступа

Устаревшие значения `open` / `inherit` / отсутствующие поля нормализуются в `public-inbox`. Новые привязки сохраняют `owner-control`. Неизвестные отправители не могут получить доступ к инструментам в результате миграции.

| Поверхность | Путь |
|---|---|
| Кодек режима | `packages/messaging-gateway/src/types.ts` |
| Оценщик | `packages/messaging-gateway/src/access-control.ts` |
| Перезапись хранилища | `packages/messaging-gateway/src/binding-store.ts` |
| Типы RPC | `packages/server-core/src/handlers/messaging-registry-interface.ts` |

## Задача 5 — public-inbox до сессий/инструментов

`Router.route()` и `Commands` отправляют статический ответ сопряжения и строку ожидающего отправителя. Они не вызывают `sessionManager.sendMessage` и не выполняют `/new`/`/bind`.

## Проверка (текущая сессия)

```text
bun test packages/messaging-gateway/src/__tests__/
# 224 pass / 0 fail  (full package)
bun test packages/messaging-gateway/src/__tests__/access-control.test.ts
         packages/messaging-gateway/src/__tests__/binding-store.test.ts
         packages/messaging-gateway/src/__tests__/router-access.test.ts
         packages/messaging-gateway/src/__tests__/commands-access.test.ts
         packages/messaging-gateway/src/__tests__/pairing.test.ts
```

## Задача 6 — интерфейс настроек

Элементы управления подписаны как Public inbox / Owner control / Disabled. Функция unlock-all удалена. Owner-control нельзя сохранить с пустым списком разрешений. Pending Allow применяется ровно к одному конкретному отправителю.

```text
bun test apps/electron/src/renderer/pages/settings/__tests__/MessagingSettingsPage.test.ts
         packages/messaging-gateway/src/__tests__/router-access.test.ts
         packages/shared/src/i18n/__tests__/locale-parity.test.ts
# 57 pass / 0 fail
```

## Остаётся заблокировано

- Increment C–F: отсутствуют факты по Gate 0
- Hermes A1–A3: нет `АПPLY HMA-20260809-A1`
