# Повторная проверка и detailed product/cloud specification

## Source freeze

- ROX main `f63294ba4fffa7238b46b24e918925a313ad0b12`; study branch input `e780e73ae84c977cf81546b49140d318dfcd6049`. Source directories apps/packages между ними не изменились.
- Macro initial `c966b79d40798c6c726a3b15fe90517941fc6e61` → intermediate `44a2e9efa62b557c5b0378f6376db0a6c4c6a127` → final observed `5678f9bd777413f66e8bddac58f13f21150d831b`. Remote main повторно прочитан через Git; последний commit routing reminders исследован непосредственно.
- Проверены все308 исходных evidence paths:304 blobs идентичны,4 references изменились в3 файлах; эти4 отдельно delta-reviewed. Старые citations остаются исторически точными. Complete code graph/domain/runtime claims не обновляются одним только именем commit.

## Что изменилось в Macro и как это влияет на ROX

| Code evidence на final SHA | Verified delta | ROX target impact |
|---|---|---|
| [MarkMessageNotifications](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/features/notifications/components/MarkMessageNotifications.tsx) | batch всех exact-message notifications; cache regression retries max3; mounted effect | notification read state/idempotency per Message, нельзя приравнивать hover/open container к прочтению |
| [ChannelUnreadNotifications](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/features/channel/Channel/ChannelUnreadNotifications.tsx), [unreadNotificationChip](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/features/channel/Channel/unread-thread-navigation.ts) | root-position и notification recency различаются; chip above/below, collapsed reply не считается прочитанным по parent | Channel unread navigation + target-root resolution; tests old-parent/new-reply and scroll geometry |
| [instrumentGatewaySocket / reportHeartbeatLapse](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/lib/service-clients/service-connection/presence-telemetry.ts) | close/retry/reconnect/heartbeat-lapse/reopen telemetry | scoped ephemeral presence observability; no body/userID logs by default in target production |
| [nativeIosBackspacePlugin](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/lib/core/component/LexicalMarkdown/plugins/native-ios-backspace/nativeIosBackspacePlugin.ts), [E_BLOCK_EQUATION_NODE](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/packages/lexical-core/transformers/katex.ts) | native iOS deletion and mid-sentence math fixes | WP49 editor conformance cases, no direct Solid import |
| [SnsPayload / stringified_fcm_json](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/crates/notification/src/outbound/mobile/payload.rs) | data-only FCM, identifier/recipient payload and display-clear adapter | unified notification delivery adapters; Android platform lane separately, no Tauri embedding in Electron |
| [reminderDetailRoute](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/features/reminders/route.tsx), [openReminderDetail](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/features/reminders/reminder-navigation.ts) | native authenticated feature-gated list/detail, stable namespace+remount identity; source navigation inside detail | SH18 reminder contextual detail in Tasks/Inbox, WP14/40/07; no second reminder engine |
| [homeReminderRoute](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/features/home/route.tsx), [createSplitLayout](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/components/app/split-layout/layoutManager.ts), [splitLocationFromContent](https://github.com/macro-inc/macro/blob/5678f9bd777413f66e8bddac58f13f21150d831b/apps/web/src/components/app/split-layout/split-router/legacy-route.ts) | Home/standalone same reminder claim; navigator readiness/version; legacy normalization | one typed router owner; reload/backforward/A→B identity test, no copied Macro split manager |

Root/package license files не попали в observed delta; первоначальный AGPL/proprietary UI licensing decision сохраняется. Новые Android/Tauri dependency manifests требуют отдельного dependency-origin review если выбраны для буквального использования. Ни одна revision не объявляет всю dependency tree юридически cleared.

## Новые deliverables

1. [Product PRD](product/PRD.md): exact placement, goals, source privacy, feature completeness, vertical outcomes.
2. [UI/UX contract](product/UI-UX-CONTRACT.md): tokens/density/layout/breakpoints/font semantics, hover/focus/click/keyboard/help/ARIA/states.
3. [Current ROX screen audit](product/rox-screen-audit.md):50 existing screens/subviews,68source refs,115current control specs and12source findings.
4. [Collaboration screens](product/collaboration-screens.md):19 proposed screens/96controls; [domain screens](product/domain-screens.md):24/75; [shared screens](product/shared-screens.md):18/48. Total61target screens/219controls. No target is claimed implemented.
5. Machine-readable `*-screen-contracts.json`, `screen-evidence.json`, original52domain packages plus cloud manifest52packets/per-WPstageUI ownership.
6. [Cloud execution pack](../../cloud/macro-integration/README.md):AGENTS/PRD references/SPEC/PLAN/EXPECTED RESULTS/completion schema, per-task prompts, readiness/preflight/integrity tooling and proof checks.
7. [Critical review](product/revision-3-review.md), [cloud review](../../cloud/macro-integration/REVIEW.md), [source validation](product/source-validation.md). Failed drafts preserved as chronological review findings, corrections do not assert runtime pass.

## Наблюдения, которые скорректировали продуктовую спецификацию

- Source styles intentionally Arial Narrow default/Rox mono; target inherits selected tokens. Font preset label mismatch separate bug, not global replacement.
- ModeScreen intrinsic minimum~780px; mobile/narrow contract requires real responsive implementation.
- Inbox уже смешивает agent decisions/permission/credential requests и mail; unified attention preserves these, read≠approval.
- Notes ordinary read/check/write + frontend without expectedRevision is not atomic CAS; conflict/recovery required.
- Current Page/Memory query errors may masquerade as empty; unread Mail list capped50 cannot be unlabeled total.
- Project/mail selections local state, proposed route codecs must be implemented/tested.
- Current CloudRun prompt/artifact lifecycle не доказывает repository coding executor checkout/branch/test/PR capability. Packet preparation provider-neutral; no cloud launch here.

## Verification limits

Artifact/schema/source/Mermaid/cloud-gate checks are actual executed checks, final report contains counts and attempts. Product E2E/live provider, container sandbox and built-native source UI не запускались. CUA first screenshot failed image destination на полном диске; следующая попытка timed out. После восстановления места shell/Tasks screenshot и AX navigation Tasks/Meetings/Dossier/Pages/Inbox успешно выполнены; [limited installed UI observation](product/native-ui-observation.md) сохраняет границы и историю. Installed binary provenance to studied commit и computed font не установлены. Новые экраны не получают visual approval через этот probe.
