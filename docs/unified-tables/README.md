# ROX Unified Tables

Общий epic: [#1295](https://github.com/rox-one/rox-one/issues/1295). Draft PR: [#1314](https://github.com/rox-one/rox-one/pull/1314). UTB задачи #1296–#1312 дополняют существующие Bases/Docs/Automation LSX packages, не создают вторые владельцы данных.

## Текущая спецификация: ревизия2, 30.09.2026

Охват расширен с трёх основных origins до **23 точек интеграции**: в том числе коллекции и тело Notes, комментарии, Sessions, CRM/Dossier, Tasks/Projects, Mail/Feed, Meetings/Calendar, Files, Agents/Memory, Home/Dashboard, Canvas, Pages/Forms и people/org. Это целевой scope, не заявление работающей интеграции всех23 hosts.

- [PRD v2 — полный охват, проверенные source seams, требования и сценарии](PRD-V2.md).
- [Техническая спецификация v2 — host/source adapters, property catalog, Records/Sheet, formulas, cell rules, UI](TECH-SPEC-V2.md).
- [Implementation plan v2 — волны, конкретные файлы, зависимости и дельты всех UTB issues](IMPLEMENTATION-PLAN-V2.md).
- [Verification gates v2 —11 барьеров, native readback, UI/ACL/recovery, воспроизводимые performance budgets](VERIFICATION-GATES-V2.md).

V2 расширяет старые документы. В части охвата, вычислений и приёмки приоритет имеет V2; прежние14 групп референса и требования безопасности/сохранности не отменены. Каталог объединяет разрешённые описания свойств, grid работает через canonical owners, формулы отделены от внешних действий. Baserow — референс поведения, не автоматический импорт сервера/кода или его тарифных ограничений.

## Что уже реализовано и что ещё нет

Первый кодовый срез `a428eb42c5681adb15d97dcacc88ce45cef7e7a4`: `@rox/core/bases`, reference-only TableSurface v1, строгий codec, пять исходных host kinds, source/query keys, availability metadata и тесты. Новых зависимостей нет. Availability helper не является server authorization.

Это **не** готовый пользовательский table engine. Base persistence, typed rows, native owner adapters, редакторы, комментарии, расширенные formulas/grid, real workflow/mail/CRM integrations и product E2E ещё требуют исполнения плана. PR остаётся отдельным draft; main и посторонние WIP-ветки этой ревизией не изменяются.

В ревизии2 опубликованы уточнённые требования и source audit. Product/native/provider/performance gates v2 NOT_RUN. Исторические54 unit tests первого codec не относятся к новым требованиям и не закрывают их.

## Исторические документы и доказательства первого среза

- [PRD v1 —14 групп возможностей референса](PRD.md).
- [Техническая спецификация v1](TECH-SPEC.md).
- [Первоначальный план](../superpowers/plans/2026-09-30-unified-tables.md).
- [Исторический отчёт о проверках первого codec и ограничениях окружения](VERIFICATION.md).
- [Исходный машиночитаемый backlog v1](../../plans/unified-tables/backlog.json) — не актуальная матрица покрытия23 surfaces.

## Команда проверки первого среза

```sh
node --experimental-strip-types --test packages/core/src/bases/__tests__/*.test.ts
```

В исходном VERIFICATION зафиксированы54 теста на Node22.16.0. Это исторический результат, не повторный запуск текущей ревизии. Bun/full-repository typechecks/Electron/provider checks требуют полного checkout и соответствующего окружения; isolated Node command их не заменяет. До завершения gates нельзя объявлять полную интеграцию или закрывать общий epic.
