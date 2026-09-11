# Rox Local-First Platform Epic

**Date:** 2026-09-02
**Status:** draft for product and design review
**Scope:** local Knowledge, account sync, embedded browser, performance, chat actions,
Tasks/Calendar, cloud runners, and later hard-cut Rox branding.

## 1. Product decision

Rox is a **local-first, account-synchronised workspace**:

```text
Local device
  Markdown vault + SQLite index + encrypted credential vault
           │
           ├── encrypted account replica ── Rox sync service
           │                                  │
           └── optional real-time device sync ┘
```

The local copy is always usable.  A server replica supports account recovery and
multi-device continuity.  The product must present separate, reversible choices
for real-time sync, AI-assisted indexing/memory, and product-improvement data use.
Passwords and operational cookies are never stored in searchable Knowledge and are
never silently copied to a general account database.

### Settled calls

| Area | Decision |
| --- | --- |
| Knowledge | Replace the SiYuan-required creation path with Rox Local Knowledge. |
| Local storage | Markdown files are canonical; SQLite is a rebuildable index. |
| Cross-device | Encrypted account replica; real-time sync is a separate control. |
| Browser migration | Discover all supported browser profiles; import occurs only after per-category consent and OS credential approval where required. |
| Cloud | Daytona is the only new cloud-runner target. Credentials are referenced from the secret store only. |
| Branding | New features ship first; the later brand migration is a hard visible/runtime cut to Rox, not a cosmetic string sweep. |
| Languages | Russian, English and Simplified Chinese are first-class product locales. |

## 2. Immediate problem statement

The current Knowledge surface selects `siyuan-local` and calls the SiYuan kernel
before it can list notebooks or create a note.  When the kernel is unavailable,
the user cannot create documents at all.  In the current live environment the
default local kernel endpoint is offline.

The product also makes the internal browser feel unreliable: normal links open
externally, embedded browser state can be destroyed on panel unmount, and the
web-only fallback is a sample preview rather than the application.

## 3. Architecture

### 3.1 Rox Local Knowledge

`Rox Local Knowledge` replaces the mandatory SiYuan provider with a workspace
provider backed by the existing workspace notes root.

```text
Markdown file (canonical)
  ├── YAML frontmatter: id, title, labels, created/updated, aliases
  ├── CommonMark + wikilinks + footnotes + callouts
  └── block ids for backlinks and task/session references
            │
            ▼
SQLite index (rebuildable)
  ├── documents, aliases, tags, wikilinks, blocks
  ├── extracted entities and entity/document edges
  ├── tasks, project references and calendar references
  └── sync operation journal
```

The index never becomes the only copy of a note.  A corrupt or deleted index can
be rebuilt by scanning the vault.  Existing SiYuan connection records remain
readable but are not selected as the default provider.

#### W1 provider and route migration

| Current seam | W1 change |
| --- | --- |
| `packages/core/src/knowledge/refs.ts` | Expand `KnowledgeRef` from SiYuan-only compact refs to `local-note`, `local-canvas`, and `siyuan-legacy` refs. |
| `packages/server-core/src/knowledge/connections-store.ts` | Accept `local-markdown` and `siyuan-legacy` providers; local is workspace-scoped. |
| `packages/server-core/src/handlers/rpc/knowledge.ts` | Register `LocalMarkdownKnowledgeProvider`; dispatch list/create/read/search by provider instead of constructing `SiyuanKernelClient` unconditionally. |
| `packages/server-core/src/handlers/rpc/notes.ts` | Reuse the existing safe local Markdown creation path behind the local provider. |
| `apps/electron/src/renderer/knowledge/KnowledgeHome.tsx` | Create local notes without a notebook preflight and navigate to a provider-aware local route. |
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | Route New Knowledge Note to local Knowledge by default, not `routes.view.siyuan(...)`. |

