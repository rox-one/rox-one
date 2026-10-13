# 012 — Misc stubs: learning reads, web balance, reauth, mobile menu (T13)

Ticket T13 (`docs/plans/2026-10-10-main-guardrails-and-ui-to-code.md:45,107`;
inventory items A11, A12, A14, A16, A17) — «каждая мёртвая заглушка
устранена (реализовано или удалено)». Each of the five items below is either
**implemented** (a real path landed) or **deleted** (the dead path is gone);
none is left as a no-op that pretends to work.

**Status:** ACCEPTED — shipped slice. The remaining "real backend" work (a live
learning ledger on hosts without the stores, a web Rox-cloud broker) is **not**
scheduled by this record.

**Owner:** product (pzd). An agent must not resurrect the removed reauth screen,
re-add the mobile debug rows on the web host, or turn the honest
`disconnected` balance into a fabricated number.

## A11 — Corrections/mutations read RPC (implemented)

The runtime-map learning overlay (`components/runtime-map/learning-overlay.ts`)
already understood `corrections`/`mutations`, but there was no read-only RPC to
serve them, so `deriveLearningMap` silently skipped those chain steps. A11 adds
the two reads end-to-end:

- **Protocol.** `RPC_CHANNELS.learning.LIST_CORRECTIONS` (`learning:listCorrections`)
  and `LIST_MUTATIONS` (`learning:listMutations`).
- **Service.** `LearningRpcService.listCorrections`/`listMutations`
  (`handlers/handler-deps.ts`), backed by `LearningService` →
  `ObservationStore.listCorrections()` (flattened `signals.userCorrections`,
  newest first) and `MutationStore.list()`, composed through `LearningHost`.
- **Handlers.** `handlers/rpc/learning.ts` registers both with
  `{ nativeAction: 'read' }`, the same workspace binding as `LIST_EVIDENCE`.
- **Renderer.** `channel-map.ts` (`listLearningCorrections` /
  `listLearningMutations`), `shared/types.ts`, and `LearningReadApi` +
  `loadLearningMapInput`, which now read both and fail soft to `[]`.

Remaining gap (not scheduled): a host with the learning service disabled still
returns `[]` — the localStorage ledger is the only source. No synthetic data is
invented.

## A12 — Web balance (implemented as honest `disconnected`)

`getRoxBalance` is a desktop broker surface over the Rox cloud account. The web
host has no connected account, so `apps/webui/src/adapter/web-api.ts` overrides
it to `{ status: 'disconnected' }` instead of letting the unadvertised
`onboarding:getRoxBalance` channel surface a raw transport error. The Home
balance widget's existing `disconnected` branch renders the honest state.

## A14 — Reauth screen (deleted)

`App.tsx` carried a full `'reauth'` `AppState` branch with `handleReauthLogin` /
`handleReauthReset` handlers whose only label was "placeholder (reauth is not
currently used)". Grep confirmed `setAppState('reauth')` was never called, so
the entire path — state, branch, handlers, the lazy `ReauthScreen` import, the
`components/onboarding/ReauthScreen.tsx` component, its barrel export, its two
tests (`reauth-copy`, `reauth-i18n`), and the playground registry entry — is
removed. The `ResetConfirmationDialog` / `showResetDialog` / `executeReset`
machinery stays: the `ready` shell still uses it.

The `onboarding.reauth.*` locale keys are intentionally left in place: they are
inert data, and the terminology-lint unit test uses two of them as sample keys
(`packages/shared/src/identity/__tests__/terminology-lint.test.ts:46-47`).

## A16 — Playground session creation (implemented as a mock, not a throw)

`playground/registry/unified-shell.tsx` and `settings.tsx` wired
`NavigationProvider.onCreateSession` to a `throw`. The playground has no real
session backend, but a throw makes the demo unusable; both now return a minimal
mock `Session` (mirroring `playground/registry/chat.tsx`), so the demo path
completes instead of exploding.

## A17 — Mobile menu debug rows (gated by capability)

`components/app-menu/mobile-menu-pages.ts` rendered the `DEBUG_MENU` update /
install / devtools rows unconditionally; they are served by `electronAPI`, which
the web host does not have (they rendered as dead no-ops). `BuildOptions` now
carries `isWeb`; on the web host the debug rows are dropped, the debug page is
omitted entirely, and the root debug entry is not added. `MobileAppMenu` passes
`isWeb: isWebUI`. Desktop compact mode is unchanged.

## What would flip this

- A web Rox-cloud broker: replace the `getRoxBalance` override with a real read
  and drop the `disconnected` state for that host.
- A real playground session backend: replace the mock `Session` returns with the
  real create call.
- New `DEBUG_MENU` rows that are *not* Electron-only: add them to the debug page
  outside the `isWeb` gate.
- A product decision to re-introduce a reauth screen: bring back the state
  branch, handlers and component (a new ticket, not this record).

## Evidence

- Ticket: `docs/plans/2026-10-10-main-guardrails-and-ui-to-code.md:45,107,179-185`
  (T13; inventory A11/A12/A14/A16/A17).
- Protocol: `packages/shared/src/protocol/channels.ts` (`learning.LIST_CORRECTIONS` /
  `LIST_MUTATIONS`).
- Service/host: `packages/server-core/src/handlers/handler-deps.ts`,
  `packages/server-core/src/memory/learning/LearningService.ts`,
  `packages/server-core/src/memory/learning/LearningHost.ts`.
- Handlers: `packages/server-core/src/handlers/rpc/learning.ts`; tests
  `packages/server-core/src/handlers/rpc/__tests__/learning.test.ts`.
- Renderer: `apps/electron/src/transport/channel-map.ts`,
  `apps/electron/src/shared/types.ts`,
  `apps/electron/src/renderer/components/runtime-map/learning-overlay.ts`
  (+ `__tests__/learning-overlay.test.ts`).
- Web balance: `apps/webui/src/adapter/web-api.ts`.
- Reauth removal: `apps/electron/src/renderer/App.tsx` (state/branch/handlers),
  `components/onboarding/ReauthScreen.tsx` (deleted), `components/onboarding/index.ts`,
  `playground/registry/onboarding.tsx`, `playground/registry/__tests__/uncovered-screens.test.ts`.
- Playground mocks: `apps/electron/src/renderer/playground/registry/unified-shell.tsx`,
  `.../registry/settings.tsx`.
- Mobile menu: `apps/electron/src/renderer/components/app-menu/mobile-menu-pages.ts`,
  `.../MobileAppMenu.tsx`, `.../__tests__/menu-icons.test.ts`.