# RS-AUT-05 — Automations: draft/publish versioning, guided tutorial и шаблон Scheduler → DateTime → Connector

## Запрос и ожидаемый результат

Automation editor header name/version/«Есть неопубликованные изменения» → Debug / «Опубликовать»; «Обучение» launches dismissible walkthrough.

Основание: пользовательские screenshots #8. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Existinggraphsave commits canonicalruntimeconfig; no assumed separatedpublishedgraph. Add explicitdraft/published lifecycle with compatible migration, preserve users existingconfig.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [packages/shared/src/automations/graph.ts#L34-L66](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/graph.ts#L34-L66) — AutomationGraphProjection / baseRevision.
- [packages/shared/src/automations/default-seed-template.ts#L11-L25](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/default-seed-template.ts#L11-L25) — buildDefaultSchedulerPromptSeed.
- [apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx#L96-L110](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx#L96-L110) — save.
- [packages/shared/src/automations/default-seeds.ts#L509-L554](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/default-seeds.ts#L509-L554) — ensureDefaultAutomations.

## Экран и UI

- Header Russian title editable, lastsavedtime, draftdiffbadge; right overflow / Debug / Publish. Reviewdialog diff/trigger/audience/account/scopes/effects and requiredchecks.
- Tutorial anchored nonmodal card step1/7: addconnector; next highlights valid «+», no auto auth/effect; Quit/expand/help alwaysavailable.
- Template explains Scheduler → DateTimeHelper → CreateTask (safe syntheticworkspace); real Mail send template requires deliberateconfiguredscope.

## Inputs

- Draft baseRevision/publishedRevision; tutorialprogress local peruser/version; publication actor andpolicy grant.
- Publish reviewed immutablecompiledgraph checksum + validationreport; futureactivate time optional.

## Outputs

- Publishedrevision+activationreceipt; running jobs keep pinnedoldrevision. Draftversion separate and persisted reload.
- Tutorial completion progress only, neverlaunchflag. Samplegraph saved in explicit tutorialworkspace/no fakeproviderconnected.

## Hover / focus / click / keyboard / UX

- Hover publish explains blockers; disabledstate lists exactinvalidnode; focus moves to firstdiagnostic onvalidationfailure.
- Click Debug retainsdraft, doesnotpublish; closingreview leavesdraft; explicitPublish revalidatesCAS/policy.
- Tutorial clicks normalcontrols, handles resizefocus/reducedmotion, resumes sameversion or resetsafterincompatiblechanges.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Использовать Draft/PublishedRevision authority и legacy cutover, уже реализованные RS-AUT-01. Этот issue добавляет diff/review/publication UX, rollback UI и tutorial, не вторую таблицу/миграцию/scheduler. Tutorial metadata не запускает effects.

## Commands / API / DB / events

PROPOSED workflow.saveDraft/compareRevision/publish/deactivate; immutable revisions, publish authorization and event workflow.published. Scheduler subscribesactivepublishedrevision; publish transaction+outbox; rollout includes rollback to auditedpriorrevision.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `packages/shared/src/automations/graph.ts`, `packages/shared/src/automations/default-seed-template.ts`, `apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx`, `packages/shared/src/automations/default-seeds.ts`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `apps/electron/src/renderer/components/automations/PublishReviewDialog.tsx`
- `apps/electron/src/renderer/components/automations/AutomationTutorial.tsx`
- `tests/rox-suite/automations/publish.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Editdraft → reload → diff → publish → eventusesnewrevision; previousrun staysold; stalepublish rejected.
- [ ] Debug/tutorial/closingmodal neveractivatesworkflow; tutorialquit restoresfocusandnormalcontrols.
- [ ] Importlegacyenabledautomation preservessemanticswithmigrationreceipt; rollback auditableanddoesnotreplaycompletedexternalwrites.

## Definition of Done

- [ ] UI/routing/input/output/help/keyboard/state contracts реализованы; loading/empty/error/denied/retry доступны и проверены.
- [ ] Persistence и reload; meaningful negative case; concurrency/reconnect где применимо; N/A обоснован в receipt.
- [ ] Общие grants, links, search, mentions, activity, notification и agent policy интегрированы для новой domain entity.
- [ ] Targeted tests + seeded broken control действительно отклоняется; regression existing route/authority пройдена.
- [ ] Linux domain/renderer evidence; реальные Electron screenshots/ARIA/theme/font после UI changes; provider lane только для реальных external effects.
- [ ] Source commit, exact diff, logs/hashes, expected/observed, миграция/rollback и независимое review приложены. Нельзя принимать экран без механизма.

## Cloud handoff

Статус: PLANNED_NOT_IMPLEMENTED / PREPARED_NOT_LAUNCHED. Работать в отдельном branch/worktree от exact inputSha, один writer на файл. Reference: cloud/macro-integration/EXECUTOR-CONTRACT.md; сначала согласовать новый RS scope/packet с scheduler, существующий 52-WP manifest не автоматически включает эту задачу. Proofs домена, browser, native и provider — отдельные lanes, только actual PASS.

## Dependencies / связанные issues

<!-- ROX-SUITE-LINKS -->
Dependencies: RS-AUT-01, RS-AUT-02, RS-AUT-03, RS-AUT-04
- Related existing issue: https://github.com/rox-one/rox-one/issues/569
- Related existing issue: https://github.com/rox-one/rox-one/issues/577

## Complexity / риски

L. Draft accidentallyenablingeffects, stale reviewerapproval, tutorial modifyingrealdata. Need exact effectpreview and syntheticfixtures.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-AUT-01 — #1096](https://github.com/rox-one/rox-one/issues/1096)
- Требуется [RS-AUT-02 — #1097](https://github.com/rox-one/rox-one/issues/1097)
- Требуется [RS-AUT-03 — #1098](https://github.com/rox-one/rox-one/issues/1098)
- Требуется [RS-AUT-04 — #1099](https://github.com/rox-one/rox-one/issues/1099)
- Связанный ранее созданный issue: [#569](https://github.com/rox-one/rox-one/issues/569)
- Связанный ранее созданный issue: [#577](https://github.com/rox-one/rox-one/issues/577)

Specification ID: RS-AUT-05. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
