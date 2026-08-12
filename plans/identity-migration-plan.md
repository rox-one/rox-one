# Rox Identity Migration Plan

> **For agentic workers:** This is both the identifier inventory/classification
> and the execution plan for the first remediation wave. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Make the running product present itself coherently as **Rox** without
stranding any existing Craft Agents installation, and define the staged
migration for every remaining Craft/Lukilabs identifier.

**Architecture:** Two-track approach. Track 1 (this branch): safe user-visible
copy renames — static HTML titles, viewer header, onboarding i18n keys, and a
configurable Rox Connect client id. Track 2 (future branches, planned here):
filesystem/protocol/env/package/deep-link/appId migrations, each with an
explicit compatibility story.

**Tech Stack:** Bun monorepo, Electron + webui (Vite) + viewer (Cloudflare
Pages), react-i18next with 10 ASCII-sorted locales (de, en, es, fr, hu, ja,
pl, ru, zh-Hans, zh-Hant; ru is the default UI language,
`fallbackLng: ['ru','en']`).

## Global Constraints

- **Never strand existing installations.** Every MIGRATE item below states its
  compatibility story explicitly; if none exists yet, the action stays
  MIGRATE/KEEP, never RENAME_NOW.
- **i18n (hard rule):** all user-facing strings via `t()`; new/changed keys go
  into all 10 locale files, keys ASCII-sorted; verify with
  `bun test packages/shared/src/i18n`, `bun run lint:i18n:parity`,
  `bun run lint:i18n:sorted`, `bun run lint:i18n:coverage`.
- **Do not rename in this wave:** `~/.craft-agent`, `CRAFT_*` env vars,
  `@craft-agent/*` npm scope, `craftagents://` deep link, electron-builder
  `appId`/`productName`.
- TDD for behavior changes: failing test first, watch it fail, minimal code,
  watch it pass.

---

## Part 1 — Identifier Inventory & Classification

Kinds: **USER_VISIBLE** (rendered to users), **FILESYSTEM** (on-disk paths),
**PROTOCOL** (URLs/schemes spoken to servers), **ENV** (environment
variables), **PACKAGE** (npm/workspace names), **DEEPLINK** (OS URL scheme),
**APP_ID** (OS/bundle identity), **OAUTH** (client identifiers/redirects
registered with third parties), **LEGACY** (historical/dead).

Actions: **RENAME_NOW** (safe, this branch) / **MIGRATE** (needs the staged
plan below) / **KEEP_INTERNAL** (not user-visible; leave) /
**LEGACY_ALIAS** (keep old name working as alias) / **REMOVE** (delete).

