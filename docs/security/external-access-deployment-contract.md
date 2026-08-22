# Внешний доступ — контракт развёртывания Gate 0

- **Статус:** BLOCKED — факты отсутствуют. Этот файл является обязательным рабочим листом, а не заменой хранилища.
- **Дата:** 2026-08-13
- **Исходный дизайн:** `docs/superpowers/specs/2026-08-11-security-external-access-design.md`
- **Исходный план:** `docs/superpowers/plans/2026-08-11-security-external-access-implementation-plan.md`

Логические источники (только дизайн; развёртывание не подтверждено):

| Символ | Значение в дизайне | Подтверждённый владелец в продакшене |
|---|---|---|
| `APP_ORIGIN` | `app.rox.one` | **MISSING** |
| `SHARE_ORIGIN` | `share.rox.one` | **MISSING** |

Отклонены как хранилища DeviceRecord (план Gate 0): map в памяти, хранилище браузера, метаданные R2, общий пароль.

## Чек-лист Gate 0

| Факт | Статус | Свидетельство |
|---|---|---|
| Долговременное хранилище device-record с атомарным условным обновлением | **MISSING** | В дереве нет продакшен-адаптера `DeviceRecord`; тип существует только в плане |
| Эмитент capability share-management (aud=`share-management`) | **MISSING** | Только спецификация/план |
| Локальный подписант образов microVM + digest | **MISSING** | Дизайн требует изоляции класса Firecracker; `sandbox-exec` явно недостаточен |
| Центр секретов для подписания/нотаризации | **MISSING** | План запрещает самостоятельно размещённый `macos-toolchain` как границу подписания |
| Владение reverse-proxy + TLS-терминатор | **MISSING** | Не зафиксировано |
| Локальное для приложения хранилище enrollment SPKI pin | Partial design | Increment A может стартовать только на локальном Electron; записанные продакшен pin здесь не зафиксированы |

## Разрешённые следующие инкременты без этого контракта

- Increment A (строгий удалённый TLS + SPKI enrollment) — только против **локального** Electron/runtime.
- Increment B (публичный messaging authority) уже реализован локально.
- Connection Fabric CF-1 (уже реализован; только метаданные). См. верификацию ниже.

## Запрещено до заполнения этого контракта

- Increment C принудительное применение microVM
- Increment D device authority в WebUI
- Increment E публичное создание/отзыв share
- Increment F подписание защищённых релизов
- Любое утверждение, что Safe/Explore `transform_data` изолирован

## Требуемые действия владельца

Указать: (1) продукт хранилища device-record, (2) сборщик/подписант образов microVM, (3) кто владеет DNS для `APP_ORIGIN` / `SHARE_ORIGIN` и reverse proxy.