```ts
type LocalKnowledgeConnection = {
  id: `local-markdown:${string}`
  provider: 'local-markdown'
  workspaceId: string
  vaultRoot: string
  enabled: true
}

type KnowledgeRef =
  | { scheme: 'local-note'; workspaceId: string; documentId: string }
  | { scheme: 'local-canvas'; workspaceId: string; canvasId: string }
  | { scheme: 'siyuan-legacy'; connectionId: string; notebookId: string; documentId: string }
```

`knowledge.siyuan.enabled` defaults to `false` for new installations. Existing
SiYuan connections remain read-only legacy records until a user chooses a separate
migration/export. W1 never launches or depends on a SiYuan kernel.

### 3.2 Note authoring surface

The editor is Markdown-first with a rich, block-aware surface:

- write/edit Markdown directly and switch to a styled Craft-like reading view;
- `[[wikilink]]`, aliases, backlinks, footnotes and automatic suggested links;
- `!` opens a session/agent/action command; `@` inserts a session, agent, task,
  project, person or entity reference;
- callouts, checklists, tables, embeds and resizable multi-column blocks;
- views: document, table/base, canvas, outline, graph, and linked-task view;
- daily notebook is the default destination for a note created from a session.

Double-clicking an empty Canvas creates a local note.  Promoting that note to a
session prompt preserves provenance and explicitly moves the content into the
chosen conversation instead of silently deleting it.

### 3.3 Data and consent model

The onboarding and Settings surfaces show independently reversible choices:

| Choice | Default | What changes |
| --- | --- | --- |
| Account replica | enabled for account-required data | encrypted replica and recovery metadata are stored by Rox. |
| Real-time device sync | disabled | sync journal applies changes between signed-in devices. |
| AI indexing and memory proposals | enabled for selected vaults | local or opted-in cloud inference may suggest links, entities and memory cards. |
| Product improvement / model training | disabled | only data covered by a separate explicit purpose is eligible. |
| Browser bookmarks/history | disabled until import confirmation | selected profiles are indexed into the user's local browser profile. |
| Browser cookies | disabled until separate confirmation | imported only into an encrypted operational browser partition. |
| Browser passwords | disabled until OS credential consent | imported only into the platform credential vault; never exposed to renderer/Knowledge search. |

The initial-profile rule is: prefer the explicit onboarding source profile; if a
native app launch has no source profile, recommend the most recently used profile
on the import day and require the user to confirm the selection.

#### Data classification and enforcement contract

| Data class | Canonical local store | Cloud replica | Search/index | AI processing | Product improvement | Key custody / deletion |
| --- | --- | --- | --- | --- | --- | --- |
| Notes, tasks, session metadata | Markdown + SQLite index | encrypted account replica | yes | selected-vault consent | separate opt-in | account deletion queues replica delete; local survives until wipe |
| Calendar event metadata | encrypted local store | provider/connector policy | selected fields | connector consent | no by default | OAuth revocation + local/cache purge |
| Browser history/bookmarks | local profile index | only after category consent | yes | selected-vault consent | separate opt-in | category export/delete |
| Cookies | encrypted operational browser vault | never in general replica/index | no | no | no | main-process keychain/vault, explicit wipe |
| Passwords/passkeys | platform credential vault | never in general replica/index | no | no | no | OS credential consent, explicit vault erase |
| Voice/audio | encrypted local cache | chosen transcription provider only | transcript policy | explicit transcription consent | separate opt-in | retention TTL + delete receipt |
| Model prompts/outputs | session store | encrypted account replica | selected fields | session policy | separate opt-in | export/delete per session |

Every consent event is append-only and records data category, purpose, scope,
client version, time, revocation time and deletion-request status. Revocation must
stop future replication immediately, retain the local canonical data, and surface a
server-deletion receipt/status for the remote replica.

#### Cloud tenancy boundary