### USER_VISIBLE — copy in the running product

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| U1 | `Craft Agents — Login` title, `Craft Agents` h1, English-only copy | `apps/webui/src/login.html` | **RENAME_NOW** → Rox + RU-default inline i18n (this branch) |
| U2 | `Craft Agents` title | `apps/webui/src/index.html` | **RENAME_NOW** |
| U3 | manifest `name`/`short_name` "Craft Agents" | `apps/webui/src/public/manifest.json` | **RENAME_NOW** |
| U4 | `Craft Agents Session Viewer` title + meta description | `apps/viewer/index.html` | **RENAME_NOW** |
| U5 | `title="Craft Agent"` logo link; hardcoded theme-toggle titles | `apps/viewer/src/components/Header.tsx` | **RENAME_NOW** → `Rox` + move toggle titles to `t()` |
| U6 | Hardcoded English strings ("Sign in to Rox", "Connect with Rox", …) | `apps/electron/.../onboarding/RoxConnectStep.tsx` | **RENAME_NOW** → `t()` keys in 10 locales (this branch) |
| U7 | `<title>Craft Agents</title>` pre-boot title | `apps/electron/src/renderer/index.html` | **RENAME_NOW** (runtime title comes from window-manager, see A1) |
| U8 | i18n values containing the self-name: `menu.aboutCraftAgents`, `menu.hideCraftAgents`, `menu.quitCraftAgents`, `menu.craftMenu`, `menu.resetToDefaultsDetail`, `onboarding.welcome.title`, `onboarding.providerSelect.title`, `onboarding.credentials.connectChatGPTDesc`, `onboarding.credentials.connectGitHubDesc`, `onboarding.gitBash.description`, `onboarding.providerSelect.codexChatGPTDesc`, `onboarding.providerSelect.githubCopilotDesc`, `settings.preferences.basicInfoDesc`, `settings.preferences.nameDesc`, `settings.preferences.notesDesc`, `settings.knowledge.detectNeverDownload`, `browser.safetyHint`, `errors.failedToLoadSessionsDesc`, `inspector.empty.agent.body`, `ssh.bootstrap.description`, `ssh.description`, `workspace.connectRemoteDesc` | `packages/shared/src/i18n/locales/*.json` | **RENAME_NOW** (values only; key names unchanged this wave) |
| U9 | Backend label `Craft Agents Backend` (`pi` provider) — i18n `onboarding.apiSetup.{craftAgentsBackend,apiKeyDesc,chatGPTPlusDesc,githubCopilotDesc,piDesc}` + hardcoded copies in `model-picker-helpers.ts`, `provider-icons.ts`, `AiSettingsPage.tsx`, `ApiKeyInput.tsx` (+ its test) | electron renderer + locales | **RENAME_NOW** → `Rox Backend` (single coherent sweep; test updated TDD-style) |
| U10 | macOS app-menu `label: 'Craft Agents'` (hardcoded, next to i18n labels) | `apps/electron/src/main/menu.ts` | **RENAME_NOW** → new key `menu.appMenu` = "Rox" |
| U11 | OAuth callback page `<title>Craft - …</title>`, return link `Craft Agents` | `packages/shared/src/auth/callback-page.ts` | **RENAME_NOW** → `Rox` (non-React generated page; hardcoded English is the existing pattern) |
| U12 | `onboarding.reauth.*` ("Your Craft session has expired…", "Log In with Craft") | locales + `ReauthScreen.tsx` | **LEGACY** — reauth flow is dead code (`handleReauthLogin` is a placeholder, "reauth is not currently used"); strings refer to the retired Craft Docs login. Remove with the screen in a later cleanup. |
| U13 | Craft Docs integration strings: `editPopover.example.addSource` ("Connect to my Craft space"), `knowledge.migrate.*` ("Import Craft notes"), `hints.*` (`{source:Craft}`), `knowledge.publish.mode.adoptRequired` | locales | **KEEP_INTERNAL** — they name the *external* Craft Docs product (craft.do), not this app. Renaming would be wrong. |
| U14 | `extensions.runtime.craft-native.hint`, `extensions.runtime.siyuan-plugin.hint` | locales | **KEEP_INTERNAL** — developer-facing runtime labels describing the codebase ("first-party Craft code"). |
| U15 | Window title fallback `app.getName()` → electron-builder `productName` | `apps/electron/src/main/window-manager.ts` | **MIGRATE** with A1 (productName) — title policy code itself is fine. |

### FILESYSTEM

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| F1 | `~/.craft-agent` default config dir (`CONFIG_DIR`) | `packages/shared/src/config/paths.ts` | **MIGRATE** — see "Config-dir move" below. Renaming without a move/symlink strands every existing install (credentials, sessions, workspaces). |
| F2 | `~/.craft-agent-N` multi-instance dirs | `scripts/detect-instance.sh` consumers | **MIGRATE** together with F1. |
| F3 | `CRAFT_CONFIG_DIR` override | `paths.ts` | **MIGRATE** with env-aliasing plan (E-class). |
| F4 | Credential keys (`service_oauth::global::rox-cloud` etc.) inside config dir | `packages/shared/src/credentials` | **KEEP_INTERNAL** — stored under F1; they move with the dir, no rename needed. |

