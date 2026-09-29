# План исследования и владельцы

| ID | Владелец | Вход | Зависимости | Артефакт | Проверка | Статус |
|---|---|---|---|---|---|---|
| baseline | lead | GitHub HEAD, local worktrees | — | fixed SHA, clean audit trees | rev-parse, status | complete |
| rox-audit | rox_audit | ROX baseline | baseline | 03 + evidence-rox | paths/symbols; mechanisms beyond routes | complete |
| collab-audit | macro_collab | Macro baseline | baseline | 07–09,14–16 + evidence | handlers/schema/front paths, four sequences | complete |
| domains-audit | macro_domains | Macro baseline | baseline | 10–13,17 + evidence | CRM/mail/calendar/call lifecycle | complete |
| root-audit | lead | manifests/routes/license/history | baseline | 01,02,18 + source graph | manifest resolved edges; license scope | complete |
| architecture | lead | all audits | rox-audit,collab-audit,domains-audit,root-audit | 00,04–06,19–23 + four JSON | exact ROX seams; slices cover scenarios | complete |
| challenge | independent reviewer | integrated draft | architecture | adversarial findings | supported counterexamples, Revision 2 | complete |
| delivery | lead | final documents | challenge | validation report, commit, remote branch | DAG/schema/refs/paths/required coverage | complete |

Стратегии сравнения: копирование Macro services (лицензионный и эксплуатационный риск); отдельное Macro приложение (не удовлетворяет цели); расширение native ROX через существующий Rox2 seam и единый domain authority (основной кандидат). Уточненные tradeoffs и окончательное решение — в 19.

Исследование завершено: 52 WPs / 154 edges, 38 surfaces / 162 capabilities / 38 entity mappings; Revision 2 и domain amendments интегрированы. 104 schemas, 30 diagrams, 612 commit source links, 308 evidence records, 7 rejected negative controls проходят artifact validator. Product runtime tests — NOT_RUN, future gates в22. Git delivery receipt фиксируется completion checkpoint после push/readback.
