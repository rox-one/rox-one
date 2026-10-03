# RS-FORM-01 — Rox Forms: form builder, безопасная публикация и response-to-entity workflows

## Запрос и ожидаемый результат

Drive → Создать → Rox Forms; Base view → Form; Help Desk intake выбирает тот же renderer/submit contract.

Основание: пользовательские screenshots #5. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Verified seams содержат generic Pages artifacts и workspace event bus; полноценный Forms response/version domain нужно добавить.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [apps/electron/src/renderer/components/pages/PagesHome.tsx#L24-L109](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/pages/PagesHome.tsx#L24-L109) — PagesHome.
- [packages/core/src/rox2/platform-contract.ts#L16-L139](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L16-L139) — Rox2Entity / Rox2Permission.
- [packages/shared/src/automations/event-bus.ts#L224-L250](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/event-bus.ts#L224-L250) — WorkspaceEventBus.

## Экран и UI

- Builder: left question palette, centre editable orderedform, right questionproperties; top title/draft/publish/preview.
- Question types short/longtext, email, numeric/date, choice/multi-choice, attachment/entitypicker (latter internalonly). Branching preview and responsive publicrenderer.
- Responses tab table/count/date/filter/export and response drawer; submit success shows receipt/reference без чужих ответов.

## Inputs

- FormRevision immutable fieldIDs, required/min/max/options/conditional AST; submit payload pinned revision + idempotencyKey.
- Publication audience internal/scopedlink; expiration/maxsubmissions; public rate-limit/challenge; attachmentsize/type/scanpolicy.
- Optional mapping field→CustomRecord or HelpDeskTicket; authenticated contacts resolved only by verified matching, no arbitrary ownerId.

## Outputs

- Response ID/submittedAt/revision/validation errors; mapping result queued/succeeded/failed separately.
- Validated File attachments quarantined until scan; notification to configured recipients; workflow event response.submitted once.

## Hover / focus / click / keyboard / UX

- Hover palette gives purpose/example; click adds question at cursor; drag has keyboardreorder.
- Error summary focuses first invalid field; inline descriptions persistent; Enter in multiline не submits; disabled conditional fields excluded according to versioned schema.
- Publication confirmation includes audience and data retention. Closing preview does not publish. Cancelled submission retains localallowed draft, denial clears restricted fields.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Form — canonical kind=page, contentKind=form; Document означает payload, не новый ref/store. PageKind/CSP отдельно, исходные Page IDs/slug/grants сохраняются. Child FormRevision/Publication/Response получают явный schema/registry contract. Response inherits intake/private ACL; publication grants submit capability only, not responses.read. Reuse shared Attachment/Approval/Automation commands and entity links.

## Commands / API / DB / events

PROPOSED form.saveDraft/publish/submit/listResponses/mapResponse. Transaction response+outbox; retries use operationId, provider deliverystatus separate; public token hashed scopedexpiring with resource/actiongrant. Search responses only authorized reviewers; PII excluded from global indexing by policy.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `apps/electron/src/renderer/components/pages/PagesHome.tsx`, `packages/core/src/rox2/platform-contract.ts`, `packages/shared/src/automations/event-bus.ts`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `packages/shared/src/forms/contracts.ts`
- `apps/workspace-service/src/modules/forms/form-service.ts`
- `apps/electron/src/renderer/components/forms/FormBuilder.tsx`
- `tests/rox-suite/forms/intake.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Publish v1 → submit response → edit v2 → v1 response semantics preserved; reload lists authorizedresponse.
- [ ] Duplicate submit/retry yields one response and one mappedrecord; private response unavailable with submitlink.
- [ ] Conditionalrequired logic, spam throttle, unsafefile quarantine and failure UI tested; agent can draft schema but cannot read responses beyond grants.

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
Dependencies: RS-DRV-01, RS-BASE-01
- Related existing issue: https://github.com/rox-one/rox-one/issues/570
- Related existing issue: https://github.com/rox-one/rox-one/issues/569

## Complexity / риски

L/XL. Public intake abuse/PII retention, schema drift, uploads. No arbitrary script execution in condition/formula.