### PROTOCOL

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| P1 | OAuth relay `https://agents.craft.do/auth/callback` (`OAUTH_RELAY_CALLBACK_URL`) | `packages/shared/src/auth/oauth-relay.ts` | **MIGRATE** — see "OAuth relay" below. The relay is Craft-operated infra and is registered as redirect URI at third-party OAuth apps (Google, Slack, …). Blind rename breaks every source OAuth flow. |
| P2 | Slack OAuth relay `https://agents.craft.do/auth/slack/callback` | `packages/shared/src/auth/slack-oauth.ts` | **MIGRATE** with P1. |
| P3 | electron-builder `publish.url` `https://agents.craft.do/electron/latest` | `apps/electron/electron-builder.yml` | **MIGRATE** — auto-update endpoint; flip only after dual-publishing (see A1). |
| P4 | `VIEWER_URL = https://agents.rox.one` | `packages/shared/src/branding.ts` | already Rox — **KEEP_INTERNAL** (done). |
| P5 | `ROX_AUTH_BASE_URL` default `https://rox.one` | `packages/shared/src/auth/rox-cloud.ts` | already Rox — **KEEP_INTERNAL**. |
| P6 | ASCII logo `CRAFT_LOGO`/`CRAFT_LOGO_HTML` shown on the OAuth callback page | `packages/shared/src/branding.ts` | **KEEP_INTERNAL** for the constant name; **MIGRATE** the artwork when a Rox wordmark exists (design dependency). |

### ENV

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| E1 | `CRAFT_*` family (~40 vars; top: `CRAFT_CONFIG_DIR` ×219 refs, `CRAFT_SERVER_TOKEN` ×43, `CRAFT_UV`, `CRAFT_SERVER_URL`, `CRAFT_DEBUG`, `CRAFT_RPC_*`, `CRAFT_BUN`, `CRAFT_NODE`, `CRAFT_FEATURE_*`, `CRAFT_DEEPLINK_SCHEME`, …) | across `packages/`, `apps/`, `scripts/` | **MIGRATE** — see "Env-var aliasing" below. |
| E2 | `ROX_AUTH_BASE_URL`, `ROX_CLOUD_REQUIRED` | `rox-cloud.ts` | already Rox — **KEEP_INTERNAL**. |
| E3 | `ROX_CLIENT_ID` (new) | `rox-cloud.ts` | **RENAME_NOW** — introduced by this branch (see O1). |

### PACKAGE

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| N1 | `@craft-agent/*` workspace scope (`shared`, `core`, `ui`, `server`, `server-core`, `electron`, `cli`, `viewer`, `pi-agent-server`, `session-mcp-server`, `messaging-*`, …) | every `package.json` + every import | **MIGRATE** — see "npm scope strategy" below. Workspace-private today, so no consumer breakage, but it is a repo-wide codemod and out of this branch's safe scope. |
| N2 | Internal symbol names `CraftAgentsSymbol`, `CraftAgentsLogo`, `CraftAgentLogo`, `CraftAppIcon` | electron renderer/viewer | **KEEP_INTERNAL** this wave (component renames are churn; schedule with N1 codemod). |

### DEEPLINK

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| D1 | `craftagents://` scheme (parser, routing, OS registration, `INTERNAL_DEEPLINK_SCHEME` in `url-safety.ts`, webui warning copy) | `apps/electron/src/main/deep-link.ts`, `packages/shared/src/utils/url-safety.ts`, build manifests | **MIGRATE** — see "Deep-link dual registration" below. Existing user scripts/docs/Shortcuts reference `craftagents://`; removing it strands them. |

### APP_ID

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| A1 | `appId: com.lukilabs.craft-agent`, `productName: Craft Agents` | `apps/electron/electron-builder.yml` | **MIGRATE** — see "appId / auto-update" below. Changing appId orphans auto-update and OS-level associations for every installed copy. |
| A2 | `artifactName: Craft-Agents-*`, dmg `title`, `copyright: Craft Docs Ltd.`, `maintainer: support@craft.do`, `NSLocalNetworkUsageDescription` | `electron-builder.yml` | **MIGRATE** with A1 (same release train). Legal review for copyright/maintainer. |
| A3 | iOS bundle ids / `CraftAgentsApp`, `CraftAgentKit` Swift targets | `apps/ios/**` | **MIGRATE** — separate mobile pass (bundle-id change = new App Store app; needs its own migration story). |