The local desktop transport may use the active workspace as a convenience context,
but a cloud-connected Rox account must not treat a client-supplied `workspaceId` as
authorization. Before real-time sync, collaboration links or shared cloud replicas
ship, the server binds every workspace to the authenticated account/session and
checks membership server-side for every RPC, sync record and background job. The
client can request a workspace; it cannot self-assert access to one.

### 3.4 Internal browser

The Electron `BrowserPaneManager` is the canonical retained browser host.

- safe `http`/`https` links open in a Rox browser panel by default;
- auth callbacks, deep links, unsafe schemes, file flows and external-only
  destinations use an explicit policy table rather than a blanket redirect;
- closing a panel hides/detaches it; only an explicit Close destroys its profile;
- browser state is keyed by workspace and device/profile identity;
- profile import runs in a privileged main-process worker and reports a redacted
  category summary to the renderer.

#### Browser lifecycle and import slices

The browser API exposes three non-interchangeable actions:

```ts
hideEmbedded(instanceId)          // route/view switch; preserve BrowserView and partition
detachEmbedded(instanceId)        // remove from PanelSlot; preserve session/profile
destroyProfileSession(profileId)  // explicit destructive user action; clears owned session
```

`BrowserPanelPage` unmount must call hide/detach, never destroy. A transient
`browserPane.list()` failure marks the registry stale and retries; it must not clear
the navigator or erase the last known panel state.

Profile migration is a separate privileged workflow: discover Safari/Chromium/
Firefox profiles, obtain per-category confirmation, request OS approval for
credentials, import into an encrypted vault/partition, and show an audit summary.
No raw cookie, password, passkey or Keychain value crosses the renderer bridge.

### 3.5 Performance contract

| Journey | Target |
| --- | --- |
| Cold ready, 500 sessions | under 1.5 s |
| Cold ready, 2,000 sessions | under 2.5 s |
| Cached session switch | p95 under 120 ms |
| List/table/Kanban/Map switch | p95 under 150 ms |
| Internal browser chrome visible | under 300 ms |
| Dropdown open | under 80 ms without layout shift |

The first fixes are bulk session metadata, no startup N+1 permission IPC,
non-destructive browser panel lifecycle, and a single styled/virtualised menu
surface for table, Kanban and Cloud controls.

### 3.6 Chat actions and memory proposals

Each message has a hover action dock:

- default heart reaction plus expandable emoji picker;
- yellow transparent highlight using the existing annotation model;
- start a side thread from the message;
- quick actions: challenge, verify, counterargument, concise reply and research;
- brain action starts a lessons-learned proposal, not an automatic memory write;
- share/publication is distinct from collaboration/inviting another person.

Memory proposals are compact blue in-chat cards.  Each says what Rox inferred and
offers **Global**, **This project**, **No thanks**, and an inline edit link.  A
proposal records its evidence, scope and reviewer action.  It never silently
writes a personal fact, credential or durable instruction.

### 3.7 Tasks, calendar and activity

The product has a Things-inspired task workspace:

- Today plan, This Evening, Upcoming, Anytime, Someday, Logbook;
- projects, headings, tags, task notes, dates, recurrence and linked sessions;
- an annual activity heatmap as a collection view, with keyboard navigation and
  a sortable daily session table;
- account connectors for calendars and Reminders remain provider adapters with
  separate OAuth/OS grants;
- event/task fields retain source, timezone, sync state and conflict state.

### 3.8 Cloud and agent platform

Daytona is the sole new cloud execution provider.  The runner abstraction must
support per-user sandbox identity, budget caps, project binding, explicit start/
stop, logs, cleanup TTL, and a typed capability declaration.  It must not receive
browser secrets or unfiltered vault data.

Rox's command/skill catalogue is a registry of declarative capabilities: display
name, purpose, activation trigger, permissions, provider, cost class and UI entry
point.  Magic words are discoverable from the composer, explain what they activate,
and never execute a privileged operation merely because a phrase appears in text.

#### Daytona-only provider migration

