# White-label knowledge engine inside Rox (managed kernel, H1 now / H3 later)

- **Status:** draft, awaiting implementation plan after human review
- **Date:** 2026-08-20
- **Product:** Rox (`rox-one/rox-one`, Apache-2.0 fork of Craft Agents)
- **Supersedes for this cycle:** production stay on variant A only for *shipping* managed binary — product decision is OEM **C**; runtime stays fail-closed until signed terms land
- **Does not supersede:** ADR-001…006 in `docs/specs/2026-08-07-siyuan-integration/01-adrs.md` for v1
- **Related:** suite K (`docs/specs/2026-08-07-siyuan-integration/`), suite S (`docs/specs/2026-08-07-unified-shell/`), G1 (`g1-metrics.md`), G2 (`g2-decision-record.md`), NOTICE (`NOTICE-siyuan-boundary.md`)

## 1. Goal

Clicking **Знания** in the current Rox desktop shell must open a first-class notes workspace *inside this application*: full block editor (slash, highlights, callouts, databases inside notes), notebooks/folders, plugins with SiYuan plugin ABI, docks — **white-label** (no SiYuan name/chrome in product UI), **Russian-first**, visually matching Craft/Rox chrome 100%.

The user does not install a separate notes app. Rox hosts a pinned OEM kernel process. Canonical knowledge remains in that kernel. The agent still cannot silently overwrite knowledge.

Long-term intent (not this implementation cycle): **H3** — one process, one codebase. Recorded in §12 so it cannot drop off the backlog.

## 2. Decisions already accepted (this brainstorm)

| ID | Choice |
|---|---|
| License path | **C — OEM/commercial** with SiYuan rightsholder: bundle binary, white-label, closed installer |
| Product shape | **Full white-label knowledge engine** (goal 3) |
| Plugins | **E1** — same plugin ABI as upstream SiYuan; OEM catalog/whitelist, not public Bazaar |
| UI strategy | **W2** — OEM fork of kernel+UI source; rewrite skin, locale, chrome under contract C |
| Hosting | **H1 now** — Rox is the only window; kernel is a hidden process |
| Future | **H3 later** — merge stacks; explicit epic, not v1 |
| Repos | **Approach A** — two repositories, one installer payload |

## 3. Diagnosis of current integration (baseline)

What exists today in `rox-one/rox-one`:

- HTTP `KnowledgeProvider` under `packages/core/src/knowledge/providers/siyuan/` (search, get, backlinks, mutations).
- Electron embeds a **running** kernel web UI via `BrowserPaneManager` + `apps/electron/src/main/handlers/siyuan.ts` (durable keys, owner refcount, `EVALUATE`).
- Renderer: `KnowledgeNavigator`, `KnowledgeNotebookTree` (notebooks as a **flat list**, no folder tree, no databases filter), `KnowledgeHome` (search/proposals/views, empty-state “install SiYuan”), `KnowledgeInspector`.
- Production connection: **external-local** (`localhost:6806`). `mode: managed` is **fail-closed** (G2 OPEN).
- User-facing leak: `knowledge.openFullInterface` still opens full SiYuan desktop chrome; banners mention SiYuan.

What the reference recording shows (upstream SiYuan, 2026-08-20): Documents tree, date tabs, title “SiYuan”, Annotation list, Reservations, Table “Unnamed database”, Color/Highlight, status “Characters/Words/Blocks”. **That chrome must not appear in Rox.** The *editor capabilities* must.

## 4. Architecture (v1 = H1)

```
┌─────────────────────────────────────────────────────────┐
│ Rox Electron (Apache-2.0)                               │
│  shell · sessions · agent · permissions · inspector     │
│  Knowledge navigator (Craft chrome)                     │
│  WebContentsView → OEM editor (integrated mode)         │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP loopback + token (main process only)
┌──────────────────────────▼──────────────────────────────┐
│ Knowledge Bridge (existing)                             │
│  KnowledgeProvider · proposals · connections · metrics  │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│ OEM knowledge engine (separate private repo)            │
│  pinned binary in installer · plugin host · vault SQLite│
└─────────────────────────────────────────────────────────┘
```