### OAUTH

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| O1 | Device-flow `clientId: 'craft-agents-desktop'` sent to `POST {rox}/api/auth/device/start` | `packages/shared/src/auth/rox-cloud.ts`, call site `apps/electron/src/main/onboarding.ts` | **RENAME_NOW as configurable** — the accepting side lives in the private `rox-one/rox-one-website` repo, so the value is contractual. This branch introduces `ROX_CLIENT_ID` env override (default `'craft-agents-desktop'`, unchanged behavior) and documents it; flipping the default is a one-line change once the website accepts a Rox value. Never strand: old default remains valid. |
| O2 | Relay callback URLs at third parties (Google/Slack app consoles) | external + P1/P2 | **MIGRATE** with P1. |
| O3 | Test fixtures (`gyula@craft.do`, relay URL fixtures) | `packages/server-core/src/webui/__tests__/oauth-callback.test.ts` | **KEEP_INTERNAL** — test data. |

### LEGACY

| # | Identifier | Location | Action |
|---|-----------|----------|--------|
| L1 | `lukilabs` (company predecessor) | `electron-builder.yml` appId, `apps/ios` | **LEGACY_ALIAS** — survives only inside A1/A3 migrations; no standalone action. |
| L2 | Release notes `0.x.md`, `docs/superpowers/**`, specs, `.github-archive/**` | repo docs | **KEEP_INTERNAL** — historical documents; do not rewrite history. |
| L3 | `README.md`, `CONTRIBUTING.md`, `TRADEMARK.md`, `NOTICE`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | repo root | **MIGRATE** — docs/legal pass (trademark & attribution need human/legal review, not an agent rename). |
| L4 | `dashboard.html` (internal RU analytics page), `.i18n-work/` | repo root | **KEEP_INTERNAL** — internal tooling, not shipped. |
| L5 | System-prompt self-identification ("You are Craft Agent…", `OMP_CRAFT_CONTEXT_PROMPT`, co-author line `agents-noreply@craft.do`) | `packages/shared/src/prompts/system.ts`, `packages/shared/src/agent/omp-agent.ts` | **MIGRATE** — model-facing identity; needs a product decision (agent persona name, co-author email) and prompt regression testing. Not user-visible UI copy, so out of this branch. |

### Classification summary (counts)

| Action | Count | Items |
|--------|-------|-------|
| RENAME_NOW | 6 groups (U1–U7, U8≈22 keys, U9, U10, U11, E3/O1) | this branch |
| MIGRATE | 12 (F1–F3, P1–P3, P6-art, E1, N1, D1, A1–A3, O2, L3, L5) | staged plans below |
| KEEP_INTERNAL | 9 (F4, P4, P5, P6-name, N2, O3, U13, U14, L2, L4) | no action |
| LEGACY / LEGACY_ALIAS | 2 (U12, L1) | cleanup pass |
| REMOVE | 0 | nothing safe to delete yet |

---

## Part 2 — Migration runbooks (MIGRATE class)

### M1. Config-dir move (`~/.craft-agent` → `~/.rox`) with symlink fallback

1. On startup, resolve config dir:
   - If `ROX_CONFIG_DIR` set → use it (highest precedence).
   - Else if `CRAFT_CONFIG_DIR` set → use it, log deprecation warning.
   - Else if `~/.rox` exists → use it.
   - Else if `~/.craft-agent` exists → **move** it to `~/.rox` and leave a
     symlink `~/.craft-agent → ~/.rox` (covers absolute paths users baked into
     scripts, shell aliases, `CRAFT_CONFIG_DIR` in CI).
   - Else → create `~/.rox`.
2. Symlink failure (Windows without dev mode, some corporate FS) → fall back
   to using `~/.craft-agent` in place and mark "migration pending"; retry on
   next launch. **Existing installations keep working in every branch of this
   decision tree.**
3. Multi-instance `~/.craft-agent-N` → `~/.rox-N` follows the same rule.
4. Remove the fallback only after a full major-cycle grace period.

### M2. Env-var aliasing (`CRAFT_*` → `ROX_*`) with precedence + deprecation

1. Introduce a single resolver: `getEnv('SERVER_TOKEN')` →
   `process.env.ROX_SERVER_TOKEN ?? process.env.CRAFT_SERVER_TOKEN`.
   **New name wins** when both are set (documented precedence).
2. First use of any `CRAFT_*` name logs a one-line deprecation warning
   (rate-limited, once per var per process).
3. User-facing docs/copy (e.g. login placeholder) switch to `ROX_*` names only
   after the resolver ships everywhere; until then the login page keeps
   naming `CRAFT_SERVER_TOKEN` because that is the *working* variable.
