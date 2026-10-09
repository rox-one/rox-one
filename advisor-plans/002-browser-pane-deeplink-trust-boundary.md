# Plan 002: Stop untrusted Browser Pane content from triggering app deeplinks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This plan already accounts for a reviewer
> dispatching you: do **not** create or edit any index/README file; the
> orchestrator maintains `advisor-plans/README.md` and the status table.
>
> **Drift check (run first)**:
> `git diff --stat 4418fca40..HEAD -- apps/electron/src/main/browser-pane-manager.ts apps/electron/src/main/deep-link.ts apps/electron/src/main/handlers/system.ts apps/electron/src/main/window-manager.ts apps/electron/src/main/index.ts apps/electron/src/renderer/contexts/NavigationContext.tsx apps/electron/src/renderer/lib/navigate.ts packages/shared/src/protocol/dto.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the deeplink payload shape and one renderer control-flow branch; do the steps in order and run each verification)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4418fca40`, 2026-10-09
- **Issue**: (none)

## Why this matters

The in-app Browser Pane loads arbitrary remote web pages in a `WebContentsView`
(`pageWc`). Two main-process handlers on that view treat any `craftagents://`
navigation as a trusted app deeplink: `will-navigate` calls
`handleDeepLinkUrl(url)` and `setWindowOpenHandler` does the same for
`window.open('craftagents://…')`. Remote page content therefore controls the
deeplink. Because a deeplink can be
`craftagents://action/new-session?input=<text>&send=true&mode=allow-all&workdir=…&systemPrompt=…`,
a malicious (or compromised) page can, with no user gesture, create an agent
session running in the **allow-all** permission mode and immediately send an
attacker-chosen prompt to it. That is remote-code-execution-adjacent: an
agent in allow-all mode can act on the user's machine.

The fix makes the pane's origin the trust boundary: a `rox://` navigation is
honoured only when the pane's current document is the app's own empty-state
page. Remote pages keep working as a browser; they simply lose the ability to
drive the app. A renderer-side guard adds defence in depth so that even if some
future ingress marks a deeplink as pane-originated, the dangerous
`new-session` parameters and the auto-send are not honoured.

The only deeplink flow that legitimately runs *inside* the pane today is the
app's own empty-state "new tab" page (a local document), which drives the app
through a `#launch=` hash signal and an IPC call — **not** through a `rox://`
navigation. OAuth does **not** land here: it opens the provider page in the
system browser and receives the redirect on a local `http://127.0.0.1` callback
server. So denying `rox://` from non-empty-state pane documents breaks no
legitimate flow.

## Current state

Read each excerpt yourself; line numbers are from commit `4418fca40`.

### `apps/electron/src/main/browser-pane-manager.ts` (4234 lines) — hosts the Browser Pane

- Line 60 — the scheme prefix used by every check in this file:

```ts
const CRAFT_DEEPLINK_SCHEME_PREFIX = `${process.env.CRAFT_DEEPLINK_SCHEME || 'craftagents'}://`
```

- Lines 460–468 — `pageView` is the `pageWc` that loads remote sites. Note it has
  **no preload**, so remote content cannot reach renderer IPC:

```ts
    const pageView = new WebContentsView({
      webPreferences: {
        partition,
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
```

- Lines 4120–4125 — **the vulnerable handler** (no origin check):

```ts
    pageWc.on('will-navigate', (event, url) => {
      if (url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) {
        event.preventDefault()
        void this.handleDeepLinkUrl(url)
      }
    })
```

- Lines 4132–4140 — **the second vulnerable handler** (same, for popups):

```ts
    pageWc.setWindowOpenHandler((details) => {
      mainLog.info(
        `[browser-pane] window-open requested id=${instance.id} url=${details.url} disposition=${details.disposition ?? 'unknown'} frameName=${details.frameName || 'none'}`,
      )

      if (details.url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) {
        void this.handleDeepLinkUrl(details.url)
        return { action: 'deny' }
      }
```

- Lines 2735–2738 — the existing URL classifier to reuse for the allowlist:

```ts
  private isBrowserEmptyStateUrl(url: string): boolean {
    if (!url) return false
    return url.includes(`/${BROWSER_EMPTY_STATE_PAGE}`) || url.includes(`\\${BROWSER_EMPTY_STATE_PAGE}`)
  }
```

  (`BROWSER_EMPTY_STATE_PAGE = 'browser-empty-state.html'`, line 59.)

- Lines 2756–2777 — `handleDeepLinkUrl`; line 2769 is the only `handleDeepLink`
  call from the pane:

```ts
  private async handleDeepLinkUrl(url: string): Promise<void> {
    if (!url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) return

    try {
      if (!this.windowManager) {
        mainLog.warn('[browser-pane] window manager unavailable for deep-link handling, falling back to shell.openExternal')
        await shell.openExternal(url)
        return
      }

      const { handleDeepLink } = await import('./deep-link')
      const sink = this.windowManager.getRpcEventSink() ?? undefined
      const resolver = (wcId: number) => this.windowManager?.getClientIdForWindow(wcId)
      const result = await handleDeepLink(url, this.windowManager, sink, resolver)
```

- The **legitimate** pane flow (must keep working) does **not** use `will-navigate`:
  - `loadEmptyStatePage` (lines 2747–2754) loads the app's own page into `pageView`.
  - The page signals launches by hash: `apps/electron/src/renderer/browser-empty-state.tsx:29-30`
    sets `window.location.hash = \`launch=${launchParams.toString()}\``, caught by the
    `did-navigate-in-page` handler (line 4038) → `maybeHandleEmptyStateLaunch` (line 2779)
    → `triggerEmptyStateRouteLaunch` → `handleDeepLinkUrl` directly.
  - The optional IPC alternative (`emptyStateLaunch`, used only when
    `window.electronAPI?.browserPane?.emptyStateLaunch` exists) reaches
    `handleEmptyStateLaunchFromRenderer` (line 668).
  - Neither path goes through `will-navigate`/`setWindowOpenHandler`, so gating those two
    handlers on the pane's current document leaves both paths untouched.

### `apps/electron/src/main/deep-link.ts` (509 lines) — parses and routes

- Lines 78–84 — the local navigation payload type pushed over IPC:

```ts
export interface DeepLinkNavigation {
  /** Compound route format (e.g., 'allSessions/session/abc123', 'settings/shortcuts') */
  view?: string
  /** Action route (e.g., 'new-chat', 'delete-session') */
  action?: string
  actionParams?: Record<string, string>
}
```

- Lines 208–231 — `rox://action/<name>/<id>?…`; **every** query param is copied
  into `actionParams` unvalidated:

```ts
    // rox://action/... (no workspace - uses active window)
    if (host === 'action') {
      if (pathParts.length < 1 || pathParts.length > 2 || pathParts.some(part => !part) || parsed.hash) return null
      decodeURIComponent(`${parsed.pathname}${parsed.search}`)
      const result: DeepLinkTarget = {
        workspaceId: undefined,
        action: pathParts[0],
        actionParams: {},
        windowMode,
        rightSidebar,
      }

      if (pathParts[1]) {
        result.actionParams!.id = pathParts[1]
      }

      parsed.searchParams.forEach((value, key) => {
        // Skip the window and sidebar params - they're handled separately
        if (key !== 'window' && key !== 'sidebar') {
          result.actionParams![key] = value
        }
      })

      return result
    }
```

- Lines 401–406 and 488–506 — `handleDeepLink` signature and where the payload is sent:

```ts
export async function handleDeepLink(
  url: string,
  windowManager: WindowManager,
  sink?: EventSink,
  resolveClientId?: (webContentsId: number) => string | undefined,
  preferredClientId?: string,
): Promise<DeepLinkResult> {
```
```ts
  if (target.view || target.action) {
    const navigation: DeepLinkNavigation = {
      view: target.view,
      action: target.action,
      actionParams: target.actionParams,
    }
    ...
    if (sink && clientId) {
      sink(RPC_CHANNELS.deeplink.NAVIGATE, { to: 'client', clientId }, navigation)
    } else if (sink && wsId) {
      sink(RPC_CHANNELS.deeplink.NAVIGATE, { to: 'workspace', workspaceId: wsId }, navigation)
    }
  }
```

- Lines 138–142 — `rox://auth-callback` does **not** produce a target and is not routed here
  (`return null`), so it never reaches a pane. There is no producer of that URL anywhere in
  the repo (confirmed by grep); OAuth is handled by the local callback server instead.

### `apps/electron/src/renderer/contexts/NavigationContext.tsx` (1588 lines) — executes actions

- Lines 852–853 — the action handler and its inline options type:

```ts
  const handleActionNavigation = useCallback(
    async (parsed: ParsedRoute, options?: { newPanel?: boolean; targetLaneId?: 'main' }) => {
```

- Lines 864–895 — `new-session` consumes dangerous params from the route:

```ts
      switch (parsed.name) {
        case 'new-chat':
        case 'new-session': {
          const previousSuppression = suppressAutoSelectRef.current
          suppressAutoSelectRef.current = true
          try {
            const createOptions: import('../../shared/types').CreateSessionOptions = {}
            if (parsed.params.mode) {
              const parsedMode = parsePermissionMode(parsed.params.mode)
              if (parsedMode) {
                createOptions.permissionMode = parsedMode
              }
            }
            if (parsed.params.workdir) {
              createOptions.workingDirectory = parsed.params.workdir as 'user_default' | 'none' | string
            }
            if (parsed.params.model) {
              createOptions.model = parsed.params.model
            }
            if (parsed.params.systemPrompt) {
              createOptions.systemPromptPreset = parsed.params.systemPrompt as 'default' | 'mini' | string
            }
```

  `parsePermissionMode('allow-all')` returns `'allow-all'` — see
  `packages/shared/src/agent/mode-types.ts:67-79` (also `'execute'` → `'allow-all'`).

- Lines 962–981 — **the auto-send**, ~100 ms after session creation, with no confirmation:

```ts
            // Handle input: either auto-send or pre-fill
            if (parsed.params.input) {
              const shouldSend = parsed.params.send === 'true'
              if (shouldSend) {
                setTimeout(() => {
                  if (!isCurrent()) return
                  void window.electronAPI.sendMessage(
                    session.id,
                    parsed.params.input!,
                    undefined,
                    undefined,
                    badges ? { badges } : undefined
                  ).catch(() => { toast.error(t('common.unavailable')) })
                }, 100)
```

- Lines 1387–1417 — the deep-link IPC listener flattens the payload into a route string and
  calls `navigate(route)`; **the payload's extra fields are dropped here today**:

```ts
    const cleanup = window.electronAPI.onDeepLinkNavigate((nav: DeepLinkNavigation) => {
      ...
      if (route) {
        ...
        void navigate(route as Route).catch(() => { toast.error(t('common.unavailable')) })
      }
    })
```

- `navigate(route, options)` (line 1070) forwards `options` to
  `handleActionNavigation(parsed, options)` at line 1112, and `NavigateOptions` is the
  serialisable event detail in `apps/electron/src/renderer/lib/navigate.ts:23-35`.

### Shared protocol type (the type the renderer actually sees)

`packages/shared/src/protocol/dto.ts:1348-1354` defines the payload type for the
`deeplink.NAVIGATE` RPC event (`packages/shared/src/protocol/events.ts:182`), and
`apps/electron/src/shared/types.ts:504` re-exports it to the renderer:

```ts
export interface DeepLinkNavigation {
  view?: string
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
}
```

This is a **third** copy of the interface — the one that must carry the new field
for the renderer to type-check.

### Deeplink ingress call sites

- OS ingress — `apps/electron/src/main/index.ts:369`, `:398`, `:1842` call
  `handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined)`.
- App renderer ingress (`window.electronAPI.openUrl`) —
  `apps/electron/src/main/handlers/system.ts:268`:
  `await handleDeepLink(url, windowManager, server.push.bind(server), resolver, ctx.clientId)`.
- Internal window creation — `apps/electron/src/main/window-manager.ts:486-492` builds the
  payload directly and calls `pushToWindow(window, RPC_CHANNELS.deeplink.NAVIGATE, { view, action, actionParams })`.
- Browser pane — `apps/electron/src/main/browser-pane-manager.ts:2769`.

### Legitimate flows that must keep working (verified)

- `performOAuth` (`apps/electron/src/preload/bootstrap.ts:411-469`) starts a **local**
  callback server (`createCallbackServer({ appType: 'electron' })`) and opens the provider
  page with `shell.openExternal(startResult.authUrl)` — the system browser, not the pane.
  The provider redirects to `http://127.0.0.1:<port>/callback`, never to `craftagents://`.
- The pane's empty-state page drives the app via `#launch=` / `emptyStateLaunch`, both of
  which bypass the two gated handlers.
- The app's own UI uses `window.electronAPI.openUrl('craftagents://action/new-session?…&send=true&mode=…')`
  (e.g. `apps/electron/src/renderer/components/ui/EditPopover.tsx:1019-1021`) — this arrives
  through `OPEN_URL`, **not** through the pane, so it must stay trusted.

### Repo conventions

- Tests use `bun:test` (`describe/it/expect/mock`), one file per unit, colocated under
  `__tests__/`. Follow the harness in
  `apps/electron/src/main/__tests__/browser-pane-manager.test.ts:17-166` (mock
  `BrowserWindow`/`WebContentsView` with a test-only `_emit`/`_listeners` bridge) and
  `apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-recovery.test.ts:52-84`
  (executes the real `useCallback` body by transpiling `NavigationContext.tsx`).
- Conventional-commit subjects, scoped — e.g.
  `test(shell): re-anchor the sash geometry pin to the shipped tokens`.

## Commands you will need

Run from the repo root (`/Users/t/Projects/archive/rox-one-e01-wt`).

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Shared typecheck (protocol + shared) | `bun run typecheck:shared` | exit 0, no errors |
| Electron typecheck (main + renderer) | `bun run typecheck:electron` | exit 0, no errors |
| Pane tests | `bun test apps/electron/src/main/__tests__/browser-pane-manager.test.ts` | exit 0, `0 fail` |
| Deeplink routing tests | `bun test apps/electron/src/main/__tests__/deep-link-routing.test.ts` | exit 0, `0 fail` |
| Renderer action tests | `bun test apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-recovery.test.ts` | exit 0, `0 fail` |

Do **not** run the full suite, `test:product-tour`, or the i18n scripts: this change
adds no locale keys and no product-tour surface.

## Suggested executor toolkit

- Use the `tdd` skill if available: write each new test first, watch it fail, then make it pass.
- Read `apps/electron/src/main/__tests__/browser-pane-manager.test.ts` lines 17–166 before
  writing tests — the mock's `_emit` passes `{}` as the event object for non-`did-create-window`
  events, so handler tests must call the listener directly with a fake `{ preventDefault }`.

## Scope

**In scope** (the only files you may modify):

- `apps/electron/src/main/browser-pane-manager.ts` — primary gate
- `packages/shared/src/protocol/dto.ts` — add `DeepLinkSource` + `source` field
- `apps/electron/src/main/deep-link.ts` — thread `source` into the payload
- `apps/electron/src/main/handlers/system.ts` — tag `OPEN_URL` ingress
- `apps/electron/src/main/window-manager.ts` — tag internal push
- `apps/electron/src/main/index.ts` — tag OS ingress
- `apps/electron/src/renderer/lib/navigate.ts` — add `source` to `NavigateOptions`
- `apps/electron/src/renderer/contexts/NavigationContext.tsx` — forward + honour provenance
- `apps/electron/src/main/__tests__/browser-pane-manager.test.ts` — tests
- `apps/electron/src/main/__tests__/deep-link-routing.test.ts` — tests
- `apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-recovery.test.ts` — tests

**Out of scope** (do NOT touch, even though they look related):

- The deeplink **scheme/URL format** (`rox://action/<name>/<id>?…`) — unchanged.
- `parseDeepLink` param handling in `deep-link.ts` (lines 195–228) — do not add param
  allowlists there; that would silently change every caller, including the trusted UI.
- Anything under `apps/electron/src/main/window-manager.ts` other than adding `source` to the
  one internal push at lines 486–492.
- The agent runtime / `sendMessage` / session creation internals.
- Browser Pane UI, toolbar, popups, permissions (`setupSessionPermissions`) — not redesigned.
- OAuth callback server / `performOAuth` — untouched (prove no change needed by reading, not editing).
- `apps/electron/src/main/browser-pane-manager.ts` popup handlers (`registerPopupWindow`) — they
  have no `rox://` branch (verified), so nothing to change there.

## Git workflow

- Branch: `advisor/002-browser-pane-deeplink-trust-boundary`.
- Commit per logical unit (protocol type; main gate; renderer provenance; tests).
- Conventional-commit subjects, e.g.
  `fix(browser-pane): gate rox:// deeplinks on the empty-state origin (SEC-01)`.
- Do NOT push or open a PR unless the operator instructed it.

## Approach (pick ONE primary; alternatives listed for the record)

**Primary: (a) deny by default, allowlist the pane's own empty-state origin.** The gate lives
in the two `pageWc` handlers and consults one helper. This is the only option that removes the
attacker's reach without relying on a user-gesture signal Electron does not reliably expose for
`will-navigate`, and it keeps the app's one legitimate pane-origin flow intact.

Alternatives considered:

- **(b) Require a user gesture / add a confirmation step.** `will-navigate` does not expose
  `isUserInitiated` on the event object, so "user gesture" would need a heuristic (e.g. a
  `before-input-event` timestamp window) or a new renderer confirmation dialog. Larger surface,
  more false negatives, and it still lets a one-click malicious link create an allow-all session.
  Rejected as primary; kept implicitly by the renderer's refusal to auto-send for pane provenance.
- **(c) Strip dangerous params from pane-originated deeplinks.** Still allows an attacker to
  create sessions and navigate the app; narrower benefit, and it duplicates the renderer logic.
  Rejected as primary; the renderer guard covers a variant of this for defence in depth.

## Steps

### Step 1: Add the provenance type to the shared protocol

In `packages/shared/src/protocol/dto.ts`, immediately above `DeepLinkNavigation` (line 1348),
add the union, and add the field to the interface:

```ts
/**
 * Provenance of a delivered deep-link navigation. `browser-pane` marks a link
 * that was triggered by the in-app Browser Pane; the renderer must not honour
 * auto-send / permission-mode parameters from it (SEC-01).
 */
export type DeepLinkSource = 'app' | 'os' | 'browser-pane'

export interface DeepLinkNavigation {
  view?: string
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
  /** See {@link DeepLinkSource}. */
  source?: DeepLinkSource
}
```

`apps/electron/src/shared/types.ts:504` re-exports this type, so the renderer sees the field
without further edits.

**Verify**: `bun run typecheck:shared` → exit 0, no errors.

### Step 2: Gate the Browser Pane's deeplink handlers on the empty-state origin

File: `apps/electron/src/main/browser-pane-manager.ts`.

2a. Add a helper directly after `isBrowserEmptyStateUrl` (currently lines 2735–2738):

```ts
  /**
   * SEC-01 trust boundary: a `craftagents://` navigation from the pane is
   * honoured only when the pane's current document is the app's own
   * empty-state page. Remote sites loaded in the pane (and their popups) must
   * not be able to drive the app — a crafted
   * `craftagents://action/new-session?…&send=true&mode=allow-all` URL can
   * otherwise create an allow-all session and auto-send an attacker prompt
   * with no user gesture.
   */
  private isDeeplinkAllowedFromPage(instance: BrowserInstance): boolean {
    const currentUrl = instance.pageView.webContents.getURL?.() ?? instance.currentUrl
    return this.isBrowserEmptyStateUrl(currentUrl)
  }
```

2b. Replace the `will-navigate` handler body (currently lines 4120–4125) with:

```ts
    pageWc.on('will-navigate', (event, url) => {
      if (!url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) return
      // Always prevent the scheme from being handed to the OS; decide afterwards.
      event.preventDefault()
      if (!this.isDeeplinkAllowedFromPage(instance)) {
        mainLog.warn(`[browser-pane] blocked deep-link navigation from untrusted page id=${instance.id} url=${url}`)
        return
      }
      void this.handleDeepLinkUrl(url)
    })
```

2c. Replace the deeplink branch inside `setWindowOpenHandler` (currently lines 4137–4140) with:

```ts
      if (details.url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) {
        if (this.isDeeplinkAllowedFromPage(instance)) {
          void this.handleDeepLinkUrl(details.url)
        } else {
          mainLog.warn(`[browser-pane] blocked deep-link popup from untrusted page id=${instance.id} url=${details.url}`)
        }
        return { action: 'deny' }
      }
```

2d. Tag the call site so the renderer can tell the link came from the pane — in
`handleDeepLinkUrl` (currently line 2769) change to:

```ts
      const result = await handleDeepLink(url, this.windowManager, sink, resolver, undefined, 'browser-pane')
```

(This is only reached for allowed documents after 2b/2c, but it keeps provenance honest.)

**Verify**:
`grep -n "CRAFT_DEEPLINK_SCHEME_PREFIX" apps/electron/src/main/browser-pane-manager.ts`
→ the two handler lines now sit directly above an `isDeeplinkAllowedFromPage(instance)` check.

### Step 3: Thread `source` through `handleDeepLink`

File: `apps/electron/src/main/deep-link.ts`.

3a. Add `source?: DeepLinkSource` to the local `DeepLinkNavigation` (lines 78–84) and import the
union:

```ts
import type { DeepLinkSource } from '@rox/shared/protocol'
```
```ts
export interface DeepLinkNavigation {
  /** Compound route format (e.g., 'allSessions/session/abc123', 'settings/shortcuts') */
  view?: string
  /** Action route (e.g., 'new-chat', 'delete-session') */
  action?: string
  actionParams?: Record<string, string>
  /** Provenance for renderer-side defence in depth (SEC-01). */
  source?: DeepLinkSource
}
```

3b. Add the parameter to `handleDeepLink` (line 401) after `preferredClientId`:

```ts
export async function handleDeepLink(
  url: string,
  windowManager: WindowManager,
  sink?: EventSink,
  resolveClientId?: (webContentsId: number) => string | undefined,
  preferredClientId?: string,
  source?: DeepLinkSource,
): Promise<DeepLinkResult> {
```

3c. Set the field on the payload (lines 489–493), only when provided, so callers that do not
pass a source keep producing byte-identical payloads:

```ts
    const navigation: DeepLinkNavigation = {
      view: target.view,
      action: target.action,
      actionParams: target.actionParams,
    }
    if (source) navigation.source = source
```

**Verify**: `bun run typecheck:electron` → exit 0. (Renderer/main types change together; do
not run it before Steps 1 and 3 are both applied.)

### Step 4: Tag the remaining ingress points

- `apps/electron/src/main/handlers/system.ts:268` (app renderer via `OPEN_URL`) → append `'app'`:

```ts
        const result = await handleDeepLink(url, windowManager, server.push.bind(server), resolver, ctx.clientId, 'app')
```

- `apps/electron/src/main/index.ts` at lines 369, 398 (OS `open-url` / `second-instance`) and 1842
  (cold start) → append `'os'`:

```ts
    handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined, undefined, 'os').catch(err => {
```

  (Apply the same `, undefined, 'os'` to all three calls; keep their existing `.catch(...)` and
  `coldStartLink` variable as they are.)

- `apps/electron/src/main/window-manager.ts:486-492` (internal window creation) → add the field to
  the pushed payload:

```ts
              this.pushToWindow(window, RPC_CHANNELS.deeplink.NAVIGATE, {
                view: target.view,
                action: target.action,
                actionParams: target.actionParams,
                source: 'app',
              })
```

**Verify**: `grep -rn ", 'app')\|, 'os')\|source: 'app'\|'browser-pane'" apps/electron/src/main`
→ shows one hit in each of `handlers/system.ts`, `index.ts` (×3), `window-manager.ts`, and
`browser-pane-manager.ts`.

### Step 5: Forward the source to the action handler in the renderer

Files: `apps/electron/src/renderer/lib/navigate.ts` and
`apps/electron/src/renderer/contexts/NavigationContext.tsx`.

5a. In `navigate.ts`, add the field to `NavigateOptions` (lines 23–35):

```ts
import type { DeepLinkSource } from '../../shared/types'
```
```ts
export interface NavigateOptions {
  /** ...existing fields unchanged... */
  skipAutoSelect?: boolean
  /** Deep-link provenance, set when a navigation arrives from main (SEC-01). */
  source?: DeepLinkSource
}
```

5b. In `NavigationContext.tsx`'s deep-link listener (around line 1415), pass the source through —
and **only** when present, so direct in-app `navigate()` calls and existing tests are unchanged:

```ts
        // Keep failed view addresses visible, while reporting rejected actions once.
        void navigate(route as Route, nav.source ? { source: nav.source } : undefined)
          .catch(() => { toast.error(t('common.unavailable')) })
```

5c. Widen the `handleActionNavigation` options type (line 853):

```ts
    async (parsed: ParsedRoute, options?: { newPanel?: boolean; targetLaneId?: 'main'; source?: DeepLinkSource }) => {
```

  and ensure `DeepLinkSource` is imported from `'../../shared/types'` in the existing type-import block.

**Verify**: `bun run typecheck:electron` → exit 0.

### Step 6: Honour provenance in the `new-session` action

File: `apps/electron/src/renderer/contexts/NavigationContext.tsx`, `new-session` case.

6a. At the top of the `case 'new-chat': case 'new-session':` block (just inside `try {`,
before `const createOptions`), add a local const and a module-level untrusted set (place the set
near the other module constants, e.g. below the imports):

```ts
/** Deep-link sources whose parameters must not be trusted to drive the app (SEC-01). */
const UNTRUSTED_DEEPLINK_SOURCES: ReadonlySet<string> = new Set(['browser-pane'])
```
```ts
            const untrustedSource = options?.source !== undefined && UNTRUSTED_DEEPLINK_SOURCES.has(options.source)
```

  Rationale for the `undefined` exemption: in-app code calls `navigate('action/new-session?…')`
  directly with no provenance, and that must keep today's behaviour. The main-process origin gate
  is the authoritative deny-by-default control; this check is defence in depth for the pane.

6b. Guard the three dangerous create-options with `!untrustedSource` (lines 871–885): wrap the
`parsed.params.mode`, `parsed.params.workdir`, and `parsed.params.systemPrompt` blocks:

```ts
            if (!untrustedSource && parsed.params.mode) {
              const parsedMode = parsePermissionMode(parsed.params.mode)
              if (parsedMode) {
                createOptions.permissionMode = parsedMode
              }
            }
            if (!untrustedSource && parsed.params.workdir) {
              createOptions.workingDirectory = parsed.params.workdir as 'user_default' | 'none' | string
            }
```
```ts
            if (!untrustedSource && parsed.params.systemPrompt) {
              createOptions.systemPromptPreset = parsed.params.systemPrompt as 'default' | 'mini' | string
            }
```

  Leave `model`, `status`, `label`, `project`, and `name` as they are.

6c. Block auto-send for untrusted sources (line 963):

```ts
              const shouldSend = parsed.params.send === 'true' && !untrustedSource
```

  The `else if (onInputChange)` pre-fill branch is left untouched (pre-filling a prompt is not
  dangerous; the user still has to send it).

**Verify**: `bun run typecheck:electron` → exit 0.

## Test plan

All three files use `bun:test`. Run each command from the repo root.

### 1. `apps/electron/src/main/__tests__/browser-pane-manager.test.ts`

Model new cases after the existing `setWindowOpenHandler` test at lines 475–506 and the direct
handler-invocation pattern at lines 442–454 (get the listener from
`(instance.pageView.webContents as any)._listeners['will-navigate']` and call it with a fake
`{ preventDefault: mock(() => {}) }` — the mock's `_emit` does **not** provide `preventDefault`).

Set the pane's current document with `await instance.pageView.webContents.loadURL(url)` (the mock
returns that URL from `getURL`). The empty-state URL to use is
`'file:///app/renderer/browser-empty-state.html'`.

- **Rewrite the existing test at lines 492–506** ("denies app deep-link popups and forwards to
  deep-link handler"): set the page URL to the empty-state URL first, keep asserting
  `result.action` is `{ action: 'deny' }`, and keep asserting `mockShellOpenExternal` was called
  with the URL (the manager has no windowManager in this harness, so `handleDeepLinkUrl` falls
  back to `shell.openExternal`). Rename it to
  `forwards app deep-link popups from the trusted empty-state page`.
- **New case**: `blocks app deep-link popups from an untrusted page` — set the URL to
  `'https://evil.example/'`, call the open handler with
  `craftagents://action/new-session?input=x&send=true&mode=allow-all`, expect
  `{ action: 'deny' }` and `expect(mockShellOpenExternal).not.toHaveBeenCalled()`.
- **New case**: `blocks rox:// top-level navigation from an untrusted page` — set the URL to
  `'https://evil.example/'`, grab the `will-navigate` listener, call it with
  `{ preventDefault }` and a crafted URL; expect `preventDefault` called once and
  `mockShellOpenExternal` not called.
- **New case**: `forwards rox:// top-level navigation from the empty-state page` — set the
  URL to the empty-state URL, call the `will-navigate` listener, `await Bun.sleep(0)`, expect
  `mockShellOpenExternal` called with the URL.

### 2. `apps/electron/src/main/__tests__/deep-link-routing.test.ts`

Follow the existing sink-capture pattern (lines 23–35).

- **New case**: `tags pane-originated navigations with source: 'browser-pane'` — call
  `handleDeepLink('rox://action/new-session?input=x&send=true&mode=allow-all', manager, sink, () => 'client-target', undefined, 'browser-pane')`
  and assert the captured navigation contains `source: 'browser-pane'` plus
  `action: 'new-session'` and `actionParams.mode === 'allow-all'`.
- **New case**: `omits source when the caller does not provide one` — call `handleDeepLink` without
  the 6th argument and assert the captured navigation has no `source` key
  (`expect('source' in sent[0][0]).toBe(false)`).
- Existing exact-object assertions (e.g. line 34) must still pass unchanged because the source
  field is only added when provided; if any existing assertion fails, stop and re-read Step 3c
  (do not edit the assertion to match a bug).

### 3. `apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-recovery.test.ts`

Model the new cases after the harness at lines 264–282, which calls the real
`handleActionNavigation` via `callback('handleActionNavigation', { ...bindings })` and drives its
`setTimeout` queue with `timers.forEach(fn => fn())`.

- **New case**: `does not auto-send a new-session deep link from an untrusted source` — same
  bindings as line 268 (`sendMessage` pushes into `sends`), call
  `await action({ name: 'new-session', params: { input: 'hello', send: 'true' } }, { source: 'browser-pane' })`,
  then `timers.forEach(fn => fn()); await settle()` and assert `sends` is `[]`.
- **New case**: `ignores dangerous new-session parameters from an untrusted source` — capture the
  `createOptions` passed to `onCreateSession`, call the action with
  `params: { mode: 'allow-all', workdir: '/tmp', systemPrompt: 'evil', input: 'hi', send: 'true' }`
  and `{ source: 'browser-pane' }`; assert the captured options have no `permissionMode`,
  `workingDirectory`, or `systemPromptPreset`.
- **Regression guard**: the existing case at lines 264–282 (called with no options) must still
  auto-send — do not change it; it proves the `undefined`-source exemption.

### Verification

```
bun test apps/electron/src/main/__tests__/browser-pane-manager.test.ts
bun test apps/electron/src/main/__tests__/deep-link-routing.test.ts
bun test apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-recovery.test.ts
```

→ each exits 0 with `0 fail`; the three files contain the 3 + 2 + 2 new cases above plus the
rewritten popup test.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck:shared` exits 0
- [ ] `bun run typecheck:electron` exits 0
- [ ] The three `bun test …` commands above exit 0 with `0 fail`
- [ ] `grep -n "isDeeplinkAllowedFromPage" apps/electron/src/main/browser-pane-manager.ts` returns
      3 lines (1 definition + 2 call sites)
- [ ] `grep -n "source" packages/shared/src/protocol/dto.ts` shows `DeepLinkSource` and the
      `source?: DeepLinkSource` field on `DeepLinkNavigation`
- [ ] `grep -rn "handleDeepLink(url, this.windowManager, sink, resolver, undefined, 'browser-pane')" apps/electron/src/main` returns 1 line
- [ ] `git status --porcelain` lists only files from the in-scope list
- [ ] No edit was made under `plans/` or `advisor-plans/` (no index file created)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts (drifted since
  `4418fca40`).
- `parseDeepLink` no longer copies query params into `actionParams`, or `new-session` no longer
  reads `mode`/`workdir`/`systemPrompt`/`send` — the vulnerability shape has changed.
- You find a **fourth** `DeepLinkNavigation` copy (the plan accounts for three:
  `packages/shared/src/protocol/dto.ts`, `apps/electron/src/main/deep-link.ts`,
  re-exported via `apps/electron/src/shared/types.ts`) and it breaks `bun run typecheck:electron`.
- An existing test in the three named files fails for a reason other than the two assertions this
  plan deliberately rewrites — report the failing test name and diff, do not "fix" it by
  relaxing the new guard.
- A verification fails twice after a reasonable fix attempt.
- You conclude the fix needs a file outside the in-scope list.
- You discover the empty-state page is *not* the only pane document that legitimately needs
  `rox://` navigation (i.e. a real provider-login page is loaded into `pageWc` and depends on a
  deeplink redirect) — report it instead of widening the allowlist yourself.

## Maintenance notes

- **Trust boundary location.** The single decision point is
  `browser-pane-manager.ts#isDeeplinkAllowedFromPage`. If the pane ever needs to honour deeplinks
  from another trusted local document, extend `isBrowserEmptyStateUrl`-based matching there
  deliberately — never re-add an unconditional `handleDeepLinkUrl` call in the `pageWc` handlers.
- **Reviewer should scrutinise:** that `event.preventDefault()` still precedes the origin check
  (a blocked `craftagents://` must never be handed to the OS); that `source` is only attached
  when provided (existing routing tests assert exact payload objects); and that the renderer's
  `UNTRUSTED_DEEPLINK_SOURCES` set contains only `'browser-pane'`, so direct in-app
  `navigate('action/new-session?…&send=true')` calls and `OPEN_URL`-delivered UI links
  (`EditPopover`, sidebar "open in new window") keep working.
- **Related ingress worth a separate audit (out of scope here):** `RPC_CHANNELS.shell.OPEN_URL`
  is reachable by any connected client and is tagged `'app'`. If a remote/WebUI client is ever
  treated as untrusted, that tag (and the renderer guard's trusted set) is the place to revisit.
- **Deferred:** no user-visible confirmation dialog for pane-originated deeplinks, because the
  pane can no longer originate any. If option (b) is ever wanted for OS-delivered links, it
  belongs in a separate plan.