- Rox never imports Go/TS sources of the fork into `apps/` or `packages/`.
- Bridge talks **only** public Kernel HTTP API (clean-room types already in core).
- Human typing in the editor writes **directly** in the kernel (live Protyle). Agent writes **only** `proposeMutation` → diff → approval (ADR-004).

## 5. Dual-repo and licensing

### 5.1 Repositories

| Repo | License / visibility | Contents |
|---|---|---|
| `rox-one/rox-one` | Apache-2.0, current public fork | Host, bridge, installer that *references* a pin |
| OEM engine repo (new, private) | Per OEM contract | Forked kernel + UI, ru-first, chrome stripped, catalog URL |

Installer ships a **pinned binary + checksum**, not the Apache tree sources of the fork.

### 5.2 G2 gate (engineering vs product)

- **Product and G2 record:** variant **C** is **ACCEPTED** (2026-08-20). Grant covers white-label, UI modification, plugin catalog, binary distribution, and **any platform Rox ships** (Windows, macOS, Linux/Debian, Android, iOS).
- Apache tree still must not vendor kernel sources. Installer payload + checksum enable `mode: managed`. Missing binary → external-local fallback, no download.
- Managed is the intended **default** for desktop Knowledge once the pin payload exists.

G1 numeric thresholds remain a *usage* gate for treating managed as proven; they do not block writing process-manager code behind the G2 flag, but they **do** block advertising managed as the only supported mode in release notes until filled or explicitly waived by product.

## 6. Connection modes

All three modes share one HTTP contract. Mode only chooses **who owns the process**.

### 6.1 Managed (v1 production default after G2/C)

- `SiyuanProcessManager` in Electron main: resolve pin from installer payload (env override in dev), allocate **ephemeral loopback port ≠ 6806**, generate `accessAuthCode`, store via `CredentialManager` as `source_apikey::<workspaceId>::siyuan`.
- Workspace path: `<configDir>/knowledge-workspaces/<connectionId>/`. Do not silently mount a user SiYuan vault.
- Health: pid watchdog (max 5 restarts, then `KERNEL_CRASHED`) + HTTP `POST /api/system/version` (5s, 3 failures → unreachable).
- Shutdown: SIGTERM 10s then SIGKILL of the process tree. `WORKSPACE_LOCKED` → clear stale pid or show diagnosis; never start a second writer on the same vault.
- Updates: `pinnedVersion` + checksum independent of Rox app version; snapshot workspace before pin bump; rollback binary on failed health.

### 6.2 External-local (dev / BYO vault)

User-run kernel on `:6806`. Detect-only, no download. Switching managed ↔ external-local does **not** copy notes; user points at a workspace path or a live port.

### 6.3 Remote (specified here, not spawned in this cycle)

Knowledge remote is **not** Rox headless (`CRAFT_SERVER_URL` / sessions RPC).

| | Rox headless | Knowledge remote |
|---|---|---|
| Process | Craft agent server | Notes kernel + vault |
| Transport | WebSocket RPC | HTTPS Kernel API + editor web UI |
| Who hosts | Operator of Rox server | User (self-host) or later OEM host — **not Rox SaaS in v1** |

UX: Settings → Знания → «Удалённый сервер»: `https://…`, token, certificate fingerprint (TOFU checkbox). Reject non-loopback `http://` (`TLS_REQUIRED`). Client forbids https→http downgrade. Timeouts 10s request / 60s heartbeat.

Editor: `WebContentsView` loads that origin in a **dedicated Electron partition** (not the agent browser partition). Token never in renderer. Plugins run **on the remote kernel**. Multiple Rox desktops can share one vault.

Rox must **not** host a modified kernel as a network service for customers in v1 (AGPL §13). Remote means the user’s server.

Implementation of remote TLS UI may ship in a follow-up PR after managed spawn; the type `SiyuanConnectionMode.remote` and error codes already belong to K-07 and must stay consistent.

## 7. Shell: click «Знания»

### 7.1 Layout (Craft chrome 100%)