4. `CRAFT_*` names keep working (LEGACY_ALIAS) for ≥1 major cycle, then
   removal is announced in release notes.

### M3. Deep-link dual registration (`craftagents://` → `rox://`)

1. Register **both** schemes at OS level (Info.plist CFBundleURLTypes, Windows
   registry, Linux desktop file).
2. Router accepts both; `craftagents://` hits a deprecation counter.
3. `url-safety.ts` treats both as internal.
4. After a grace period (≥1 major cycle), drop `craftagents://` registration;
   the parser keeps accepting it and shows "update your links" notice rather
   than failing hard. User scripts never 404 silently.

### M4. npm scope (`@craft-agent/*` → `@rox/*`)

- Packages are `private`/workspace — no external consumers to strand.
- Strategy: one codemod PR (rename + import rewrite) per package group, or a
  single big-bang with full typecheck/test gate. Keep git history via
  `git mv`. No dual-publish needed because nothing is published to a registry
  today; if publishing starts, publish both scopes for one cycle with
  `@craft-agent/*` marked deprecated.

### M5. appId / productName / auto-update (`com.lukilabs.craft-agent`)

1. **appId is load-bearing for electron-updater**: a new appId means the
   updater sees a different app and existing installs stop receiving updates.
2. Migration path: ship a final "bridge" Craft-branded build that (a) still
   uses the old appId, (b) points `publish.url` at a Rox endpoint that
   dual-hosts manifests for both appIds. Then ship Rox-branded builds under
   `com.rox.one.desktop` (or chosen id) whose artifacts the old clients are
   told about via the bridge update (or a migration build that installs the
   new appId app and hands off config dir per M1).
3. macOS: appId change also affects Keychain ACLs, Login Items, and
   `NSLocalNetworkUsageDescription` TCC entries — the bridge build must
   re-request/re-grant these. Windows: NSIS install dir follows productName —
   keep `deleteAppDataOnUninstall` semantics in mind so old→new transition
   never wipes the (already migrated) config.
4. Until this runbook is executed, `appId`/`productName`/artifact names stay
   Craft-branded (this is why Part 1 forbids touching `electron-builder.yml`
   in this wave).

### M6. OAuth relay (`agents.craft.do/auth/*`)

1. Stand up a Rox-operated relay (`auth.rox.one` or `agents.rox.one/auth/*`)
   implementing the same `callback` + `slack/callback` contract.
2. Register the new redirect URIs at every third-party OAuth app (Google
   Cloud console, Slack app config, …). **Old URIs must remain registered**
   so already-issued client configs keep working.
3. Ship client builds reading `ROX_OAUTH_RELAY_URL` (env override) with
   default flip to the Rox relay only after the relay is proven in prod.
4. Decommission `agents.craft.do` relay last, after traffic drains.

---

## Part 3 — This branch: implementation tasks

### Task 1: Rox Connect device-flow client id becomes configurable (O1)

**Files:**
- Modify: `packages/shared/src/auth/rox-cloud.ts`
- Modify: `apps/electron/src/main/onboarding.ts` (call site)
- Test: `packages/shared/src/auth/__tests__/rox-cloud.test.ts` (new)
- Docs: `docs/ROX_CLOUD_CONNECT.md` (env table)

**Interfaces:**
- Produces: `getRoxClientId(): string` —
  `process.env.ROX_CLIENT_ID` (trimmed, non-empty) else `'craft-agents-desktop'`.
- `startRoxDeviceFlow(clientId = getRoxClientId())` — default param only.

- [ ] Step 1: failing test — default, env override, empty-env fallback, and
  `startRoxDeviceFlow` sends the env-derived id (stub `globalThis.fetch`).
- [ ] Step 2: `bun test packages/shared/src/auth/__tests__/rox-cloud.test.ts` → FAIL.
- [ ] Step 3: implement `getRoxClientId`, wire default param, update call site.
- [ ] Step 4: test → PASS.
- [ ] Step 5: commit `feat(rox-cloud): configurable device-flow client id`.

### Task 2: Web login page rebrand (U1)

**Files:** `apps/webui/src/login.html`

