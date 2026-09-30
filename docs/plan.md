# План восстановления ROX

Обновлено: 2026-09-30. Ведущий сохраняет интеграцию и общение с пользователем.

| ID | Работа | Владелец | Зависимости | Артефакт/проверка | Состояние |
| --- | --- | --- | --- | --- | --- |
| R1 | Аудит Git, PR, issues, worktree, CI | repo_audit | Нет | Первичный и дополнительный time-bound reports | Завершён; финальный delivery readback отдельно |
| R2 | Аудит CMUX и сессий 28–30 сентября | terminal_history | Нет | surface/session/PID, исходные запросы, живой read-screen | Завершён; compound resume+native coordination semanticACK verified; olddaemon queues storedonly |
| R3 | Проверка вкладок и Codex Cloud | Ведущий | Нет | Опубликованная среда; main/snapshot/repaired419/450 actual runtime | Runtime450 verified; final report/cleanup завершены14:45UTC |
| R4 | Исправление трёх падений core | cloud_recovery | Воспроизведение, отсутствие конфликта владельцев | 817/0, core TS0, review, PR1292 exact head | Проверено и доставлено |
| R5 | Доставка сохранённого roadmap | repo_audit + terminal_history | R1/R2, проверка границ и тестов | 28/0, CAS/backup/UI review, draft1313 | Проверено и доставлено; full1194 open |
| R6 | Сводный реестр и проверка пробелов | Ведущий + независимый reviewer | R1/R2/R3 | `docs/session-recovery-20260930.md` | Выполняется |
| R7 | Commit/push, удалённое чтение и checkpoint | Ведущий | R4/R5/R6 | SHA, PR URLs, точные внешние зависимости | Ожидает |
| R8 | Source-only September snapshot | Ведущий | R2, стабильное двойное чтение source | 463 paths, manifest,0cc0402e remote | Доставлен; отдельный Cloud результат завершён |
| R9 | Host-control WebUI bridge | terminal_history + cloud_recovery | R8, reproduced3TS | Type-only5f0df252, WebUI0, draft1294 | Проверено и доставлено |
| R10 | SQLite Bun/Node runtime recovery | Ведущий + reviewers | R8/R9, actual startup failure | Final450; fouractual hosted Ubuntu/macOS jobs885/0+strict4/37 | Проверено и доставлено draft1315; fullprogram open |
| R11 | Main-based full CI recovery | terminal_history + cloud_recovery + repo_audit | R4, concrete baseline defects | Draft1317 source6cf/headbbb; validate:ci, strict lifecycle, source hash/readback | Verified/delivered; scoped hosted jobs SUCCESS; separate native/platform gates open |
| R12 | Новые UTB tasks reconciliation | Ведущий + repo_audit | R1 live addendum, browser continuation |1314 actual54Bun+54Node/closureTS0;16notexecuted | Проверено; narrowstrictnessrepair R14 |
| R13 | SQLite на текущей September publication | cloud_recovery + Ведущий | R10, exact native1293 source readback | Draft1319; exact079 merge,919/0,5types/3build/strict4/37, final four hosted jobs | Local rebind verified; merge delivery/hosted gates выполняются |
| R14 | Strict V1 UTB reference repair | repo_audit + terminal_history | R12 reproducedhiddenfields defect |18RED checks,72Bun+72Node,closure/export/mutationproof, draft1318 source4ba5/head8c1 | Verified/delivered; fullUTB/native gates open |
| R15 | Общая сборка UI + September + Compound | Действующий Cloud integrator; ведущий проверяет delivery | Exact published branches, semantic conflict map, R13 runtime recovery | Isolated integration, fullElectron target/type/build, realheader/sidebar/routes, restart/negative gates, commit/push/draft/readback | Подтверждённый старт15:12UTC;28 conflicts требуют согласования; source changes только isolated |

## Ограничения интеграции

- Compound и September программы имеют живых владельцев. Их незакоммиченные изменения сохраняются в исходных worktree.
- При восстановлении CI не заменять обязательные проверки фиктивными status. Регистрация нового runner требует отдельной проверки доступа; прежде исследовать существующие процессы и конфигурацию.
- Сохранённая облачная среда проверяется без расширения сети и без чтения секретов.
- Готовность определяется выполнением приёмки, а не количеством запущенных worker, экранов или тестовых команд.
