# Общие и contextual screens

Target spec; source citations pinned. Все proposed subviews требуют typed router integration; существующий destination не доказывает proposed route. Общие layout/states/a11y в UI-UX-CONTRACT.md.

## SH-01 — Shell / navigation / multi-panel

Placement: Native app shell → all destinations.

Current: Existing registry and browser history remain authoritative. Target: Target typed entity route + tab/filter/panel state; narrow drilldown.

Evidence: [APP_NAV_DESTINATIONS](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/app-shell/nav-destinations.ts#L87-L116). Packages: WP-40, WP-46.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| destination: Destination | registered destination + workspace | typed route and restored selection | row tint + exact destination label | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | navigate once; leaving pending draft prompts save/copy only when required | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| panel: Open in panel | canonical EntityRef | second representation of same ref | button tint, explain same-object view | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | create panel, do not duplicate data store | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| back: Back | history cursor | previous tab/filter/scroll | tooltip previous destination only if authorized | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | restore persisted view state | Alt+Left outside editor; button always available | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-02 — Omnibox / unified search

Placement: Shell → Omnibox.

Current: Existing Omnibox retained. Target: Target unified ACL-scoped index and entity open.

Evidence: [Omnibox](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/platform/Omnibox.tsx#L57-L95). Packages: WP-06, WP-40.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| query: Search | text≤2048 + workspace + type filters + cursor | authorized hit refs/snippets/watermark | field hover border; help search scope | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | debounced250ms cancel prior query; open hit | Cmd/Ctrl+K; arrows results; Enter open; Esc close | Preserve input; show permission, revision or transport error inline; no success without receipt |
| scope: Scope/types | ProjectRef? + kinds[] | filtered authorised results | chip tint; no hidden facet counts | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | apply query scope; persist route filter | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| hit: Result | permitted ref + snippet source | native detail/context | highlight, cached peek permitted only | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open canonical route; forbidden result purged | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-03 — Entity peek / backlinks / favorites

Placement: Entity chip → peek; detail → linked objects.

Current: Canonical Rox2 kinds/refs/relations retained. Target: Target authorized inbound/outbound graph views.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-02, WP-09, WP-40.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| peek: Preview | EntityRef + policy epoch | safe title/type/summary | 400ms cached peek; disabled inaccessible | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | explicit open retrieves authorized detail | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| link: Add link | sourceRef + targetRef + relation | receipt + relation revision | explain mentions/derived-from/attached-to semantics | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | picker→preview relation→confirm; cycles checked | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| star: Favorite | EntityRef + boolean | private preference receipt | add/remove tooltip | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | optimistic star, rollback error; revoke hides cached label | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-04 — Sharing / grants / revoke

Placement: Entity header → Share.

Current: Existing Page share entry retained. Target: Target reusable grants dialog, not page-only policy.

Evidence: [SharePageDialog](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/pages/SharePageDialog.tsx#L85-L114). Packages: WP-03, WP-51.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| grant: Invite / role | principalRef + read/write/share scope + expiry | effective grant and receipt | role help lists permitted operations | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | review audience diff→confirm; no implicit grant from mention | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| revoke: Remove access | grantId + expectedRevision | pending then fenced applied revoke | red tint; explain open clients affected | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | confirmation names principal/entity; await delivery fence | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| public: Link sharing | explicit audience + expiry + allowed action | revocable capability if policy permits | privacy help always visible | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | separate explicit confirmation; default private | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-05 — Notifications / attention

Placement: Inbox → attention representations; shell indicator opens same view.

Current: Existing Inbox merges All/Decisions/Messages/Snoozed/Done, agent permission/credential requests and JMAP Mail; preserve those flows. Target: Target unified notification projections inside existing attention Inbox; mark-read never resolves approval decision.

Evidence: [InboxPage](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/InboxPage.tsx#L91-L150). Packages: WP-07, WP-08, WP-09.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| notification: Open notification | notificationId + targetRef | native target and explicit read command | row tint; no mark-on-hover | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open target; mark only actual permitted viewing; receipt | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| read: Mark selected read | notificationIds[] + stateRevision | dedup durable state | tooltip number from authorised selection | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | batch command, rollback failed rows | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| unread: Unread filter | attention state/types | paged items and watermark | filter chip tint | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | server query; unseen≠dismissed | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-06 — Activity / event provenance

Placement: Project/entity detail → Activity; Feed contextual.

Current: Existing Feed retained as configured sources. Target: Target canonical entity events, separate from lossy awareness.

Evidence: [FeedPage](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/FeedPage.tsx#L121-L155). Packages: WP-04, WP-07, WP-37.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| event: Activity event | eventId + targetRef + causationId | redacted event detail | source/freshness tooltip | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open allowed target or evidence receipt | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| filter: Activity scope | actor/type/time/project filters + cursor | authorised timeline | chip tint; units ISO interval explained | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | query without reading private bodies | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| receipt: Command receipt | commandId | revision/provider/event/projection state | status explanation, no private payload | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open receipt panel; copy redacted correlation ID | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-07 — Agent context / command preview

Placement: Sessions → composer/context rail.

Current: Agent Sessions preserved separate from human Message. Target: Target same domain gateway tools and context provenance.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-36, WP-50.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| context: Attach context | EntityRef[] + allowed fields | authorized context manifest, not full stored transcript | chip preview title only if granted | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | picker→sources preview→attach; denied refs omitted with neutral reason | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| preview: Review write | typed command draft + expectedRevision + scope | validated diff and execution grant requirement | shows affected entity/action | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | confirm current diff; changed revision requires new preview | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| toolreceipt: Tool result | receipt/ref/source spans | verified result/context citations | source/freshness hint | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open source through gateway; no direct legacy write | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-08 — Session sharing / viewer

Placement: Session detail → share/export/viewer.

Current: Existing session upload/share needs audience-safe guard. Target: Target derived artifact export with provenance/redaction.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-50.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| audience: Export audience | recipient/policy + selected messages | redacted artifact preview/hash | help mixed-source limits | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | compute safe projection; cannot grant private tool output implicitly | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| publish: Share session | approved projection hash + expiry | revocable share receipt | button explains audience | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | publish only current hash; stale source permission invalidates | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-09 — Memory provenance / retraction

Placement: Memory → item detail.

Current: Existing memory surface retained. Target: Target fact/source references and permission-aware retrieval.

Evidence: [MemoryScreen](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/memory/MemoryScreen.tsx#L162-L194). Packages: WP-06, WP-36.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| source: Memory source | factRef + sourceRefs + timestamps | authorized source/evidence | freshness and source tooltip | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open source; denied source text purged | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| correction: Correct/retract | factRef + expectedRevision + reason | retraction/correction receipt | explain agent effect | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | preview→confirm; subsequent retrieval excludes retracted source | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-10 — Automation rule editor / run receipt

Placement: Automations → rule detail/runs.

Current: Existing automation list/runtime retained. Target: Target durable event consumer; external actions policy/budget gated.

Evidence: [AutomationsListPanel](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx#L115-L149). Packages: WP-37.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| trigger: Event trigger | canonical event kind + workspace filter | validated trigger subscription | event semantics help | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | select event schema; no ambiguous string trigger | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| action: Action and budget | typed domain command + execution policy + limits | preview/test receipt | cost/source/unit tooltip | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | dry-run fixture labelled; enable only permitted live action | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| run: Run details | runId + eventId + dedupKey | attempts/redacted receipt/recovery | status explanation | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | inspect; retry reconciles side effects, never blind resend | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-11 — Connections / workspace capabilities

Placement: Connections → provider detail.

Current: Existing Connections retained. Target: Target authenticated workspace/provider probes and capability statuses.

Evidence: [ConnectionsPage](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/ConnectionsPage.tsx#L67-L99). Packages: WP-01, WP-20, WP-27, WP-31, WP-52.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| connect: Connect provider | provider kind + test tenant + scopes | OAuth/server connection ref | scope and outbound data explanation | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | browser OAuth→server secret→probe; no client token snapshot | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| probe: Verify connection | connectionRef | capabilities/last read-back/error | source/time tooltip | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | probe actual installed adapter; unavailable remains unavailable | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| mode: Runtime mode | standalone/shared workspace binding | writer mode receipt | explains local vs shared authority | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | verify service before switch; fence old writer; no dual write | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-12 — Files / upload / safe viewer

Placement: Project Assets / attachments → viewer.

Current: Existing asset/viewer representations retained. Target: Target shared File refs/ACL/upload receipts.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-39, WP-44.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| upload: Upload file | file bytes + checksum + parentRef + limits | upload ref/progress/scanning/ready receipt | size/type/storage explanation | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | upload chunks/retry idempotently; no executable preview before quarantine passes | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| download: Download | FileRef + policy epoch | proxy/short-lived capability≤60s | size/source help | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | recheck ACL; revoked download rejected | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| anchor: Link page/time/line | FileRef + representation anchor | typed source link | preview authorized anchor | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open safe PDF/image/video/code renderer | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-13 — Spreadsheet Page representation

Placement: Pages → representation spreadsheet.

Current: New behavior, no claim current collaborative spreadsheet. Target: Target headless sheet with React renderer.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-42.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| cell: Cell/value/formula | sheetRef + cellAddress + typed value/formula + revision | revisioned value/computed result/error | formula/source/units tooltip | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | edit→validate→receipt; no arbitrary JS formula execution | arrows navigation; Enter edit/commit; Escape cancel | Preserve input; show permission, revision or transport error inline; no success without receipt |
| range: Range/import/export | range + validated CSV input | bounded import diff/export artifact | row/column count units | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | preview import+confirm; formula/csv injection sanitized | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-14 — Canvas Page representation

Placement: Pages → representation canvas.

Current: New behavior behind capability flag. Target: Target revisioned whole-file edits, not unproven CRDT canvas.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-43.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| node: Canvas node | nodeId + geometry + safe payload + baseRevision | canonical whole-file revision or conflict | handles on hover/focus | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | preview move/resize→CAS; simultaneous conflict compare | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| entitynode: Linked entity node | EntityRef + geometry | safe reference node | authorized peek | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | link picker; no hidden entity thumbnail | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-15 — Skills / Sources / coding PR review

Placement: Skills/Sources and Session artifact review.

Current: Existing skills/source configuration preserved. Target: Target code-origin/license gate and real patch review.

Evidence: [SkillsListPanel](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx#L48-L79). Packages: WP-45, WP-48.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| skill: Install/update skill | origin/version/digest/capabilities | reviewed install receipt | origin/license/version help | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | review diff+tool permissions; no silent trust upgrade | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| patch: Review patch | baseSha + diff + tests + source manifest | reviewed branch/draft PR evidence | changed-file origin/test receipt | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | read real diff; do not mark absent diff viewer implemented | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| apply: Apply patch | reviewed digest + clean base + ownership | commit/branch/read-back receipt | scope and target branch | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | recheck base/paths; no automatic merge/deploy | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-16 — Sync/recovery status and mobile capability

Placement: Entity header sync detail; narrow view.

Current: Existing status triad retained. Target: Target explicit offline/provider/device capabilities.

Evidence: [Rox2Status / ROX2_VERIFICATIONS](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L68-L111). Packages: WP-05, WP-46, WP-51.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| sync: Inspect sync | ref + pending commands + policy lease | local durable/queued/ack/rejected status | lastverified timestamp | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | retry only valid policy; export draft if permitted | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| capability: Device feature | device capability + permission state | supported/unavailable/request-device result | help platform requirements | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | request OS permission only on explicit user feature action | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-17 — Cloud work packet review

Placement: Cloud Runs settings/run detail; implementation runner contract.

Current: Current prepared prompt/artifact runtime not certified repo coding executor. Target: Target cloud packet branch/checkout/lane/receipt adapter if user launches implementation later.

Evidence: [RunSpec](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/cloud-runner/src/types.ts#L31-L73). Packages: WP-45, WP-47, WP-52.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| packet: Select work package | WP id + integration SHA + prerequisite receipts | reviewable prompt/input manifests | deps/owner/cost/time units | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | validate ready and ownership before submitting; not launched by spec build | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| results: Cloud results | runId + output manifest/hash | tests/patch/receipts/lane results | execution vs verification distinction | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | import review artifact; no feature complete from done state alone | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-18 — Reminder detail / snooze / source

Placement: Tasks → reminder detail; Inbox notification → same reminder ref.

Current: Existing recurrence/reminder primitives retained. Target: Target canonical reminder detail, source link separate; no new rail destination.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-14, WP-07, WP-40.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| open: Open reminder | ReminderRef | same reminder detail route and policy | name/time/zone help, no source private title | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open reminder itself, not auto-navigate underlying source | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| snooze: Snooze | ReminderRef + untilInstant + IANAzone + expectedRevision | receipt, next occurrence and notification state | date/time/recurrence impact explained | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | choose until→preview→confirm; recurrence not silently rewritten | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |
| source: Source link | ReminderRef + sourceRef | authorized source detail or neutral denied placeholder | permission-filtered peek only | Visible semantic focus ring; same explanatory help as hover; no mutation on focus | open source separately; no implicit source read grant | Tab → focus; Enter/Space → action; Escape closes overlay | Preserve input; show permission, revision or transport error inline; no success without receipt |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.


## SH-01 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| navigation.setView | client-command | {destination:RegisteredDestination,ref?:EntityRef,tab?:RegisteredTab,filters:Record<string,JsonValue>,panelId:string} | {route:TypedNavigationState,historyEntryId:string} | invalid_route/unknown_kind/forbidden_ref |  |
| preferences.setFavorite | command | {ref:EntityRef,favorite:boolean} | {receiptId:string,revision:number} | denied/unknown_ref | preference.updated |

Control binding: destination→navigation.setView; panel→navigation.setView; back→navigation.setView.

DoD: Open Project Tasks tab→Task detail→second panel→Back: Project ref/tab/filter unchanged, one canonical task ref.

Negative: Seed local-only tab state: reload/back mismatch must fail. Planned, not run.

## SH-02 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| search.entities | query | {workspaceId:string,text:string,maxTextLength:2048,kinds:EntityKind[],projectRef?:EntityRef,cursor?:string,limit:1..100} | {hits:AuthorizedSearchHit[],cursor?:string,projectionWatermark:string,asOf:string} | denied/invalid_filter/index_unavailable/stale_cursor |  |
| entity.resolve | query | {ref:EntityRef,fields:string[],policyEpoch:number} | {ref:EntityRef,projection:AuthorizedProjection,revision:number} | not_found_or_denied/unsupported_kind |  |

Control binding: query→search.entities; scope→search.entities; hit→entity.resolve.

DoD: A readable Page and B private Page contain same query; A gets only own hit, snippets/facets have no B title/count; opening hit yields same ref.

Negative: Seed ACL omitted in index/postfilter: hidden title/facet assertion fails. Planned, not run.

## SH-03 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| entity.resolve | query | {ref:EntityRef,fields:string[]} | {ref:EntityRef,projection:AuthorizedProjection,revision:number} | not_found_or_denied |  |
| entity.listLinks | query | {ref:EntityRef,direction:inbound/outbound,cursor?:string} | {links:AuthorizedLink[],cursor?:string} | not_found_or_denied |  |
| entity.link | command | {source:EntityRef,target:EntityRef,relation:Rox2Relation,expectedRevision:number} | {linkId:string,receiptId:string,revision:number} | denied/cross_workspace/forbidden_cycle/revision_conflict | entity.linked |
| preferences.setFavorite | command | {ref:EntityRef,favorite:boolean} | {receiptId:string,revision:number} | denied/unknown_ref | preference.updated |

Control binding: peek→entity.resolve; link→entity.link; star→preferences.setFavorite.

DoD: Task→Company link query returns same link through outbound and inbound after reload; denied Company placeholder without title.

Negative: Seed ref collision/cross-workspace acceptance: graph validation fails. Planned, not run.

## SH-04 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| permission.listEffective | query | {ref:EntityRef} | {direct:Grant[],inherited:Grant[],policyEpoch:number} | denied |  |
| permission.grant | command | {ref:EntityRef,principalRef:EntityRef,actions:ResourceAction[],expiresAt?:Instant,expectedRevision:number} | {grantId:string,effective:Grant[],receiptId:string,policyEpoch:number} | denied/invalid_principal/cross_workspace/revision_conflict | permission.granted |
| permission.revoke | command | {grantId:string,ref:EntityRef,expectedRevision:number} | {receiptId:string,state:pending_fence/applied,policyEpoch:number} | denied/revision_conflict/fence_unavailable | permission.revoked |
| share.createCapability | command | {ref:EntityRef,audience:ExplicitAudience,actions:read[],expiresAt:Instant} | {capabilityRef:string,url:string,receiptId:string} | denied/public_disabled/invalid_expiry | entity.shared |

Control binding: grant→permission.grant; revoke→permission.revoke; public→share.createCapability.

DoD: B editor receives grant; revoke while open denies next read/edit/tool and subscription after fenced receipt; no private old preview.

Negative: Seed missing subscription eviction: delivered-after-revoke assertion fails. Planned, not run.

## SH-05 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| notification.list | query | {readState:unread/read/any,types:NotificationType[],cursor?:string,limit:1..100} | {items:AuthorizedNotification[],cursor?:string,stateRevision:number,watermark:string} | denied/invalid_cursor/projection_unavailable |  |
| notification.setRead | command | {ids:string[],read:boolean,expectedStateRevision:number} | {applied:string[],failed:{id:string,code:ErrorCode}[],newRevision:number,receiptId:string} | revision_conflict/target_revoked/denied | notification.state_changed |
| notification.snooze | command | {id:string,until:Instant,expectedStateRevision:number} | {receiptId:string,newRevision:number} | denied/invalid_until/revision_conflict | notification.state_changed |

Control binding: notification→notification.setRead; read→notification.setRead; unread→notification.list.

DoD: Two devices mark same mention read; one final state revision, replay no duplicate notification; partial batch keeps failed item unread. Existing Inbox pending approval remains pending after reading mail/notification.

Negative: Seed notification.setRead calls agent approve or drops partial failure: approval/state assertions fail. Planned, not run.

## SH-06 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| activity.list | query | {ref?:EntityRef,projectRef?:EntityRef,actorRef?:EntityRef,kinds:string[],from?:Instant,to?:Instant,cursor?:string} | {events:AuthorizedActivity[],cursor?:string,watermark:string} | denied/invalid_interval/projection_unavailable |  |
| command.getReceipt | query | {commandId:string} | {commandId:string,ref:EntityRef,revision:number,lifecycle:Lifecycle,verification:Verification,eventIds:string[],providerState?:string} | not_found_or_denied |  |

Control binding: event→activity.list; filter→activity.list; receipt→command.getReceipt.

DoD: One task update outbox event produces one activity row even replayed; row includes causation but no private mail body; receipt points correct task revision.

Negative: Seed activity emitted before transaction commit: rollback leaves row assertion fails. Planned, not run.

## SH-07 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| agent.resolveContext | query | {sessionRef:EntityRef,refs:EntityRef[],requestedFields:string[]} | {sources:AuthorizedSourceManifest[],omitted:NeutralOmission[],policyEpoch:number} | denied/source_revoked/context_too_large |  |
| agent.previewCommand | query | {operation:string,input:JsonValue,expectedRevision?:number} | {previewId:string,contentDigest:string,audience:Audience,policyEpoch:number,diff:SafeDiff} | denied/unsupported_operation/revision_conflict |  |
| agent.executeCommand | command | {previewId:string,contentDigest:string,executionGrant:string} | {receiptId:string,ref:EntityRef,revision:number} | denied/preview_expired/revision_conflict/grant_required | domain-specific operation event |

Control binding: context→agent.resolveContext; preview→agent.previewCommand; toolreceipt→agent.executeCommand.

DoD: Agent allow-all cannot read/update B private Company; permitted Task update has current diff/ref/receipt; revoked source removed from context.

Negative: Seed agent direct store write bypass: denied resource must fail. Planned, not run.

## SH-08 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| session.previewExport | query | {sessionRef:EntityRef,selectedMessageIds:string[],audience:ExplicitAudience} | {projectionId:string,digest:string,redactions:Redaction[],sourcePolicyEpochs:Record<string,number>,expiresAt:Instant} | denied/source_revoked/audience_not_permitted |  |
| session.publishExport | command | {projectionId:string,digest:string,audience:ExplicitAudience,expiresAt:Instant} | {artifactRef:EntityRef,shareCapabilityRef:string,receiptId:string} | denied/preview_stale/source_revoked/digest_mismatch | session.export_published |

Control binding: audience→session.previewExport; publish→session.publishExport.

DoD: Session contains private mail tool output and public Page; external preview redacts mail body/title, publish same digest only; source revoke between preview and publish rejected.

Negative: Seed raw stored session JSON upload: secret-marker absent assertion fails. Planned, not run.

## SH-09 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| memory.getProvenance | query | {factRef:EntityRef} | {fact:AuthorizedFact,sources:AuthorizedSourceRef[],asOf:Instant} | not_found_or_denied/source_revoked |  |
| memory.correctFact | command | {factRef:EntityRef,expectedRevision:number,action:correct/retract,value?:string,reason:string} | {receiptId:string,revision:number,retractionWatermark:string} | denied/revision_conflict | memory.fact_corrected |

Control binding: source→memory.getProvenance; correction→memory.correctFact.

DoD: Correct/retract fact, reload and agent retrieval show current value or exclusion; source revoke suppresses old fact body.

Negative: Seed cache ignoring retraction watermark: obsolete marker detected. Planned, not run.

## SH-10 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| automation.dryRun | query | {ruleRef:EntityRef,eventFixture:TypedEvent,budget:RunBudget} | {executionMode:fixture,plannedCommands:CommandPreview[],externalWrites:0} | denied/invalid_fixture/budget_exceeded |  |
| automation.getRun | query | {runId:string} | {eventId:string,dedupKey:string,attempts:Attempt[],receipts:Receipt[],state:RunState} | not_found_or_denied |  |
| automation.registerTrigger | command | {ruleRef:EntityRef,eventKind:RegisteredEvent,filter:TypedEventFilter,expectedRevision:number} | {receiptId:string,revision:number} | denied/unknown_event/invalid_filter | automation.updated |
| automation.reconcileRun | command | {runId:string,expectedRevision:number} | {receiptId:string,state:reconciling/applied/failed} | denied/provider_ambiguous/budget_exceeded | automation.run_updated |

Control binding: trigger→automation.registerTrigger; action→automation.dryRun; run→automation.getRun.

DoD: Replay task.assigned event twice→one task side effect; dry run provider calls=0; loop reaches budget and halts; unknown mail send enters reconciliation not resend.

Negative: Seed dedup removal or dry-run provider call: call counter assertion fails. Planned, not run.

## SH-11 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| connection.startAuth | command | {provider:ProviderKind,requestedScopes:string[],returnRoute:TypedRoute} | {authUrl:string,stateTokenRef:string} | denied/unsupported_provider/scope_not_permitted |  |
| connection.probe | command | {connectionRef:EntityRef} | {receiptId:string,capabilities:Capability[],lastReadBackAt?:Instant,state:verified/degraded/unavailable} | denied/token_expired/adapter_unavailable |  |
| workspace.switchMode | command | {workspaceId:string,target:standalone/shared,serviceBindingRef?:EntityRef,expectedRevision:number} | {receiptId:string,writerEpoch:number,state:pending_fence/applied} | denied/service_unavailable/active_writer/revision_conflict | workspace.mode_changed |

Control binding: connect→connection.startAuth; probe→connection.probe; mode→workspace.switchMode.

DoD: Stored Calendar token with UnavailableAdapter remains unavailable; verified service switch disables old local writer before shared command accepted.

Negative: Seed token_exists→live badge or dual-writer accepts: negative test fails. Planned, not run.

## SH-12 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| file.download | query | {fileRef:EntityRef} | {proxyRoute?:string,url?:string,expiresAt:Instant,mime:string,checksum:string} | not_found_or_denied/quarantined/deleted |  |
| file.resolveAnchor | query | {fileRef:EntityRef,anchor:PageAnchor/TimeAnchor/LineAnchor} | {viewer:SafeViewerSpec,anchor:ValidatedAnchor} | denied/invalid_anchor/unsupported_type |  |
| file.beginUpload | command | {parentRef:EntityRef,sizeBytes:Integer,sha256:string,mime:string,fileName:string} | {uploadId:string,chunkPlan:Chunk[],expiresAt:Instant,receiptId:string} | denied/size_limit/unsupported_mime/source_revoked |  |
| file.uploadPart | command | {uploadId:string,partNumber:Integer,partChecksum:string,bytes:Binary} | {partReceiptId:string,checksum:string} | denied/upload_expired/checksum_mismatch |  |
| file.finalizeUpload | command | {uploadId:string,partReceipts:string[],sha256:string} | {fileRef:EntityRef,state:quarantined/ready,receiptId:string,revision:number} | denied/upload_expired/checksum_mismatch/missing_part/source_revoked | file.created |

Control binding: upload→file.beginUpload; download→file.download; anchor→file.resolveAnchor.

DoD: Interrupt upload after part2, restart and resume same uploadId, finalize produces checksum-matched one File; hostile MIME quarantined; wrong checksum never ready; expired download after revoke denied.

Negative: Seed skip-finalize checksum or preview before quarantine: bytes/state assertion fails. Planned, not run.

## SH-13 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| sheet.previewImport | query | {pageRef:EntityRef,range:CellRange,csv:BoundedText} | {previewId:string,digest:string,rows:Integer,columns:Integer,diff:SafeSheetDiff} | denied/size_limit/csv_invalid |  |
| sheet.setCell | command | {pageRef:EntityRef,address:CellAddress,value:TypedCellValue,expectedRevision:number} | {receiptId:string,revision:number,computed:CellResult} | denied/revision_conflict/formula_invalid/formula_budget | document.changed |
| sheet.commitImport | command | {pageRef:EntityRef,previewId:string,digest:string,expectedRevision:number} | {receiptId:string,revision:number} | denied/preview_stale/revision_conflict | document.changed |

Control binding: cell→sheet.setCell; range→sheet.previewImport.

DoD: Set A1=2,A2=3,A3=SUM(A1:A2)→5 after reload; formula cycle bounded error; import is preview only before commit.

Negative: Seed executable JS formula evaluation or stale preview import accepted: rejects malicious formula/CAS test. Planned, not run.

## SH-14 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| canvas.patchRevision | command | {pageRef:EntityRef,expectedRevision:number,file:ValidatedCanvasFile} | {receiptId:string,revision:number} | denied/revision_conflict/schema_invalid/size_limit | document.changed |
| canvas.linkEntity | command | {pageRef:EntityRef,targetRef:EntityRef,geometry:CanvasRect,expectedRevision:number} | {nodeId:string,receiptId:string,revision:number} | denied/target_denied/revision_conflict | entity.linked |

Control binding: node→canvas.patchRevision; entitynode→canvas.linkEntity.

DoD: A/B patch same base revision; one CAS applies, other conflict preserves draft; reload same canonical whole-file bytes.

Negative: Seed last-write-wins CAS removal: one conflict assertion fails. Planned, not run.

## SH-15 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| skill.previewInstall | query | {origin:string,version:string,digest:string,capabilities:string[]} | {previewId:string,sourceLicense:string,capabilityDiff:string[]} | origin_untrusted/license_review_required/digest_mismatch |  |
| coding.reviewPatch | query | {repository:string,baseSha:string,patchDigest:string,testReceiptRefs:string[]} | {diff:ParsedDiff,ownershipConflicts:string[],reviewState:string} | invalid_patch/base_stale/receipt_missing |  |
| coding.applyPatch | command | {previewId:string,baseSha:string,patchDigest:string,ownedPaths:string[]} | {commitSha:string,branch:string,receiptId:string} | base_stale/dirty_checkout/unowned_path/license_review_required |  |

Control binding: skill→skill.previewInstall; patch→coding.reviewPatch; apply→coding.applyPatch.

DoD: Patch baseSha mismatch or changed unowned registry rejected; approved digest creates isolated branch commit, no merge; skill permissions upgrade explicit.

Negative: Seed trust-by-name or arbitrary diff applied: origin/owned path test fails. Planned, not run.

## SH-16 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| sync.getState | query | {ref:EntityRef} | {durableFrontier:string,pendingCommandIds:string[],policyEpoch:number,leaseExpiresAt:Instant,status:Rox2Status} | denied/state_unavailable |  |
| device.getCapability | client-query | {feature:DeviceFeature} | {supported:boolean,permission:granted/denied/unknown,reason?:string} | device_unavailable |  |

Control binding: sync→sync.getState; capability→device.getCapability.

DoD: Offline command stays local queued/unverified until durableACK; after revoke reconnect rejects replay; narrow view same ref/draft.

Negative: Seed show-green-on-socket-connect or omit policy epoch: status/replay test fails. Planned, not run.

## SH-17 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| coding.preparePacket | client-query | {wpId:string,inputSha:string,specDigest:string,prerequisiteReceipts:Receipt[]} | {packetDigest:string,ready:boolean,conflicts:string[],requiredLanes:Lane[]} | spec_stale/dependency_missing/base_stale/ownership_conflict |  |
| coding.verifyResults | query | {runId:string,manifestDigest:string,commitSha:string} | {verifiedLanes:Lane[],pendingLanes:Lane[],artifactHashes:Record<string,string>,reviewState:string} | artifact_mismatch/test_failed/provider_not_verified |  |

Control binding: packet→coding.preparePacket; results→coding.verifyResults.

DoD: Done cloud run with only research artifact and no checkout/diff/required test receipts remains unverified; roots only initially ready.

Negative: Seed done⇒feature complete: required-lane gate fails. Planned, not run.

## SH-18 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| reminder.get | query | {ref:EntityRef} | {ref:EntityRef,sourceRef?:EntityRef,nextAt:Instant,timeZone:string,status:ReminderStatus,revision:number} | not_found_or_denied |  |
| entity.resolve | query | {ref:EntityRef,fields:string[]} | {ref:EntityRef,projection:AuthorizedProjection,revision:number} | not_found_or_denied |  |
| reminder.snooze | command | {ref:EntityRef,until:Instant,timeZone:string,expectedRevision:number} | {receiptId:string,revision:number,nextAt:Instant} | denied/invalid_until/revision_conflict | reminder.updated |

Control binding: open→reminder.get; snooze→reminder.snooze; source→entity.resolve.

DoD: ReminderA opened from Task and Inbox resolves same ref; navigate A→B/reload shows B data and pending state; denied source has no private title; snooze preserves rule.

Negative: Seed fixed component params stale after routeA→B or automatic source redirect: identity/route assertion fails. Planned, not run.
