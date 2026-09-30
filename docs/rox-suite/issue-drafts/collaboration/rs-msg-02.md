# RS-MSG-02 — Human channels, DM, group threads: composer и durable read state

Реализовать один human Message/Channel домен: channels, DM/group, replies/threads, entity discussions, reactions, edits/tombstones, attachments, mentions/read state. Все human wrappers dispatch canonical message.create с общей ACL/outbox/idempotency authority.

## Current source evidence

Repository rox-one/rox-one; source SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Код — source of truth; screenshot не доказывает backend/API.

- [apps/electron/src/renderer/pages/ChatPage.tsx::ChatPage/useSessionData](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/ChatPage.tsx#L89-L172) — Chat привязан к Agent Session ID; не human Message domain.
- [packages/core/src/rox2/platform-contract.ts::Rox2EntityRef / formatRox2EntityId](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L218-L240) — workspaceId/entityId/revisionId/accountNamespace сохраняются как общая identity.
- [packages/core/src/rox2/platform-contract.ts::ROX2_ENTITY_KINDS](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L17-L40) — note/page/channel/channel-message/person — существующие kinds, не доказательство backend полноты.

Референс2 даёт header/member badge, hover reply/react/forward/bookmark и plus composer. BOT/external badges — trusted provenance/type, не отдельная identity.

## Экран, navigation и размеры

В RS-MSG-01 conversation header48px, transcript independent scroll, message max70ch/avatar28–32; toolbar controls24px/hitbox32. Thread inspector320–420px; narrow overlay/drilldown. Actions «Реакция / Ответить / Переслать / В избранное / Создать задачу». Forward disabled до signed export service. Retention из screenshot не становится фиксированным18month default: показывать configured policy.

## Controls и interactions

| Control / RU label | Input → Output | Hover / focus / help | Click / keyboard / failure |
|---|---|---|---|
| composer · «Сообщение» | draftId/body/parent/root?/mentions/FileRefs/commandId → MessageRef/receipt | Local vs remote save, audience/source help | Channel/DM Enter-send ShiftEnter-newline; configurable CmdEnter; entityDiscussion Enternewline/CmdEnter-send; IME/autocomplete consumesEnter |
| reply · «Ответить в треде» | root/currentACL → same-parent replies | Toolbar hover/focus без layout shift | ShiftF10 menu; Escape to root; deleted root tombstone |
| react · «Реакция» | message/emoji/actor → idempotent receipt/count | Emoji name/count source and a11y | Space picker/arrows; denied rollback |
| attach · «Прикрепить файл» | bytes/digest/parent → upload/scanning/ready FileRef | Size/type/progress; ready ≠ queued | Plus opens picker; retry parts same uploadId; malware error retains draft |
| edit/delete · «Изменить / Удалить» | own message/expectedRevision → edited revision/tombstone | Author/window policy help | Explicit delete confirm; conflict compare; no orphan replies |
| read · «Непрочитанные» | visible permitted cursor/principal → monotonic read cursor | Watermark/count freshness; no hover-read | Actually visible permitted view only; two-device cursor never regresses |
| forward · «Переслать» | source revision/audience/signed decision/digest → reviewed Message | Exact source/attachment audience preview | Changed recipients invalidate review; no private auto-forward |
| task · «Создать задачу» | source/manual title-body/assignee → Task+backlink | Wider audience default manual text + neutral backlink | sourceTransfer.kind backlink_only/approved_export; same commandId retry |

## Domain / API / storage / realtime / events / ACL

Channel aggregate: workspace/type/visibility/creator/membership. Message: canonical ref, parentRef, rootRef?, authorPrincipalId, bodyRevision, timestamps, mentions/FileRefs/tombstone/reactions. One MessageParent resolver for Channel/Page/Note/Task/Project/Company/Contact; thread follows parent policy, no new thread-user engine. Commands message.create/update/delete, reaction.toggle, channel.ensureDm/create/createGroup/markRead, thread.follow.update compiled first. SQL shared authority + uniqueDM pair + dedup(actor,operation,commandId) + durable outbox. Realtime cursor/event replay at leastonce; presence/typing lossy expiry separate. Events feed common search/attention/activity/memory/automation; mentions never grant access. ACL current membership/author/moderator/revision through API/ws/tools; agent explicit participation identified, raw tool outputs never silently copied into human timeline.

## Точные изменения файлов

- Use allocated components/messaging/{MessageTimeline,MessageComposer}.tsx, workspace-domain/messaging/contracts.ts and one workspace Messages module.
- Host belongs RS-MSG-01; common File/mention/attention ports reused.
- Preserve ChatPage/useSessionData; no agent thinking/tool transcript migration into human Messages.
- Proposed tests/rox-suite/{messaging-domain.test,messaging-realtime.spec}.ts.

## Пользовательский flow

A writes → B replies → mention notification dedup → create Task from private source with manual text → assignee outside channel receives neutral backlink → offline reply/reconnect yields one Message.

## Tests / Definition of Done

- [ ] Concurrent posts/edits/reactions/replies/replay retain exact IDs; tombstones preserve replies.
- [ ] Repeated ensureDm two windows returns one pair; addC reviewed group does not auto-share DM history.
- [ ] IME/menu Enter never accidental send; parent composer policy explicit.
- [ ] Two-device read cursor monotonic; hover row no read state mutation.
- [ ] Revoke open websocket/API/tool blocks writes and cached body/search/push leakage.
- [ ] PRIVATE-MSG-73 absent wider task/forward unless current signed decision valid.
- [ ] Seed ACL/idempotency/read-cursor bypass caught by specific assertions; live server proof separate fixture UI.

## Dependencies / related / complexity

Draft dependencies: RS-MSG-01.

- [#562](https://github.com/rox-one/rox-one/issues/562) — Agent composer остаётся отдельным; сохранить IME/attachments/permissions regression.
- [#380](https://github.com/rox-one/rox-one/issues/380) — Provider send/post имеет approval/reconcile adapter, не invented endpoint.

Complexity: XL: realtime recovery, ACL, attention/indexing and rich composer. Deliver channel post→thread→read/reaction→files→reviewed forward vertical slices.

## Общие quality gates

Draft specification; implementation/runtime **NOT_RUN**. Geometry — proposed ROX layout, не pixel measurements screenshot. RU i18n labels; current semantic fonts/theme/accent; light fixture + dark regression. Hitbox≥32px desktop/44px touch; visible focus, reduced-motion, readable contrast, Escape focus return. Tooltip и help доступны hover/focus/click; каждый metric объясняет definition/source/freshness/example. Hover не выполняет send/share/read mutation.

Feature включает model, persistence, commands/queries, permissions, realtime где нужно, search, mentions, attention/activity, agent tools, failures и observable receipt. Actor поступает из authenticated transport. Local saved/queued/committed/provider-confirmed различаются. Cached private preview после revoke очищается по policy; нельзя обещать физическое стирание disconnected device.

Acceptance evidence: exact commit/inputSha, domain receipt/ref/revision/hash, reload/concurrency/negative assertions, screenshots/ARIA/computed font/viewport/locale. Linux fixture UI, live service, Electron native и provider read-back — отдельные gates. Seeded assertion failure должен быть пойман; timeout/infra error не считается sensitivity. Literal Macro/Lark code/assets и приватные screenshot names/IDs/images не копировать.