Reuse existing three-column AppShell. Do not paste SiYuan Documents / date tabs / Annotation list / SiYuan status bar.

```
TopBar Rox (workspace, SurfaceTabs, ⌘K)
Rail | Navigator Знания | MAIN: OEM editor | Inspector Rox
```

- Rail: existing session/knowledge/… icons.
- Navigator: Craft `EntityList` / tree styling (same 12–13px type, hover, muted).
- Main: only the **block editor canvas** (integrated mode from the OEM fork).
- Inspector: Rox Agent / properties / outline / backlinks — not SiYuan Annotation list.

Minimum viable layout: Rail + Main (navigator collapsible as today).

### 7.2 Navigator information architecture

```
Знания
├── filter: Все | Заметки | Базы
├── + Блокнот / + Папка / + Заметка / + База
├── [notebook]            ← SiYuan notebook = «пространство»
│     └── [folder]
│           ├── [document]
│           └── [database]  ← same kernel object as an in-note DB block
├── Недавние
├── Избранное
└── Представления (Craft saved views)
```

- Tree is **recursive** (folders + docs + DBs), not a flat notebook list.
- Data from kernel APIs (`lsNotebooks`, doc tree, attribute views). Rox draws the tree; the kernel does not draw Documents.
- Filter **Базы** lists attribute-view / database nodes in that notebook.
- Creating notebook/folder/doc/database is a **user** action against the kernel (direct), shown immediately in the tree.
- Uncontracted sections (inbox/daily/tags) stay hidden until a real list endpoint exists — no fake empty “broken” rows.

Remove product CTA **«Открыть полный интерфейс SiYuan»**. Debug-only flag may keep full UI for support; default off; never labeled SiYuan in production copy.

### 7.3 Main surface — 100% editor capability

Must work in-app, matching the recording’s *functions*:

- Block editor with `/` slash (blocks, DB, plugin commands).
- Selection toolbar: bold/italic/highlight/color/font effects.
- Callouts, code, math, embeds as the pinned kernel supports.
- **Database block inside a note** (Table view, properties, + Add entry) and opening the same DB as its own surface tab `{ kind: "database" }`.
- Breadcrumbs of the document **inside the canvas** may remain if themed; they must not duplicate a second Documents sidebar.
- Plugin docks: additional `SurfaceDescriptor` / bounds via existing `syncBounds`; layout JSON stays in the kernel workspace; Rox only stores which durable surfaces are open.

Theming: OEM fork maps CSS variables to Rox theme tokens (background, selection, radius, fonts). Unstyled upstream gray chrome is a defect.

### 7.4 Input conflict table

| Conflict | Rule |
|---|---|
| Dual chrome | Kernel chrome stripped in W2 fork; host is Rox only |
| Dual tree | Kernel owns data; Rox owns pixels |
| Dual AI | Kernel AI/chat/model settings off |
| Slash vs ⌘K | `/` = editor; ⌘K = Rox commands |
| Cmd+N in Knowledge | New **note** in current notebook (session remains Cmd+N in Sessions mode) |
| Tabs | Only Craft `SurfaceTab`; no SiYuan date tab strip |
| Inspector | Annotations/reservations: port into Rox inspector later or omit until a Craft panel exists — do not show SiYuan side docks by default |
| Live edit vs ADR-004 | Human = live kernel; agent = proposals |
| Plugins | ABI unchanged; catalog is signed/whitelist; plugins that brand SiYuan fail catalog review |
| Remote origin | Separate partition; mixed-content and cookie policy documented in process manager / session config |

## 8. OEM fork (W2) requirements

The private fork must provide:

1. **Integrated mode** URL/query: editor without app shell, workspace switcher, global palette, bazaar UI, AI, about/splash branding.
2. **Default locale `ru`**. All user-visible fork strings localized; Rox host keeps 10-locale parity for *host* chrome.
3. **Brand strings:** product “Rox”, surface “Знания”. Word “SiYuan” absent from UI, installer display name, and about. Logs/NOTICE may mention provenance if the OEM contract requires it.
4. **Marketplace URL** replaced by OEM catalog endpoint; plugin ABI (`plugin.json`, docks, slash, kernel hooks) unchanged.
5. **Kernel HTTP API** compatible with `packages/core/.../siyuan` client for the pin window `[minKernel, maxKernel)`.
6. No second LLM runtime.