| Current surface | W6 change |
| --- | --- |
| `packages/cloud-runner/src/index.ts` | Add `DaytonaProvider`; remove Cloudflare/Modal from the public provider registry. |
| `packages/server-core/src/handlers/rpc/cloud-runs.ts` | Extend the provider union/config to `daytona | local | native`; migrate the default from `cloudflare` to `daytona`. |
| Cloud run settings and modal | Offer Daytona only, with project, sandbox, budget and TTL fields. |
| Credential handling | Use a secret reference injected in the main process; no renderer, log or spec contains credential material. |

The conformance scenario is: create run → report lifecycle state → stream redacted
logs → collect artifact → retry/cancel → enforce TTL/budget → destroy sandbox and
read back final state. A failed Daytona request must never fall back to another
provider silently.

### 3.9 UI contract and Rox design tokens

The product direction is **native graphite workspace**: dense macOS utility, calm
surface hierarchy, 6/8px structural radii, glass only for transient floating
affordances, and a single Rox mint/acid-blue action accent. It is not a generic
dark SaaS card grid.

```text
Primitive → Semantic → Component tokens

ink / graphite / mint / blue / status scales
  → surface, raised-surface, canvas, menu, focus, success, warning, error
    → note-card, canvas-node, browser-panel, menu-surface, memory-card,
      model-badge, heatmap-cell, message-hover-dock
```

Required token groups: display/body/mono fonts; 2/4/6/8/12/16/24px spacing;
radius 4/6/8/12px; menu/panel/canvas elevation; focus-ring; status; selected;
disabled; model/provider badge; canvas edge/minimap; note/callout/thread/memory.
No premium surface may use native `<select>` or arbitrary one-off shadows.

#### Screen hierarchy

| Surface | First | Second | Third |
| --- | --- | --- | --- |
| Knowledge/Vault | current document or action to create it | navigator / backlinks / tasks | optional graph, entities and sync detail |
| Canvas | active trace/run and selected node | draft workspace / palette | inspector, minimap and layout actions |
| Tasks/Calendar | Today plan and current events | task list grouped by time/project | projects, tags and connector status |
| Browser panel | current page and its security state | tab controls / session identity | debug/network/history tools |
| Consent onboarding | user benefit and data category | what stays local / what is copied | retention, revoke and learn-more |
| Message hover dock | reply content | reaction/highlight/thread | quick agents, share and memory proposal |

#### User-visible state matrix

| Feature | Required visible states |
| --- | --- |
| Knowledge | first empty vault, local write failure, index rebuild progress, SiYuan disabled, sync paused/stale/conflict, local recovery action |
| Browser | detached, hidden, restored, policy-blocked, profile import pending/partial/OS-denied, crash/reconnect |
| Memory proposal | pending, edited, global approved, project approved, rejected, expired, deletion requested |
| Consent | not chosen, enabled, revoked, deletion queued, deletion complete, provider error |
| Tasks/Calendar | no connected calendar, OAuth pending, sync conflict, timezone warning, task due/overdue/completed |

| Feature | State | Primary visible copy | Primary action | Secondary action | Telemetry/event |
| --- | --- | --- | --- | --- | --- |
| Knowledge | local write failure | “Не удалось сохранить заметку локально” | Retry | Copy recovery details | `knowledge.local_write_failed` |
| Knowledge | corrupt/rebuilding index | “Восстанавливаем индекс из ваших заметок” | Continue working | View progress | `knowledge.index_rebuild_started/completed` |
| Sync | conflict | “Есть две версии этой заметки” | Compare versions | Keep local / keep cloud | `sync.conflict_detected/resolved` |
| Browser import | OS consent denied | “Rox не получил доступ к credentials этого профиля” | Try again | Import history only | `browser.import_os_denied` |
| Cloud replica | deletion queued | “Удаляем облачную копию. Локальные данные останутся” | View status | Cancel pending request where possible | `replica.delete_queued` |
| Cloud replica | deletion complete | “Облачная копия удалена” | Close | Export local data | `replica.delete_completed` |