- [ ] Step 1: rebrand copy to Rox; add a tiny inline i18n dict `{ru, en}` —
  language read from `localStorage['i18nextLng']` (same key the app uses),
  default `ru`, never `navigator.language` (mirrors `setupI18n` policy).
  Strings: title, heading, subtitle, label, button, pending state, generic
  error, network error. Placeholder keeps the literal `CRAFT_SERVER_TOKEN`
  (the working env var name until M2 ships).
- [ ] Step 2: `bun run webui:typecheck` + build webui to prove no breakage.
- [ ] Step 3: commit `feat(identity): Rox branding for web login`.

### Task 3: Viewer branding (U4, U5)

**Files:** `apps/viewer/index.html`, `apps/viewer/src/components/Header.tsx`,
`apps/viewer/src/App.tsx` (docstring), locales (2 new keys
`viewer.themeToLight`/`viewer.themeToDark` ×10)

- [ ] Step 1: title/meta → Rox Session Viewer; logo link `title="Rox"`;
  rename file-local `CraftAgentLogo` → `RoxLogo` (glyph unchanged — art
  migration is P6); theme-toggle titles via `t()`.
- [ ] Step 2: `bun test packages/shared/src/i18n` + parity/sorted/coverage gates.
- [ ] Step 3: `cd apps/viewer && bun run typecheck`.
- [ ] Step 4: commit `feat(identity): Rox branding for session viewer`.

### Task 4: RoxConnectStep i18n (U6)

**Files:** `apps/electron/.../onboarding/RoxConnectStep.tsx`, locales ×10

New keys (ASCII-sorted into the onboarding block):
`onboarding.roxConnect.authHost` (`{{host}}` interpolation),
`.connect`, `.copied`, `.description`, `.enterCode`, `.openBrowser`,
`.restart`, `.starting`, `.success`, `.title`, `.waiting`.

- [ ] Step 1: replace every literal with `t()`; icon stays
  `CraftAgentsSymbol` (N2 — internal component name, art migration is P6).
- [ ] Step 2: i18n gates + electron typecheck.
- [ ] Step 3: commit `fix(onboarding): i18n for RoxConnectStep strings`.

### Task 5: Product-name i18n sweep (U8, U9-i18n, U10)

**Files:** locales ×10, `apps/electron/src/main/menu.ts`

- [ ] Step 1: rename values listed in U8 ("Craft Agents"→"Rox" /
  "Craft Agent"→"Rox", per-locale grammar), `onboarding.apiSetup.*` →
  "Rox Backend", add `menu.appMenu` ("Rox") and use it in `menu.ts`.
- [ ] Step 2: i18n gates.
- [ ] Step 3: commit `feat(identity): Rox product name in UI copy`.

### Task 6: "Rox Backend" hardcoded sweep (U9-hardcoded)

**Files:** `model-picker-helpers.ts` (+ its test), `provider-icons.ts`,
`AiSettingsPage.tsx`, `ApiKeyInput.tsx`

- [ ] Step 1: TDD — update `model-picker-helpers.test.ts` expectations to
  `Rox Backend`, watch FAIL, update helper, watch PASS.
- [ ] Step 2: rename the 5 literal label spots; electron typecheck.
- [ ] Step 3: commit `feat(identity): Rox Backend label for pi provider`.

### Task 7: Static titles + callback page (U2, U3, U7, U11)

**Files:** `apps/webui/src/index.html`, `apps/webui/src/public/manifest.json`,
`apps/electron/src/renderer/index.html`,
`packages/shared/src/auth/callback-page.ts`

- [ ] Step 1: rebrand titles/manifest; callback page `<title>Rox - …</title>`
  + return-link text `Rox`.
- [ ] Step 2: `bun test packages/shared/src/auth` (callback tests), webui +
  shared typechecks.
- [ ] Step 3: commit `feat(identity): Rox titles for webui/electron/callback`.

### Task 8: Gates + evidence

- [ ] `bun test packages/shared/src/i18n`, `lint:i18n:parity|sorted|coverage`
- [ ] `bun test apps/viewer` (if tests exist), electron model-picker test
- [ ] `cd packages/shared && bun run tsc --noEmit`,
  `cd apps/viewer && bun run typecheck`, `cd apps/electron && bun run typecheck`
- [ ] before/after greps of user-visible Craft strings
- [ ] commit `docs(plans): identity migration plan`