Pin argv (exact flags live in the fork’s pin doc, verified per version): workspace, port, access auth, lang. Port never 6806 in managed mode.

## 9. Error handling

Reuse K-07 codes: `SIYUAN_UNREACHABLE`, `AUTH_INVALID`, `VERSION_UNSUPPORTED`, `TLS_REQUIRED`, `TLS_INVALID`, `PORT_CONFLICT`, `WORKSPACE_LOCKED`, `KERNEL_CRASHED`, `TIMEOUT`. User-facing copy uses “ядро знаний” / “Знания”, not SiYuan.

Renderer never talks to kernel HTTP. Tokens never in logs (CredentialId only).

## 10. Testing

- Unit: navigator tree grouping, filter Все/Заметки/Базы, durable-key dedup, process-manager state machine (spawn/backoff/kill) with a fake binary.
- Conformance: P1 read + P3 proposal paths against pinned kernel HTTP.
- Smoke Electron: open Знания → create notebook → create note → type, slash-insert database, highlight text; no “SiYuan” in accessibility snapshot of product chrome.
- Managed: second Rox instance cannot lock the same workspace; app quit leaves no orphan.
- G2: CI fails if SiYuan sources/binaries appear in the Apache tree except documented pin metadata (checksum, version).

## 11. Out of scope (this spec’s implementation plan)

- H3 in-process merge.
- Rox-operated hosted kernel (SaaS).
- Arbitrary public Bazaar.
- Rewriting Protyle in React/shadcn.
- Bidirectional label↔tag sync; shared Entity DB (ADR-003/005).
- iOS Knowledge editor (read-only later).
- Filling G1 numeric thresholds (instrumentation already exists).

## 12. Future epic: H3 (must remain visible in-repo)

**Intent:** Rox will eventually run knowledge kernel **in-process** (or otherwise as one combined program): one process, one product, no HTTP arm’s-length boundary.

**Why not now:** Go kernel + Electron/Bun stack merge, combined-work legal review even under OEM, ADR-001/003 rewrite, years of isolation value.

**Forbidden until a dedicated ADR supersedes 001 and 003 *and* legal signs off:**

- Importing OEM engine source into `apps/` or `packages/` of this Apache repo
- Opening kernel SQLite from Rox
- In-process FFI/Go calls instead of HTTP
- Shared database of sessions + blocks

**Unlock checklist (future ADR-H3):**

- [ ] OEM contract allows combined work / in-process
- [ ] P1–P6 green on managed pin for N release trains
- [ ] Module map: which APIs stay a facade after merge
- [ ] Rebase cost of W2 fork is understood
- [ ] Explicit supersede of ADR-001 (host window may share process) and ADR-003 (storage still must not casually join session JSONL with kernel SQLite without a new model)

Track this epic as this file §12 and `plans/next-program/decisions/002-h3-in-process-knowledge-kernel.md` pointing here. Do not delete this section when implementing H1.

## 13. Implementation slices (for the later plan, not this commit)

1. Legal artifact: G2 ACCEPTED/C + pin checksum pipeline (no source in monorepo).
2. Process manager + managed default behind flag.
3. OEM fork integrated mode + ru + theme tokens.
4. Knowledge navigator recursive tree + filters + create actions.
5. Default click path: open last note / empty editor, not KnowledgeHome search as the only body.
6. Strip `openFullInterface` from production UI.
7. Plugin catalog whitelist + dock surfaces.
8. Remote HTTPS connection UI (after managed).
9. H3 epic ticket only (no code).

## 14. Acceptance (v1 H1)

- Fresh desktop install (post-G2): Знания works without installing SiYuan.
- Product UI has no SiYuan word or second app shell.
- User can create notebook, folder, note, in-note database, use slash and highlights.
- Agent edits still go through proposals.
- Apache tree still contains no kernel sources.
- §12 H3 intent is present in git history on `main` (or the landing PR).