Accessibility and viewport contract: 44px touch targets; visible keyboard focus;
ARIA labels for icon-only actions; status is never color-only; roving tabindex in
canvas/menu grids; deliberate layouts at 375px, 768px, 1280px and 1800px.

Typography is native by default: `SF Pro Display` for display, `SF Pro Text` for
body, `SF Mono` for code/ids, with `PingFang SC` and `Noto Sans SC` fallbacks for
Simplified Chinese. At 375px, inspector panels become sheets and action docks use
an overflow menu; at 768px, navigator and content persist while optional panels
collapse; at 1280px+, a three-region workspace is allowed; at 1800px+, Canvas and
table density increase without increasing chrome.

Canvas: 1.5px directional edges, 0.55 inactive opacity, 0.9 active-path opacity;
minimap glass opacity 0.55 with a bright viewport outline; 8px node radius;
selected nodes gain a 2px focus border, running nodes a restrained status rail,
error nodes a labelled destructive rail, and sticky notes a semi-transparent
warm surface. The message hover dock appears in the top trailing corner, uses a
single compact row on wide panels, and collapses non-primary actions into More on
narrow panels.

Consent copy keys are authored in ru/en/zh-Hans together: `what_stays_local`,
`what_is_copied`, `never_indexed`, `revoke_sync`, `use_for_improvement`. Each row
has an icon, a one-sentence summary, an inline “Подробнее” disclosure and a
visible current state rather than a decorative checkbox.

## 4. Delivery waves

```text
W0  Preserve current Map P0 / fresh upstream baseline
W1  Rox Local Knowledge + remove required SiYuan path
W2  Performance + internal browser lifecycle/routing
W3  Message actions + memory proposals + collection activity view
W4  Things-style Tasks + Calendar connector framework
W5  Browser profile migration + protected credential vault
W6  Daytona runner adapter + command/skill registry
W7  Hard Rox brand/runtime/protocol migration + ru/en/zh-CN completion
```

Dependencies:

```text
W1 ─────┬── W3 memory proposals
         ├── W4 tasks/calendar links
         └── W5 browser history index
W2 ─────┬── W5 browser migration
         └── W6 cloud panels
W0 ─────┴── W7 hard branding migration
```

## 5. Acceptance criteria for W1

1. With SiYuan offline, New Note creates a Markdown document in the active
   workspace and immediately opens it.
2. The local provider lists notebooks/documents without any request to port 6806.
3. Existing SiYuan records are readable and untouched; no vault is silently copied
   or deleted.
4. Wikilinks, footnotes, aliases and backlinks survive file reload and index rebuild.
5. A note can reference a task, project, session and agent without leaking private
   credential values into the Markdown or search index.
6. Index rebuild from an empty SQLite file recovers the same document/link counts
   from the vault.
7. Kernel-offline, write-failure, conflict and corrupt-index states have explicit,
   localised recovery UI.
8. `KnowledgeRef` encodes local and legacy providers; no local action emits a
   `siyuan` route or port-6806 request.
9. New W1 tests cover provider dispatch, legacy-record read, provider-disabled
   state, local document creation, link/index rebuild and router navigation.

## 6. Acceptance criteria for W2/W3

1. Opening/closing an internal browser panel never clears the sessions navigator.
2. A transient browser registry failure retains the last known panels and shows a
   recoverable stale state.
3. Normal safe links open internally; policy exceptions are explicit and tested.
4. Unknown models show a neutral Rox agent badge, never an invented Anthropic badge.
5. Bulk table actions and long dropdowns use the shared styled menu surface.
6. A memory proposal cannot write until the user picks Global or This project.
7. Message highlight, reaction, thread and quick action are keyboard reachable and
   have loading/error states.
8. The shared menu surface enforces a searchable/max-height/virtualised long-list
   pattern for models, labels and projects.

