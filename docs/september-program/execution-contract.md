# Один контракт исполнения, десять исходных промптов

Общий исходный контракт и все десять промптов сохранены в [ten-prompts.md](ten-prompts.md). Их текст — входы программы, **не десять независимых полномочий переписать всё приложение**. Канонический порядок и atomic tasks: [docs/plan.md](../plan.md), [task-registry.json](task-registry.json). Публичные карточки и источники: [issue-index.md](issue-index.md).

## Привязка этапов

| Исходный промпт | Узлы/поток | Условие старта и результат |
|---|---|---|
| 1. Реестр и план | PROGRAM-01 → RECON-01; DECISION-01 | current source/branches/dirty snapshots, source→primary issue, conflicts/U25, active-owner disposition; не запускать весь backlog автоматически |
| 2. Полный аудит | AUDIT-01 → DATA-01 → SHARED-01 | реальные screens/data flows; 22 Settings pages; exact version/actions/evidence; 2–3 предложения на каждый экран отдельно от defects; freeze interfaces |
| 3. Последний UI | UX/DESIGN/ONBOARD/THEME/PROFILE/L10N/A11Y/SETTINGS | только последний источник требований; отдельный owner каждой атомарной карты, общие primitives/routes/locales меняет SharedIntegrator |
| 4. Runtime | AGENT-BUDGET/FOCUS/AUTOMATION/SCHEDULED/REMOTE/RUNTIME/BACKEND/CLI | реальные worker/provider эффекты; proposals scheduler/coordinator не становятся реализацией без disposition |
| 5. Voice/Meetings/Mac | VOICE/TRANSCRIPTIONS/MEETINGS/NATIVE | session STT и meeting Whisper отдельно; реальное слышимое playback/stop; microphone scope не разрешает скрытый system capture |
| 6. Projects/graph/Quest | PROJECTS/TASKS/NOTES/CANVAS/MEMORY/QUEST + остальные productivity tasks | одна canonical entity/model; связанные screens не создают свои дубли; local и shared authorities различаются |
| 7. Mail | MAIL-01/02 | постоянная локальная Mac mail система и внешняя доставка отдельно; реальный адресат/readback, без неразрешённого MX cutover |
| 8. Collaboration/integrations | CHAT/TEAMS/SYNC/COLLAB/INTEGRATIONS/SESSIONS | настоящий server membership, consent и durable delivery; два пользователя и denied third party; не fake roster/local-only queue |
| 9. Conation | CONATION-DELIVERY → AUTH → E2E и domain tasks U26 | отдельный repo/toolchain, все 16 checklist rows и подробные screens/controls; prepared Macro reuse rights-aware |
| 10. RMA/GG и финал | RMA/GG → INTEGRATE-01 → RELEASE-01 | существующие RMA/GG issues primary; E3 не заменяется U1/merge/smoke; full native/platform/provider/version matrix |

Подробные зависимости находятся в registry/самих issues, таблица выше лишь группирует исходные промпты. Ни один поток не заменяет atomic acceptance.

## Владение и расписание

1. ProgramLead владеет реестрами/приоритетами, SharedIntegrator — общими схемами, route/entity registries, RPC signatures, локалями/catalogs, lockfiles и общими UI primitives. Domain owner подаёт изменение shared file интегратору, не редактирует файл параллельно.
2. Каждая task entry содержит один accountable owner, зависимости, исходные координаты, file-boundary discovery gate, результат, конкретные проверки и DoD. До реализации RECON разрешает ≤3–5 фактических owned roots/files и актуального владельца. Не угадывать API или source seams.
3. Один domain owner выполняет свои overlapping tasks последовательно; независимые owners могут работать параллельно только после принятого SHARED revision и disjoint allowlists. Отдельный clean worktree на task, baseline head + приватный dirty overlay snapshot. Никакого reset/clean исходных пользовательских checkout.
4. Merge строго последовательно через ProgramLead/SharedIntegrator; exact consumed interface revision, no stale callers, no duplicate primary implementation. INTEGRATE зависит от каждой atomic task либо её явно принятой proposal/decision disposition.
5. Изменение code/evidence версии инвалидирует только затронутые proof rows. Каждый consumer-visible результат проверять в actual CLI/browser/native/provider surface, с отрицательными условиями, persistence/reload, ACL, relevant concurrency/recovery и соседней регрессией.

## Источники и решения

- Приоритет: последний прямой запрос → подтверждённые предыдущие требования → actual existing issue scope → historical claims. Сообщение бота о готовности не proof. U25 конфликтует и не разрешает переключать defaults.
- `requested` — обязательный source-backed результат; `verification-gap` — свежая проверка/остаток существующей реализации; `proposal-audit` — подробно описанный кандидат, не автоматическая реализация; `decision-reconciliation` — разрешение противоречия без самовольного product change.
- [61-screen/219-control register](screen-control-coverage.json) сохраняет все inherited Macro targets/constraints и owner по каждому control. Исходный proposal status сохранён. RECON сопоставляет exact independently requested scope; proposal не становится release blocker от факта присутствия в таблице. Принятые прямые требования не сокращаются до текущих capabilities.
- Existing #380/#381/#382/#385/#387/#389 и #541 children остаются primary implementations/gates. September cards — bounded residual/audit/acceptance coordination, не второй writer тех же контрактов. Запрещено автоматически переоткрывать/закрывать old issue по одному historical status.
- Conation/Macro код не копировать без license/provenance clearance; поведенческая реализация и документированные interfaces — безопасный default при неподтверждённых правах.

## Статус и завершение

Пакет требований/публикация и продуктовая программа — разные deliverables. Подготовка packet не заявляет запуск cloud workers, реализации приложения, E3 или multi-platform PASS. Для продукта критерий RELEASE: полный requested scope доказан на exact integrated revision, proposal/decision disposition сохранены; missing credentials/environment остаются явными BLOCKED/UNVERIFIED. Нельзя объявить программу принятой по успешной компиляции, smoke, mock, пустому экрану или merge вспомогательного harness.

Private packet включает точные источники, patches/untracked originals, hashes, attachment metadata и доступные binaries, repository/refs/disposition и recovery evidence. Public repository содержит только безопасные требования, источниковые координаты и execution artifacts. Секреты, личные данные и raw source export не публикуются.
