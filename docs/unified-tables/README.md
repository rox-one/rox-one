# ROX Unified Tables

Общий epic: [#1295](https://github.com/rox-one/rox-one/issues/1295). Новые подробные задачи: #1296–#1312; зависимости на существующие LSX/ROX Suite issues перечислены в каждой задаче. Это дополнение к существующим Bases/Docs/Automation пакетам, не их повторная реализация.

## Документы

- [PRD: цели, пользовательские маршруты и 14 групп возможностей референса](PRD.md).
- [Техническая спецификация: ownership, данные, ACL, команды, workflows, миграции](TECH-SPEC.md).
- [План: зависимости, последовательность, файлы и проверочные gates](../superpowers/plans/2026-09-30-unified-tables.md).
- [Фактически выполненные проверки и ограничения](VERIFICATION.md).
- [Машиночитаемый backlog](../../plans/unified-tables/backlog.json).

## Что реализовано первым срезом

`@craft-agent/core/bases`: reference-only TableSurface v1, строгий codec, создание/перенос descriptor между пятью host kinds, canonical source/query keys, fail-closed availability metadata и тесты. Единственный изменённый существующий файл — additive export в core/package.json. Новых зависимостей нет.

Это НЕ готовый пользовательский table engine: Base persistence, typed rows, editor mounts, real workflows/mail/sync/providers и полный E2E остаются задачами плана. Availability helper не авторизует запросы. Main и существующие WIP-ветки не изменяются; пакет предназначен для отдельного draft PR.

## Быстрая проверка первого среза

```sh
node --experimental-strip-types --test packages/core/src/bases/__tests__/*.test.ts
```

На Node 22.16.0 проверено 54 теста. Bun/full-repository typechecks/Electron требуют полного checkout и окружения проекта; этот запуск их не заменяет. Детали и отрицательные контроли — в VERIFICATION.