## 6.1 Acceptance criteria for W4-W7

1. Tasks preserve project, heading, tag, date, recurrence, source and sync state.
2. Calendar connector conflicts have a visible resolution path and never silently
   overwrite a provider event.
3. Browser migration reports each imported/skipped category without revealing
   credentials; denied OS consent yields a recoverable partial completion.
4. Daytona runs expose start/ready/running/failed/cancelled/expired states and
   budget/TTL enforcement in both runtime and UI tests.
5. Hard Rox migration has a tested config/URI/data migration, rollback path, and
   translated strings before removal of compatibility aliases.

## 6.2 Benchmark harness

W2-B creates `scripts/bench/rox-ui-performance.ts`. It records User Timing marks
for session load, metadata refresh, grouping/sorting, route change, browser open
and dropdown open. Fixtures contain 10, 500 and 2,000 sessions. CI stores a
baseline artifact and fails only on an agreed regression threshold, not ambient
machine variance.

## 7. Out of scope for the first wave

- automatic cloud training from raw passwords, cookies or credentials;
- silent browser/keychain extraction;
- direct conversion of every historical SiYuan note;
- public session publication by default;
- hard branding/protocol cut before W1-W6 compatibility and migration checks.

## 7.1 First implementation tickets

1. **W1-A LocalMarkdownKnowledgeProvider:** provider/ref/schema/route migration
   and kernel-offline create/read/search tests.
2. **W1-B Vault index and editor states:** SQLite rebuild, wikilinks/entities and
   first-empty/write-failure/rebuild UI contract.
3. **W2-A Browser panel lifecycle:** hide/detach/destroy APIs, retained registry
   and internal-link policy table.
4. **W2-B Performance and menus:** bulk metadata payload, User Timing harness,
   model badge resolver and shared menu surface.
5. **W3-A Message actions and memory proposal:** persisted annotations/thread/
   proposal schema, review cards and scoped approval.
6. **W4 Tasks/Calendar:** Things-style IA, task schema and provider connector
   interface before individual OAuth integrations.
7. **W5 Browser migration:** discovery/import worker, consent/audit/deletion UX,
   encrypted vault boundary.
8. **W6 Daytona:** provider, settings, lifecycle conformance and budget/TTL.
9. **W7 Rox migration manifest:** public name, bundle/app id, URI schemes,
   persisted storage names, environment keys, deep links, compatibility aliases,
   migration version, rollback and removal deadline.

### Browser import matrix for W5

| Source | History/bookmarks | Cookies | Passwords/passkeys | Required approval |
| --- | --- | --- | --- | --- |
| Safari | supported when readable | only into encrypted operational partition | import only if supported by OS API | macOS privacy/keychain approval |
| Chromium family | supported per profile | only into encrypted operational partition | import only through supported encrypted-store path | profile + OS credential approval |
| Firefox | supported per profile | only into encrypted operational partition | import only through supported protected-store path | profile + OS credential approval |

Unsupported or locked stores must be reported as skipped, never bypassed. A partial
import remains useful and must not block history/bookmark import for the same
profile.

## 8. Test strategy

| Layer | Coverage |
| --- | --- |
| Unit | provider dispatch, Markdown parser/indexer, sync journal, consent state, URL policy, data redaction. |
| Integration | kernel offline note creation, vault/index rebuild, browser detach/reopen, bulk session metadata. |
| E2E | create note → link task/session → reopen; browser panel route lifecycle; memory proposal approve/edit/reject. |
| Performance | 10/500/2,000-session fixture timings; trace cold start and view switching. |
| Security | renderer cannot read credentials; consent revocation stops new sync; category-level export/delete. |

## 9. Rollback

Every wave is feature-flagged.  Disabling a provider or sync adapter never deletes
canonical Markdown or locally encrypted credentials.  Remote replicas are removed
only through a user-visible deletion request with a durable completion receipt.
