# RX-SPC-0021. Порт возможностей DSH-harness в Rox One

- **Doc ID:** RX-SPC-0021
- **Статус:** Implemented on `origin/main` (H0–H6; флаги default false; PR #72 + follow-ups #81/#82/#201/#207/#209/#275)
- **Дата:** 2026-09-10
- **Ветка:** `rox/session-harness-port` (историческая; волны слиты)
- **ADR:** [RX-ADR-0019](../../architecture/adr/0019-session-harness-capability-port.md)
- **Русский конспект:** [RX-DOC-0034](../../ru/RX-DOC-0034-session-harness-port.md)
- **Эпик:** `RX-EPC-0001`
- **Не заменяет:** Suite S (`docs/specs/2026-08-07-unified-shell/`), UEW (`docs/specs/2026-08-25-unified-execution-workbench/` на `origin/main`), ADR-0001

---

## Порядок чтения

| Файл | Содержание |
|---|---|
| [README.md](./README.md) | Этот индекс |
| [00-overview.md](./00-overview.md) | Решение, геометрия, куда сажать фичи |
| [01-capability-map.md](./01-capability-map.md) | Все 29 установленных DSH-плагинов → `reuse` / `extend` / `port` / `skip` |
| [02-waves.md](./02-waves.md) | Волны H0–H6, файлы, флаги, DoD |
| [03-anti-goals.md](./03-anti-goals.md) | Что запрещено копировать из DSH |
| [04-calm-migration.md](./04-calm-migration.md) | Пререквизиты, хост Desktop ≠ плагины, контракт импорта, порядок включения |
| [05-history-disposition.md](./05-history-disposition.md) | Каталог #92: что слито vs не merge |

Нормативны ADR-0019 и 01/02/03/04. README не дублирует таблицы.

## Одна формула

```
DSH community plugin  →  capability  →  Rox contribution
                                         (Panel / Surface / Skill / Source /
                                          Automation / Status item)
```

Пакет npm, Cordis и процесс DSH Desktop в продукт **не входят**.
