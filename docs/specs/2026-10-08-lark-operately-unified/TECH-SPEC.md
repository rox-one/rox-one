# TECH-SPEC: Rox Unified Suite architecture, modules, APIs

**Version:** unified **v2**, 2026-10-08 (MSK) (v1 kept in `v1/`) · **Baseline:** `rox-one/rox-one` @ `aedff592` (read-only; all paths are proposals) · ✔ = exists at baseline, ✚ = new.

**v2 additions:**
- §10: storage root `~/rox` + migration;
- §11: collaboration technology;
- §12: cross-surface command contracts;
- §13: agent autonomy;
- §14: domain rule engine;
- §15: identity lifecycle;
- §16: personal Drive / quota / SeaweedFS;
- §17: Macro welcome research and clean-room adaptation;
- additions in §1, §5, §6, §7 and §8.

**v2.1 additions** (Mark, 2026-10-08):
- §18: agent panel context contract, runtime, privacy and dock engine;
- §19: surface chrome registry (sidebar and top bar schemas);
- §20: cross-functional capability contracts X-13…X-26;
- 3 new flags in §8.

**Layers used in every module section:**
- **Frontend (FE):** renderer: `apps/electron/src/renderer/{pages,components,platform,actions,atoms}`, shared UI `packages/ui`, webui host `apps/webui`.
- **Middleware (MW):**
  - domain + contracts in `packages/core/src/**` (types, zod schemas, command definitions, reducers, selectors, permission rules, resolvers);
  - protocol in `packages/shared/src/protocol` (WS-RPC channels, DTOs);
  - the **local authority** in `packages/server-core/src/**` (persistence, local command handlers, outbox/sync client, local push events).
- **Backend (BE):** `apps/workspace-service/src/modules/<m>/{commands,repository,routes,events,queries}.ts` ✚ (pattern of `modules/identity` ✔), migrations in `apps/workspace-service/migrations/` ✔, plus sidecars (Valkey, Hocuspocus, LiveKit, S3, Stalwart).

## 1. Architecture

```
┌──────────────────────────── Rox desktop (Electron 39) / webui ──────────────────────────────────┐
│ renderer: modes (modes-seed ✔) → surfaces → panels; Omnibox ✔; EntityChip/Card/Picker ✚         │
│   view state in jotai only; domain via commands/queries (ADR-0001 #9)                            │
│        │ WS-RPC (local) ✔                                                                         │
│ server-core ✔ (LOCAL AUTHORITY): personal tasks ✔, notes vault ✔, projects ✔, meetings journal ✔, │
│   ✚ local work store (goals/check-ins/kpis), ✚ entity-link store, ✚ command router,               │
│   ✚ workspace sync client (outbox ✔ pattern, realtime subscriber), ✚ resolver host                │
└───────┼───────────────────────────────── HTTPS (commands/queries) + WSS (realtime) ──────────────┘
        ▼
┌──────────────────────────── apps/workspace-service ✔ (WORKSPACE AUTHORITY, Bun) ────────────────┐
│ auth ✔ identity ✔ collaboration ✔ licenses ✔ │ ✚ commands(bus) ✚ events(outbox→Valkey) ✚ realtime │
│ ✚ directory ✚ acl ✚ social(links/comments/reactions/subscriptions) ✚ files ✚ search ✚ notify      │
│ ✚ im ✚ docs ✚ drive ✚ wiki ✚ tasks ✚ calendar ✚ vc ✚ goals ✚ projects ✚ checkins ✚ spaces ✚ kpis  │
│ ✚ templates ✚ tables(#1295) ✚ workplace ✚ mail(bridge) ✚ agents(MCP tools)                        │
│ v2: ✚ presence ✚ agents(governance: grants/approvals/audit/rate limits) ✚ rules(R1–R5) ✚ quota     │
└──┬────────────┬─────────────┬──────────────┬──────────────┬──────────────┬─────────────────────┘
 PostgreSQL 16  Valkey 8      S3 (SeaweedFS)  Hocuspocus     LiveKit+Egress  Stalwart (AGPL, JMAP only)
```

**Rules:**
1. Every mutation is a **command** routed by authority:
   - local refs go to the server-core handler;
   - workspace refs are queued in the outbox and sent to workspace-service.
   - The renderer never writes to stores directly.
2. **One orchestrator:** agent actions run through OMP / `ExecutionCoordinator` ✔. Agents call the same command bus via tools (M17). No new runtime or Cordis host. v2: the personal agent `@rox` and the domain rules follow the same rule (§13, §14).
3. **No universal entity DB:** the resolver queries owners; `entity_link` stores edges only (ADR-U09).
4. **Lark-shaped REST** (`/open-apis/...`) and **Operately-shaped operations** (`<ns>.<op>`) are *generated aliases* of the command registry. The canonical transport is `POST /v1/workspaces/{ws}/commands`.

## 2. Code layout

| Concern | Path | Status |
|---|---|---|
| Kind registry, refs, aliases, routes map | `packages/core/src/entities/{kinds,refs,aliases,routes}.ts` (re-exports `rox2/platform-contract.ts` ✔) | ✚ |
| Entity-link contract | `packages/core/src/entities/links.ts` (types, zod, relation vocabulary) | ✚ |
| Resolver / preview registry | `packages/core/src/entities/resolver.ts` (contract); `packages/server-core/src/entities/resolver-host.ts`; renderer `components/entities/preview-registry.tsx` | ✚ |
| Command bus contract | `packages/core/src/commands/{envelope,registry,receipt,errors}.ts` | ✚ |
| Permissions | `packages/core/src/entities/permissions.ts` (role lattice, matrix generator) | ✚ |
| Domain modules | `packages/core/src/{messenger,docs✔,tasks✔,calendar✔,meetings✔,contacts,goals,projects,spaces,kpis,social,notify,search,workplace,mail,templates}/` | mixed |
| Local stores | `packages/server-core/src/{tasks✔,work,entities,contacts,notes✔ (handlers/rpc/notes.ts),projects}/` | mixed |
| Sync client | `packages/server-core/src/workspace-sync/{outbox,client,realtime,share}.ts` (pattern from `packages/shared/src/team` ✔ and `protocol/native-replica.ts` ✔) | ✚ |
| Protocol | `packages/shared/src/protocol/channels.ts` ✔ (+ `commands:execute`, `entities:resolve`, `entities:links`, `entities:search`, `<module>:query`), `dto.ts` ✔ | extend |
| Renderer pages | `apps/electron/src/renderer/pages/{messenger,calendar,goals,contacts}/` ✚; `TasksPage` ✔, `NotesPage` ✔, `ProjectInfoPage` ✔, `MeetingsPage` ✔, `InboxPage` ✔, `HomeFrontPage` ✔, `SearchPage` ✔ | mixed |
| Renderer components | `components/{entities,messenger,docs,tasks,goals,projects,spaces,kpis,calendar,contacts,review}/` | ✚ |
| Modes | `renderer/platform/modes-seed.ts` ✔ (+4 entries), flags `packages/core/src/platform/workbench/flags.ts` ✔ (+ new flags, default false) | extend |
| Routes / deep links | `apps/electron/src/shared/{routes,route-parser}.ts` ✔, `apps/electron/src/main/deep-link.ts` ✔ | extend |
| Actions / shortcuts | `renderer/actions/definitions.ts` ✔ | extend |
| i18n | `packages/shared/src/i18n/locales/*` ✔ (12 files) | extend |
| Server modules | `apps/workspace-service/src/modules/<m>/` | ✚ |
| HTTP wiring | `apps/workspace-service/src/http.ts` ✔ → per-module route table `modules/<m>/routes.ts` | refactor |
| Migrations | `apps/workspace-service/migrations/02…52-*.sql` (DATA-MODEL §12) | ✚ |

## 3. M0 Platform contracts (wave 1)

### 3.1 Kind registry
```ts
// packages/core/src/entities/kinds.ts
export const ENTITY_KINDS = [...ROX2_ENTITY_KINDS, 'goal','goal-target','goal-check','check-in','review','okr-cycle','milestone',
  'space','kpi','kpi-entry','task-list','task-section','task-list-group','folder','drive-link','wiki-space','comment',
  'base','base-table','base-view','base-record','form','calendar','room','department','app','project-template',
  'decision','feed-item','workflow-run','radar-topic','agent-team','invitation'] as const   // 54 (v2: + invitation)
export type EntityKind = typeof ENTITY_KINDS[number]
export interface KindDescriptor {
  kind: EntityKind; owner: ModuleId; authorities: ('local'|'workspace'|'external')[]
  route(ref: EntityRef): string                    // rox:// route (DATA-MODEL §3.3)
  icon: IconName; labelKey: string                 // i18n
  capabilities: { comment: boolean; react: boolean; subscribe: boolean; share: boolean; embed: boolean; createFromChat: boolean }
  searchCategory?: SearchCategory
}
export function parseEntityRef(s: string): Result<EntityRef, RefError>   // alias normalisation (ADR-U08)
export function formatEntityRef(r: EntityRef): string
```
- **Contract test:** a round-trip property test over all kinds and aliases. Every kind must have a descriptor, a resolver and an i18n label (CI gate).

### 3.2 Entity links
```ts
export type Relation = 'parent'|'mentions'|'blocks'|'assigned'|'in-calendar'|'derived-from'|'attached-to'|'member-of'
                     | 'embeds'|'relates-to'|'aligned-to'|'resource-of'
export interface EntityLink { linkId: string; from: EntityRef; to: EntityRef; relation: Relation; role?: string;
  anchor?: { blockId?: string; seq?: number; line?: number; targetId?: string }; createdBy: string; createdAt: string; revision: number }
// commands: links.add, links.remove ; queries: links.outgoing(ref), links.backlinks(ref, {kinds?, relations?, cursor})
```
- **Local:** `packages/server-core/src/entities/link-store.ts` (SQLite `{workspaceRoot}/.craft/entity-links.sqlite`, WAL, indices on `(to_kind,to_id)`).
- **Server:** `modules/social` (`entity_link`).
- **Backlinks query = local ∪ server ∪ derived sources:**
  - vault wikilinks;
  - `work_item.origin_ref`;
  - message mentions;
  - the knowledge links store (read-only).
- Results are de-duplicated by `(from, relation, to)`.

### 3.3 Resolver and preview registry
```ts
export interface EntityPreview { ref: EntityRef; status: 'ok'|'no_access'|'minimal'|'tombstone'|'moved'|'unavailable';
  title: string; kindLabel: string; icon: string; container?: { ref: EntityRef; title: string }[]
  authority: 'local'|'workspace'|'external'; badges?: Badge[]; fields?: PreviewField[]; actions?: PreviewAction[]
  movedTo?: EntityRef; updatedAt?: string; etag: string }
export interface Resolver { kinds: EntityKind[]; resolve(refs: EntityRef[], actor: Actor): Promise<EntityPreview[]> }   // batch
// renderer
registerPreview(kind, { Chip?, HoverCard?, Card?, actions?(preview): PreviewAction[] })
```
- **Host:** server-core resolves local kinds directly. Workspace kinds are fetched in batch via `GET /v1/workspaces/{ws}/entities/resolve?refs=…`, which is ACL-checked per ref.
- **Caching:** an in-memory LRU (5k entries, etag); invalidated by realtime `entity.changed {ref, etag}`.
- **SLOs:** p95 ≤ 50 ms for a cached batch of 50; ≤ 150 ms uncached on LAN.
- **Unfurl:** the message send path extracts refs and web links and stores `content.unfurls[{ref}]`. The renderer renders `Card` via the registry, never server-rendered HTML.

### 3.4 Command bus
```ts
export interface CommandEnvelope<P> { commandId: string; idempotencyKey: string; type: CommandType;   // e.g. 'tasks.update_status'
  target?: EntityRef; expectedRevision?: number; payload: P; issuedAt: string; origin?: EntityRef /* derived-from */ }
export interface CommandReceipt { commandId: string; status: 'applied'|'duplicate'|'conflict'|'rejected'|'queued';
  ref?: EntityRef; revision?: number; eventIds?: string[]; conflict?: { currentRevision: number; current?: unknown };
  error?: { code: 'FORBIDDEN'|'NOT_FOUND'|'VALIDATION'|'AUTHORITY_MOVED'|'FENCE_MISMATCH'|'SERVER_REQUIRED'; message: string } }
export interface CommandDefinition<P> { type: CommandType; schema: ZodType<P>; authority: 'by-target'|'workspace'|'local';
  verb: Rox2Permission; mcp?: { name: string; description: string } ; larkRoute?: string; operatelyOp?: string }
```
- **Registry:** each module exports `commands: CommandDefinition[]`. A generator produces:
  - the RPC handler map;
  - REST routes;
  - the MCP tool catalogue (M17);
  - typed client helpers.
- **Local path:**
  1. renderer → `commands:execute` (WS-RPC) → server-core `CommandRouter`;
  2. if `target.authority=local`: the module's local handler runs the CAS write and emits a local push `<module>:changed`;
  3. if `workspace`: the command goes to the outbox (`SqliteReplicaOutbox` pattern) → `POST /commands`.
- **Server path:** `modules/commands` validates, authenticates (`verified-actor` ✔), checks ACL, opens a transaction, runs the module handler, writes `domain_event` + `command_receipt`, commits, publishes to Valkey, and returns the receipt.
- **AI path:** agent tool → ChangeProposal (existing) → on approval the same `CommandEnvelope` runs with `actor = user`, `onBehalfOf = bot`.

### 3.5 Events and realtime
- `domain_event` is written in the command transaction. A post-commit publisher pushes `rt:{topic}` to Valkey.
- **WS gateway** (`modules/realtime`, Phase-2 TECH-SPEC §3.3 frames: auth, subscribe, ack, typing, presence, ping; `event`, `snapshot_required`).
- **Topics:**
  - `user:{id}`: badges, notifications, Review counts, chat feed;
  - `channel:{id}`: messages, reactions, typing, tabs, pins;
  - `entity:{kind}:{id}`: generic changed / etag, comments, reactions;
  - `space:{id}`: feed and work-map deltas;
  - `task-list:{id}`;
  - `calendar:{id}`;
  - `doc:{id}`: comments and ACL; content via Hocuspocus;
  - `meeting:{id}`.
- **Event names:** DATA-MODEL §9.1. The bot webhook dispatcher maps them to Lark envelope names (`im.message.receive_v1` …).
- **Local push:** server-core forwards relevant workspace events to the renderer over the existing WS-RPC push (`pushTyped`), so the renderer has a single event stream.

### 3.6 ACL and directory
- **`modules/acl`:** `can(actor, verb, ref)` with role lattice, inheritance and contextual tags (DATA-MODEL §8), cached by `policy_epoch` ✔ in Valkey.
- **`modules/directory`:** principals (user / bot / guest / service), profiles, departments, contact cards, invites. It reuses `workspace_member` ✔ and `auth_subject_alias` ✔.
- **Local:** `packages/server-core/src/contacts/` holds contact cards when offline. Members come only from the server directory or `orgs.json` (MIG-08); the system never invents people.

### 3.7 Social (comments, reactions, subscriptions)
- **`modules/social`:** commands `comments.create/edit/delete/resolve`, `reactions.add/remove`, `subscriptions.subscribe/unsubscribe/set_notify_everyone`.
- Mentions in comment content auto-subscribe the mentioned principal and emit `entities.mentioned_people`.
- **Local entities** have no server comments. `TeamLocalState` comments ✔ remain until share (MIG-09).

### 3.8 Search provider contract
```ts
export interface SearchProvider { id: string; categories: SearchCategory[]; search(q: SearchQuery, actor: Actor): Promise<SearchHit[]> }
```
- **Local providers** (server-core): `notesVault` (FTS5 ✔), `personalTasks`, `sessions` ✔, `localWork`, `sources` ✔, `memory` ✔.
- **Server provider:** `search` (Postgres FTS). The Omnibox merges and groups them (UI-SPEC §3.4).

### 3.9 Shared UI primitives
- Components in UI-SPEC §4 go into `apps/electron/src/renderer/components/entities/` and `packages/ui/src/components/{status-badge,person-field,contextual-date,privacy-field,comments,reactions,activity-timeline,gantt,pie-progress}`.
- TipTap extensions: **EntityMention** (node `{type:'mention', ref}`), **EntityEmbed** (block card), **CollaborationCursor** (Yjs, shared docs only). They are added to `packages/ui/src/components/markdown/` ✔ next to WikiLink ✔. Markdown serialisation: mention → `[[kind:id|label]]`, embed → `![[kind:id]]` (wiki-link compatible, so the vault indexer records them).

## 4. Modules

Each module lists FE / MW / BE, its commands, queries, realtime events and REST aliases. Command names follow Operately operation names where one exists (so the MCP catalogue maps 1:1) and Lark names for Lark-only concepts.

### 4.1 M1 Messenger
- **FE:**
  - `pages/messenger/MessengerPage.tsx`;
  - `components/messenger/*`: Phase-2 list (`FilterColumn`, `ChatList`, `ChatRow`, `ChatHeader`, `ChatTabs`, `MessageList` with `@tanstack/react-virtual`, `MessageItem`, `InteractiveCard`, `Composer` on TipTap ✔, `EmojiPicker` emoji-mart, `SidePanelFrame`, quick panels, settings panels, dialogs);
  - ✚ `SlashPalette`, `ComposerCreateMenu`, `EntityUnfurl` (uses the preview registry), `SpaceChatTabs`, `AskRoxAction`.
  - The mode entry is in `modes-seed.ts` (order 25, flag `workbench.mode.messenger.v1`). Panel kinds: `chat.quick.{docs,tasks,calendar,contacts,goals}`, `chat.search`, `chat.settings`, `thread`.
- **MW:**
  - `packages/core/src/messenger/{types,commands,selectors,unfurl,slash}.ts`. Slash command definitions map to other modules' commands, so Messenger only depends on the **contracts** of tasks / docs / goals / calendar / meetings.
  - Natural-language parsing reuses `tasks/personal/quick-entry.ts` ✔.
  - server-core `workspace-sync` holds the per-chat message cache (SQLite, windowed) and the outbox for sends.
  - **Gateway bridge:** `packages/messaging-gateway` ✔ adds a `RoxChatBridge` sink that mirrors bound external chats into `chat(external_source)`. Agent chats bind a bot principal to a session via the existing binding store ✔.
- **BE:** `modules/im` (Phase-2 TECH-SPEC §4.2–§4.7, with the DATA-MODEL §5.3 changes); migration `12-im.sql`.
- **Commands:**
  - `im.create_chat`, `im.update_chat`, `im.disband_chat`, `im.get_or_create_p2p`;
  - `im.add_members`, `im.remove_members`, `im.update_member_state` (mute / flag / pin / done / alias / header_buttons / open_panel);
  - `im.update_policy`;
  - `im.send_message` (with `unfurls`, `mentions`), `im.edit_message`, `im.recall_message`, `im.forward_messages`;
  - `im.pin`, `im.unpin`, `im.set_top_notice`, `im.update_announcement`;
  - `im.create_tab`, `im.update_tab`, `im.delete_tab`;
  - `im.mark_read`, `im.mark_unread`;
  - `im.create_label`, `im.label_chats`;
  - `im.create_space_chat` (internal; called by `spaces.create`), `im.create_entity_chat`.
- **Queries:** `im.list_chats`, `im.history`, `im.search` (via search), `im.quick_panel(chat, kind)` (aggregates `entity_link` + ACL), `im.read_users`.
- **Realtime:** `channel:{id}` and `user:{id}` (Phase-2 TECH-SPEC §4.4), plus `unfurl.updated {message_id}` when a referenced entity's etag changes for visible messages. The client subscribes to the `entity:*` topics of visible cards.
- **REST aliases:** `/open-apis/im/v1/*` exactly as Phase-2 TECH-SPEC §4.3. `chat_link` routes are replaced by `/open-apis/im/v1/chats/:id/quick/{docs,tasks,calendar,members,goals}`.

### 4.2 M2 Docs (= Notes), Wiki, Drive
- **FE:**
  - `pages/notes/*` ✔ extended with `DocsHomeView`, `DocChrome` (header / Share / ··· / TOC / comments wrapper around `NotesViewHost` ✔), `ShareMoveDialog`, `PermissionSettingsDialog`, `VersionHistoryPanel`, `WikiView`, `DriveFolderView`, `AddLinkDialog`, `PostList` / `PostEditor` / `PostPage`, `DocsAndFilesEmbed` (used by goals / projects / spaces).
  - Editor: the TipTap stack ✔ plus `@tiptap/extension-collaboration` and `-collaboration-cursor` (MIT) with `y-prosemirror`. These are active only when `authority=workspace`.
- **MW:**
  - `packages/core/src/docs/*` ✔ adds `share-migration.ts` (Markdown → ProseMirror JSON → Yjs, round-trip rules per extension), `doc-authority.ts` (authority state machine), `comments-anchor.ts`.
  - server-core `handlers/rpc/notes.ts` ✔ adds guard `AUTHORITY_MOVED` on saves to migrated notes, writes `rox_authority` frontmatter, and applies server Markdown snapshots to the read-only mirror (self-write suppression ✔).
  - The vault index ✔ indexes mirrors normally.
- **BE:**
  - `modules/docs` (doc, snapshots, posts, publish / schedule worker);
  - `modules/drive` (folder, folder_item, drive_link, recent, favourites; files via `modules/files`);
  - `modules/wiki`;
  - Hocuspocus sidecar with a Postgres extension storing `doc_yjs_update` and an auth hook calling `acl.can`;
  - snapshot worker (idle 10 s / 50 updates → Markdown via the shared serializer, executed in Bun with the same TipTap schema package).
  - Migrations: `10-docs.sql`, `11-drive-wiki.sql`, `04-files.sql`.
- **Commands:**
  - `docs.create_document`, `docs.move_note_to_shared` (MIG-10, idempotent), `docs.move_back_to_private`;
  - `docs.update_title`, `docs.publish_post`, `docs.schedule_post`, `docs.restore_version`, `docs.set_public_sharing`, `docs.update_permissions`;
  - `drive.create_folder`, `drive.rename_folder`, `drive.move_items`, `drive.add_link`, `drive.upload_file` (resumable), `drive.favorite`, `drive.add_shortcut`;
  - `wiki.create_space`, `wiki.move_node`.
  - Operately aliases: `documents.*`, `resource_hubs.*` → these.
- **Queries:** `docs.home(tab, filter, cursor)` merges private notes (server-core `notes:list` ✔) with the server docs list; `docs.versions`, `drive.list(folder)`, `wiki.tree`.
- **Realtime:** `doc:{id}` (comments, acl, snapshot_written), Hocuspocus awareness for presence.
- **REST aliases:** `/open-apis/docx/v1/documents`, `/open-apis/drive/v1/files|folders|medias/*`, `/open-apis/wiki/v2/spaces/*`.

### 4.3 M3 Tasks (WorkItem)
- **FE:**
  - `pages/TasksPage.tsx` ✔ and `pages/tasks/*` ✔: `TaskSidebar` gains Lark sections; ✚ `LarkListView` (TanStack Table ✔ + virtual), `KanbanView` (dnd-kit), `StatusBoardView`, `MilestoneGroupedList`, `TableView`, `GanttView` (shared), `TaskToolbar` (Ongoing / Filter / Sort / Group / Customize / Display), `ManageStatusesDialog`, `SharePrompt`;
  - `TaskDetail` ✔ becomes the merged detail pane (UI-SPEC §7.3);
  - `QuickEntry` ✔ is reused by Messenger `/task` and the quick panels.
- **MW:**
  - `packages/core/src/tasks/personal/*` ✔ moves to schema v3 (`types.ts`, `store.ts` reducers, `projections.ts` adds views: owned, subscribed, assigned, created, completed, by status / milestone / list / section);
  - ✚ `tasks/views.ts` holds stored view definitions (filter / sort / group / columns), ADR-0001 "views are stored queries";
  - ✚ `tasks/status-sets.ts`, `tasks/share.ts`.
  - server-core `tasks/personal-persist.ts` ✔ adds v3 read/write, MIG-01/02/03 migrators and the `share` flow (upload + tombstone).
  - `personalTasks:*` channels ✔ stay as adapters over `commands:execute`.
  - **Reminders:** the existing delivery ✔ is extended with the offsets / due-day / overdue rules. Shared reminders fire server-side (`notify`) and locally (OS) for the owner device.
- **BE:** `modules/tasks` (work_item, members, user_state, lists, sections, groups, in_list, statuses, reminder scheduler); migration `20-work-item.sql`.
- **Commands:**
  - `tasks.create`, `tasks.update` (title / notes / dates / priority / size / custom fields), `tasks.update_status`, `tasks.complete`, `tasks.reopen`, `tasks.cancel`, `tasks.archive`, `tasks.delete`, `tasks.duplicate`, `tasks.move` (list / section / project / space / milestone);
  - `tasks.update_assignees`, `tasks.set_user_state` (When / Today / evening / order: per user);
  - `tasks.add_to_list`, `tasks.remove_from_list`;
  - `tasks.share` (authority move);
  - `tasks.add_dependency`, `tasks.update_reminders`;
  - `task_lists.create/update/archive/delete`, `task_sections.create/update/move/delete`, `task_list_groups.create/update/delete`;
  - `task_statuses.update_set` (Operately "Customize statuses").
  - Operately aliases: `tasks.*`, `projects.update_task_statuses`, `spaces.update_task_statuses`. Lark alias `/open-apis/task/v2/*`.
- **Queries:** `tasks.view(viewDef, cursor)` (local ∪ server merged by id; the authority decides the winner), `tasks.counts`, `tasks.activity(task)`.
- **Realtime:** `task-list:{id}`, `entity:task:{id}`, `user:{id}` (assigned / subscribed counters).

### 4.4 M4 Calendar
- **FE:** `pages/calendar/*` ✚ on FullCalendar standard (MIT): `CalendarSidebar`, `EventPopover`, `EventDialog`, `EventDetailPanel`, `RoomsGrid` (in-house), `OverlayToggles`; `CalendarStatusStrip` ✔ reused.
- **MW:**
  - `packages/core/src/calendar/*` ✔ (types, merge, occurrences, store) gains ✚ adapters `google.ts`, `microsoft.ts`, `caldav.ts` (tsdav MIT, ical.js MPL-2.0, rrule BSD) behind the existing adapter interface. `FixtureCalendarAdapter` ✔ stays for tests.
  - Credentials come via the identity broker ✔ (never in the renderer).
  - Overlays are projections of tasks / milestones / check-ins (no event rows).
- **BE:** `modules/calendar` (workspace calendars, events, attendees, rooms, free/busy aggregation); migration `21-calendar.sql`.
- **Commands:** `calendar.create_event`, `calendar.update_event`, `calendar.delete_event`, `calendar.rsvp`, `calendar.create_calendar`, `calendar.subscribe`, `calendar.book_room`.
- **Queries:** `calendar.range(calendars, from, to)`, `calendar.freebusy(principals, from, to)`.
- **Realtime / REST:** `calendar:{id}`; `/open-apis/calendar/v4/*`.

### 4.5 M5 Meetings (VC)
- **FE:** `pages/MeetingsPage.tsx` ✔ adds `MeetingsLanding`, `JoinForm`, `InCallView` (`@livekit/components-react`, Apache-2.0), `InCallPanels`.
- **MW:** `packages/core/src/meetings/model.ts` ✔ is unchanged; `MeetingRoomBinding` is added. server-core `meetings/*` ✔: capture / transcription / proposals are reused. `sourceBinding` records the LiveKit room.
- **BE:** `modules/vc` (LiveKit token minting with `livekit-server-sdk`, room lifecycle, Egress recordings to S3); migration `30-vc.sql`.
- **Commands:** `vc.start_meeting(origin?)`, `vc.join`, `vc.end`, `vc.set_recording(consent)`. The existing proposal approve / execute flow is unchanged.
- **Realtime:** `meeting:{id}`; bot webhook `vc.meeting.all_meeting_ended_v1`.

### 4.6 M6 Contacts / People
- **FE:** `pages/contacts/*` ✚: `ContactsSidebar`, `DirectoryTable`, `OrgChart` (`@xyflow/react` ✔ + dagre), `ProfilePage` (Operately tabs), `PersonCard` (hover / DM panel); Dossier screen ✔ is rewired to `contacts` queries.
- **MW:** `packages/core/src/contacts/*` ✚; server-core `contacts/` local store and MIG-06 migrator (reads renderer localStorage once via a one-shot IPC export, then deletes the key after a verified write).
- **BE:** `modules/directory`; migration `02-directory.sql`.
- **Commands:** `people.update_profile`, `people.set_manager`, `people.invite`, `people.convert_to_guest`, `contacts.create_card`, `contacts.update_card`, `contacts.merge_cards`, `contacts.star`, `contacts.add_touch`.
- **REST:** `/open-apis/contact/v3/*`.

### 4.7 M7 Goals & OKR
- **FE:** `pages/goals/*` ✚ (mode `goals`):
  - `GoalsHome`, `WorkMapPage` (TanStack Table tree + `GanttView`), `AddItemModal`;
  - `GoalPage` (tabs, `TargetsSection`, `ChecklistSection`, `SubgoalsTree`, `ContributorsSection`, sidebar fields), `GoalCloseFlow`, `GoalReopenFlow`, `RetrospectivePage`;
  - `MyOkrsPage`, `AlignmentPage`, `ReviewsPage`, `CyclesSettings`.
  - **Operately TurboUI reuse:** port or adapt components under Apache-2.0 (§7).
- **MW:**
  - `packages/core/src/goals/{types,commands,progress,status,cadence,okr-compat}.ts`. `progress.ts` implements the Operately formula plus Rox `OkrProgress`; `status.ts` implements derived status.
  - The local work store is `packages/server-core/src/work/goals-store.ts` (JSON-per-entity with CAS).
  - MIG-04 migrator in `packages/shared/src/projects/okr.ts` ✔ (reader) → goals.
- **BE:** `modules/goals` (goal, target, check, cycle; scheduler: next check-in due, outdated marking, reminders); migration `22-goals.sql`.
- **Commands** (Operately names):
  - `goals.create`, `goals.update_name`, `goals.update_description`, `goals.update_parent_goal`, `goals.update_start_date`, `goals.update_due_date`, `goals.update_champion`, `goals.update_reviewer`, `goals.update_space`, `goals.update_access_levels`;
  - `goals.create_target`, `goals.update_target`, `goals.update_target_value`, `goals.update_target_index`, `goals.delete_target`;
  - `goals.create_check`, `goals.update_check`, `goals.toggle_check`, `goals.update_check_index`, `goals.delete_check`;
  - `goals.close`, `goals.reopen`, `goals.delete`;
  - ✚ `goals.align` / `goals.unalign`, `okr.create_cycle`, `okr.publish_cycle`, `okr.publish_objectives`, `okr.import_from_cycle`, `goals.set_target_status_override`.
- **Queries:** `work_map.get(scope, tab, filters)` (goals + projects tree with derived status / progress / next step), `goals.get`, `okr.my(cycle, person)`, `goals.alignment_tree`.
- **Realtime:** `entity:goal:{id}`, `space:{id}` (work map deltas).
- **REST aliases:** `/open-apis/okr/v1/*` (Lark), `/api/goals/*` (Operately-shaped, generated).

### 4.8 M8 Projects
- **FE:**
  - `pages/ProjectInfoPage.tsx` ✔ is replaced by `pages/goals/ProjectPage.tsx`; the old content moves to `ProjectWorkspaceTab` (existing components ✔ reused verbatim: `ProjectTimeline`, `ProjectRequirements`, `ProjectInputs`, `ProjectAiPanel`, `roadmap-ui`).
  - ✚ `MilestonesSection`, `ResourcesSection`, `ContributorsSidebar`, `PauseResumeFlow`, `ProjectCloseFlow`, `MilestonePage`.
- **MW:**
  - `packages/shared/src/projects/{types,storage,roadmap}.ts` ✔ gains new `ProjectConfig` fields and `milestones.json` storage.
  - `packages/core/src/projects/*` ✚ holds commands, progress and next step.
  - MIG-05 migrator.
  - The shared-project projection ✔ (`SharedProjectProjection.tsx`, `ProjectAuthorityConnectionPanel.tsx`) becomes `projects.share`.
- **BE:** `modules/projects` (extends the existing `project` table; `project_member`, `milestone`; auto task list + folder on create); migration `23-projects.sql`.
- **Commands:**
  - `projects.create`, `projects.update_name`, `projects.update_description`, `projects.update_parent_goal`, `projects.update_champion`, `projects.update_reviewer`;
  - `projects.add_contributor`, `projects.update_contributor`, `projects.remove_contributor`;
  - `projects.update_dates`, `projects.pause`, `projects.resume`, `projects.close`, `projects.move`, `projects.delete`, `projects.share`;
  - `projects.add_resource`, `projects.remove_resource`;
  - `milestones.create`, `milestones.update`, `milestones.complete` (with an open-task policy), `milestones.reopen`, `milestones.delete`, `milestones.reorder`.
- **Queries:** `projects.get`, `projects.milestones`, `projects.resources`.

### 4.9 M7/M8 shared: check-ins and reviews (package CHK)
- **FE:** `components/goals/checkins/*`: `CheckInForm` (goal / project variants), `CheckInPage`, `CheckInCard`, `AcknowledgeButton`, `SchedulePosting`, `SubscriberPicker`, `DraftWithRoxButton`.
- **MW:** `packages/core/src/goals/checkins.ts` (shared types, 3-day edit lock, cadence calculator: monthly on the 1st for goals, weekly first Friday for projects; configurable).
- **BE:** `modules/checkins` (check_in, review; scheduler workers for due reminders, outdated, scheduled publishing); migration `24-check-ins-reviews.sql`.
- **Commands:**
  - `goals.create_check_in`, `goals.update_check_in`, `goals.delete_check_in`, `goals.acknowledge_check_in`;
  - `projects.create_check_in`, `projects.update_check_in`, `projects.delete_check_in`, `projects.acknowledge_check_in`;
  - `reviews.create` (via close), `reviews.acknowledge`, `reviews.create_cycle_review`.
- **Side effects** (in the same transaction, via events): update subject `last_check_in_*` and `next_check_in_due_at`; post the card to linked chats (`im.send_message` as the system bot; card action `card.action.trigger` → acknowledge).

### 4.10 M9 Spaces
- **FE:** `pages/goals/spaces/*`: `SpacePage` (tool cards), `NewSpaceDialog`, `ToolsConfig`, `SpaceAccessPage`, `SpaceKanban` (Tasks StatusBoardView bound to the space list), `SpaceDiscussions` (M2 posts).
- **MW:** `packages/core/src/spaces/*`.
- **BE:** `modules/spaces`. `spaces.create` runs `im.create_space_chat`, `drive.create_folder(owner=space)` and `task_lists.create(owner=space)` in **one transaction**, and returns one receipt with all refs (ADR-U07). Membership changes fan out to the chat members and ACL. Migration `09-spaces.sql`.
- **Commands:** `spaces.create`, `spaces.update`, `spaces.update_tools`, `spaces.add_members`, `spaces.remove_member`, `spaces.update_members_permissions`, `spaces.update_general_access`, `spaces.join`, `spaces.leave`, `spaces.delete` (confirm name).

### 4.11 M10 Review, activity, notifications
- **FE:**
  - `pages/inbox/*` ✔: ✚ `ReviewView`, `NotificationsView`, `MentionsView`; new `InboxKind` values in `inbox-model.ts` ✔ (`review`, `mention`, `assignment`, `notification`);
  - Feed ✔ Team tab → `ActivityFeed` with renderers per event type (`components/review/renderers/<module>.tsx`);
  - Assistant cards in Messenger.
- **MW:** `packages/core/src/notify/{types,review,renderers-contract}.ts`. The Review query is local (local entities due) ∪ server (`review.get`). OS notifications ✔ go through `apps/electron/src/main/notifications.ts` with `rox://` deep links ✔.
- **BE:**
  - `modules/notify`: fan-out consumer of `domain_event` → `notification` per the audience rules (DATA-MODEL §9.2); email batching worker (window per `notification_pref`); daily summary worker; Assistant system bot posting cards.
  - Email transport: through the rox.one mail backend (Stalwart JMAP submission) when outbound is enabled. Otherwise in-app only.
- **Commands:** `notifications.mark_read`, `notifications.mark_all_read`, `notifications.update_prefs`.
- **Queries:** `review.get` (groups), `feed.list(scope, cursor)`, `notifications.list`.

### 4.12 M11 KPIs
- **FE:** `pages/goals/kpis/*` (cards, detail with ECharts Apache-2.0, LogUpdateDialog, annotations).
- **MW:** `packages/core/src/kpis/*`; local store in `work/kpis`.
- **BE:** `modules/kpis` (+ cadence scheduler); migration `25-kpi.sql`.
- **Commands:** `kpis.create`, `kpis.update`, `kpis.delete`, `kpis.log_entry`, `kpis.edit_entry`, `kpis.delete_entry`, `kpis.add_annotation`, `kpis.edit_annotation`, `kpis.delete_annotation`.

### 4.13 M12 Base & Forms
- Follows `docs/unified-tables/{PRD,TECH-SPEC,IMPLEMENTATION-PLAN}-V2` ✔ (#1295; first slice `a428eb4` TableSurface codec ✔).
- **FE:** `pages/base/*` with Part B §6 UI; Grid on TanStack ✔; Kanban dnd-kit; Gantt shared; Calendar via FullCalendar; Form builder in-house.
- **MW:** `packages/core/src/bases/*` ✔ adds source adapters (`adapter:tasks|goals|projects|notes|meetings`) mapping field edits to owner commands; formulas via `@formulajs/formulajs` (MIT).
- **BE:** `modules/tables`; migration `40-tables.sql`.
- **Forms:** `/forms/v1/:share_token` public fill (rate-limited).

### 4.14 M13 Search
- **FE:** Omnibox providers ✔ extended (`platform/omnibox-entities.ts` ✚), `SearchPage` ✔ → Advanced search.
- **MW:** provider contract §3.8; local providers.
- **BE:** `modules/search` (indexer consumer, `search_document`, `/v1/workspaces/{ws}/search?q=&kinds=&space=&cursor=`); Meilisearch CE later behind the same interface; migration `07-search.sql`.

### 4.15 M14 Workplace, M15 Email, M16 Templates & export, M17 Agents & MCP
- **Workplace:** FE `platform/home/AppsSection.tsx`; BE `modules/workplace` (`51-workplace.sql`). Apps = surfaces, Pages ✔, integrations ✔ (`IntegrationsCatalogPage`), bots.
- **Email:** FE `pages/inbox/mail/*` ✔ → Lark layout; MW `packages/shared/src/mail/*` ✔ and `apps/electron/src/main/mail/*` ✔ unchanged; BE `modules/mail` maps principals ↔ Stalwart accounts (`52-mail.sql`). Commands `mail.share_to_chat`, `mail.create_task_from_thread`.
- **Templates & export:** `modules/templates` (`26-templates.sql`). Commands `project_templates.create_from_project`, `project_templates.create_project`, `exports.markdown(goal|project|doc)` (shared serializer; "Save to Docs" creates a private note via `notes:create` ✔).
- **Agents & MCP** (#1113):
  - the command registry generates MCP tools (`goals_*`, `projects_*`, `milestones_*`, `tasks_*`, `spaces_*`, `docs_*`, `comments_*`, `people_*`, `search`, `fetch`, mirroring Operately's catalogue);
  - they are exposed to OMP sessions as Rox tools and externally via the MCP endpoint with scoped grants (View only / Edit only / View and edit; Operately page semantics in Settings);
  - every write tool returns a ChangeProposal unless the grant allows auto-apply;
  - the "Check-in drafting" skill (Rox skill catalogue ✔) composes queries: tasks completed, milestones, linked chats, doc edits since the last check-in.

## 5. Realtime event catalogue

Realtime runs over the existing `ws` ✔ gateway: one socket per client, topic subscriptions are ACL-checked on subscribe, and the server pushes `{topic, type, seq, payload}`. Locally, server-core re-emits the same envelope over WS-RPC push, so renderer code is identical in both modes.

| Topic | Event types (payload = entity ref + changed fields + etag) | Producer |
|---|---|---|
| `user:{id}` | `notification.created`, `notification.read`, `review.changed`, `chat.feed_updated`, `chat.unread_changed`, `task.assigned`, `mention.created`, `presence.changed` | notify, im, tasks |
| `channel:{id}` | `message.created`, `message.edited`, `message.recalled`, `reaction.changed`, `pin.changed`, `chat.updated`, `member.added`, `member.removed`, `tab.changed`, `typing`, `read.changed`, `unfurl.updated` | im |
| `doc:{id}` | `comment.created/updated/resolved`, `acl.changed`, `snapshot.written`, `doc.moved`, `doc.deleted` | docs, social |
| `entity:{kind}:{id}` | `entity.updated`, `entity.deleted`, `entity.moved` (authority), `link.added`, `link.removed`, `comment.*`, `reaction.changed` | every module via the outbox |
| `task-list:{id}` | `task.created`, `task.updated`, `task.moved`, `task.deleted`, `section.changed`, `status_set.changed` | tasks |
| `space:{id}` | `workmap.changed` (goal / project rows), `space.updated`, `space.members_changed`, `discussion.posted`, `kpi.entry_logged` | goals, projects, spaces, docs, kpis |
| `calendar:{id}` | `event.created/updated/deleted`, `rsvp.changed` | calendar |
| `meeting:{id}` | `meeting.started`, `meeting.ended`, `recording.ready`, `transcript.ready`, `proposal.created` | vc, meetings |
| `workspace:{id}` | `directory.changed`, `flags.changed`, `space.created` | directory, admin |
| `user:{id}` (v2 additions) | `approval.requested`, `approval.decided`, `agent.reported`, `agent.rate_limited`, `quota.threshold`, `invite.status_changed`, `rule.failed` | agents, drive, identity, rules |
| `entity:{kind}:{id}` (v2 additions) | `presence.viewers`, `suggestion.created/decided`, `comment.thread_resolved/reopened` | presence, docs, social |
| `channel:{id}` (v2 additions) | `member.pending_added`, `member.activated` (placeholder → active) | im, identity |
| `drive:{id}` (v2) | `file.uploaded`, `file.version_added`, `file.trashed/restored/purged`, `usage.changed`, `preview.ready` | drive |
| `calendar:{id}` (v2 additions) | `calendar.members_changed` | calendar |

**Rules**
- Each event is the projection of exactly one `domain_event` row; `seq` is per topic. A client that detects a gap refetches through the query API (`?since=seq`).
- Events never carry content the subscriber cannot read: per-subscriber filtering by `acl.can(view)` for `entity:*`, and secret / private goals are omitted from `space:*` deltas.
- Unfurl staleness: the client keeps a `Map<ref, etag>` for visible cards and refetches previews on `entity.updated` with a newer etag. No message rewrite happens.
- Activity types (DATA-MODEL §9.1) map 1:1 to `domain_event.type`. Operately's 141 activity names are preserved verbatim for goal / project / space / task / milestone events (`goal_check_in`, `project_paused`, `task_status_updating`, …), so renderers port directly.

## 6. Open-source components and licences

The licence policy and the 31-row table from Phase-2 TECH-SPEC §12 apply unchanged (`reference/lark-final/TECH-SPEC.md`). In short:
- Rox is Apache-2.0. MIT / Apache / BSD / ISC are fine; MPL-2.0 is fine as a dependency.
- GPL / AGPL only as a separate process (Stalwart pattern).
- No source-available licences (SUL, BUSL, RSAL / SSPL, tldraw, NocoDB ≥ 0.301).

**Additions and confirmations for the unified scope:**

| Area | Choice | Licence | Note |
|---|---|---|---|
| Collaborative docs | Yjs, `y-prosemirror`, `@tiptap/extension-collaboration(-cursor)`, **Hocuspocus** server + `@hocuspocus/extension-database` | MIT | Persistence in our own Postgres table; no Tiptap Cloud |
| Gantt view | **frappe-gantt** (or the in-house SVG view from `ProjectTimeline` ✔ if perf requires) | MIT | One shared `GanttView` for Tasks, Work Map, Base and Project Workspace |
| Charts (KPIs, OKR, Base dashboards) | **Apache ECharts** | Apache-2.0 | — |
| Org chart, alignment tree | `@xyflow/react` ✔ + `dagre` | MIT | — |
| Drag and drop | `@dnd-kit/*` (already in Rox) | MIT | Operately uses pragmatic-drag-and-drop (Apache-2.0); we keep dnd-kit for consistency |
| Calendar | FullCalendar standard, `rrule`, `ical.js`, `tsdav` | MIT / BSD / MPL-2.0 / MIT | Rooms grid in-house |
| Meetings | LiveKit server, Egress, `livekit-client`, `@livekit/components-react`, `livekit-server-sdk` | Apache-2.0 | — |
| Search | Postgres FTS (`ru` + `simple`), later Meilisearch CE | PostgreSQL / MIT | — |
| Natural-language dates | existing `quick-entry.ts` ✔; `chrono-node` for EN fallback | own / MIT | — |
| Suggestion mode (v2) | **`@handlewithcare/prosemirror-suggest-changes`** | MIT | Instead of TipTap Pro track-changes (commercial). Pinned; vendored fallback |
| Offline doc cache (v2) | `y-indexeddb` | MIT | Renderer-side Yjs persistence |
| Drive storage (v2) | **SeaweedFS** (S3 gateway) + `@aws-sdk/client-s3` | Apache-2.0 | Separate service; MinIO rejected (AGPL) |
| Previews (v2) | **pdf.js** (`pdfjs-dist`), **sharp**, ffmpeg (separate process, LGPL build) | Apache-2.0 / Apache-2.0 / LGPL | ffmpeg invoked as a binary, not linked |
| Local drive watcher (v2) | `chokidar` | MIT | — |
| Deterministic ids (v2) | `uuid` (v5) | MIT | Rule / welcome / starter idempotency |
| Macro (v2, research only) | `macro-inc/macro` | **AGPL-3.0** | **Nothing copied**; behaviour studied, clean-room spec (§17) |
| Operately product reference | **Operately** `app/` + `turboui/` | **Apache-2.0** | Port / adapt allowed with NOTICE (§6.1). **`app/ee/**` is EE-licensed: never copy, read or port** |

### 6.1 Operately reuse rules (Apache-2.0)
1. **Allowed sources:** `operately/operately` repo root `LICENSE` (Apache-2.0) areas, `app/` (excluding `app/ee/**`) and `turboui/`. Reuse means porting TSX components, status / progress / cadence logic, wording, activity names, email copy and MCP tool shapes.
2. **Forbidden:** anything under `app/ee/**` (Enterprise Edition License: admin API, billing, support sessions, beacon). There is no need to read it. A CI guard (`scripts/check-provenance.ts`) fails if any file declares `Source: operately/app/ee`.
3. **Per-file provenance header** on every ported or substantially adapted file:
   ```ts
   // Portions adapted from Operately (https://github.com/operately/operately),
   // file: turboui/src/<path> @ <commit>. Copyright Operately, Inc.
   // Licensed under the Apache License, Version 2.0. Modified by Rox.
   ```
4. **NOTICE:** add to the repo `NOTICE` (and register it as a `license_component` row through the workspace-service licenses module ✔, `48-license-audit.sql` ✔, so it appears in the in-app licence audit):
   ```
   This product includes software adapted from Operately
   (https://github.com/operately/operately), Copyright Operately, Inc.,
   licensed under the Apache License, Version 2.0.
   ```
   If Operately ships its own `NOTICE` file, its contents must be carried over verbatim (Apache-2.0 §4(d)).
5. **Trademark:** do not use the "Operately" name or logo in product UI (Apache-2.0 §6). Operately is referenced only in NOTICE and docs.
6. **Lark:** nothing is copied from Lark / Feishu (proprietary). It is UX reference only, with original assets, icons (Lucide / Tabler) and copy.
7. **Elixir code** is not ported verbatim (different runtime). Logic is re-implemented in TS from the spec (OPERATELY-SPEC.md), with provenance comments where an algorithm is followed closely (e.g. goal progress, check-in due dates).

## 7. Non-functional requirements, testing, observability

Phase-2 TECH-SPEC §13 targets are kept. Unified additions:

| Metric | Target |
|---|---|
| Entity resolve (cache hit, renderer) | < 2 ms; batch resolve of 100 refs < 40 ms local, < 120 ms server |
| Preview card render after hover | < 100 ms (stale-while-revalidate) |
| Work Map, 1,000 goals + projects | First paint < 300 ms; expand subtree < 30 ms (virtualised tree) |
| Tasks list view, 10k items | Scroll at 60 fps; filter change < 50 ms (in-memory projection) |
| Command round-trip (server) | p95 < 150 ms; local < 20 ms |
| Share migration of a 5 MB note | < 3 s including the Markdown round-trip check |
| Outbox drain after 24 h offline (1k commands) | < 60 s; zero duplicates (receipts) |
| Notification fan-out | p95 < 2 s from commit to delivery on WS |

**Security**
- ACL on every resolve / preview / link listing (§3.6).
- `entity_link` rows are returned only when **both** ends are viewable, or the source is viewable and the target is redacted to `{kind, "restricted"}`.
- Commands are validated by zod on both sides.
- AI / MCP writes go through ChangeProposal unless the grant allows auto-apply.
- Email notifications never include restricted content (Operately rule).
- Audit via `domain_event` (immutable) and the existing audit pattern.

**Reliability**
- Idempotent commands (`command_receipt`); outbox with exponential backoff.
- Share migrations are two-phase (server create → local tombstone) and resumable.
- Snapshot worker with a dead-letter queue.
- Per-topic `seq` gap recovery.

**Testing (harness from W1-10)**
- **Contract tests:** every command definition has a zod round-trip test and a permission matrix test (generated from DATA-MODEL §8).
- **Migration tests:** MIG-01…MIG-12 fixtures under `packages/core/test/fixtures/migrations/` (v2 personal tasks, okr.json, roadmap.json, dossier localStorage dumps, vault notes with every TipTap extension), golden outputs, and an idempotency re-run.
- **Markdown ↔ Yjs round-trip** property tests (fast-check) over the extension set; the round-trip must be lossless or report a list of lossy nodes before sharing.
- **Server tests:** Testcontainers Postgres; migrations are checksum-verified against the existing `migrate.ts` ✔ rules.
- **E2E (Playwright, Electron + a web two-user harness):** cross-integration journeys J1–J12 (PLAN §5).
- **Visual:** 1440×900 + 1280×800 snapshots per UI-SPEC screen in light and dark, RU and EN.
- **a11y:** axe on every new screen; full keyboard path for the composer, task detail and work map.

**Testing additions (v2; omp remark #10: full functional, negative and integration coverage, not smoke only)**
- **Negative tests are mandatory for every v2 command:**
  - permission denied;
  - wrong scope (agent);
  - rate limited;
  - quota exceeded;
  - conflict;
  - expired approval;
  - revoked invitation;
  - placeholder trying to sign in with an unverified email;
  - path migration with a locked file.
- **Idempotency suites:** replay every R1–R5 trigger 3× and with an injected failure at each step. Assert one `rule_execution`, no duplicate entities, and resumption.
- **Agent policy matrix:** generated from DATA-MODEL §5.14 (scope × risk class × mode × standing approval × floor) → the expected decision, plus the audit-row assertion and hash-chain verification.
- **Collaboration chaos:** 3 clients with random offline windows editing the same doc / task list / calendar. Assert convergence, no lost edits, and correct conflict chips.
- **Visual checks:** v2 screens in both UI profiles (Rox, SE) × light / dark × RU / EN, including **hover, focus-visible and motion keyframe** snapshots (start / mid / end frames under a fixed clock), plus reduced-motion variants.
- **Path migration:** all start states (§10.3), cross-device, Windows junction (CI on windows-latest), remote bootstrap.
- **E2E journeys J13–J23** (PLAN §5; J21–J23 added in v2.1).

**Observability**
- OpenTelemetry spans per command (`command.type`, `authority`, `entity.kind`) and per resolve batch.
- Metrics: outbox depth, receipt duplicates, migration failures by MIG id, unfurl refetch rate, notification lag.
- No entity content in logs (ids only).

**i18n:** 12 locales via `packages/shared/src/i18n` ✔, RU default. New namespaces: `messenger`, `docs`, `tasks`, `goals`, `projects`, `spaces`, `kpis`, `calendar`, `contacts`, `review`, `base`, `entities`. The EN / RU source strings are UI-SPEC §16; the other 10 locales use the existing translation pipeline. Operately status wording uses the RU labels in UI-SPEC §2 / PRD §11 item 4 («По плану», «Внимание», «Отстаёт», «На паузе», «Достигнуто», …; pending Mark's confirmation).

## 8. Feature flag registry

All new flags default **OFF** (ADR-U04). Workbench and feature flags are added to the existing workbench registry `packages/core/src/platform/workbench/flags.ts` ✔ (keyed constants, the same mechanism as `workbench.harness.agentTeams`); env-style flags in `packages/shared/src/feature-flags.ts` ✔ are not used for these. Mode flags gate rail entries through `modes-seed.ts`.

| Flag | Gates | Package | Depends on |
|---|---|---|---|
| `entities.links.v1` | entity-link writes, backlinks UI | W1-02 | — |
| `entities.previews.v1` | hover cards / unfurls | W1-02, W1-08 | `entities.links.v1` |
| `workbench.mode.messenger.v1` | Messenger rail + routes | MSG-1/2 | `entities.previews.v1` (for cards) |
| `docs.shared.v1` | "Move to shared", Yjs editor, comments on shared docs | DOC-1 | workspace connection |
| `docs.drive.v1` | Drive folders, links, uploads | DOC-2 | `docs.shared.v1` |
| `docs.wiki.v1` | Wiki spaces | DOC-2 | `docs.shared.v1` |
| `tasks.lark.v1` | Lark views, lists / sections, detail extensions | TSK-1 | — (local works) |
| `tasks.shared.v1` | Share task / list, assignees, server reminders | TSK-1/2 | workspace |
| `workbench.mode.goals.v1` | Goals rail, Work Map, goal / project pages | GOAL, PRJ | — |
| `goals.v1` | goal entities in local mode (alias of the mode flag for non-UI paths) | GOAL | — |
| `goals.checkins.v1` | Check-ins, reviews, acknowledgements | CHK | `goals.v1` |
| `spaces.v1` | Spaces and provisioning | SPC | workspace |
| `kpis.v1` | KPIs | KPI | `goals.v1` |
| `workbench.mode.calendar.v1` | Calendar rail | CAL | — |
| `meetings.vc.v1` | In-app LiveKit calls | MTG | workspace + LiveKit configured |
| `workbench.mode.contacts.v1` | Contacts rail, directory, profile | PPL | — |
| `tables.base.v1` | Base surface (unified tables) | TBL | #1295 flags |
| `forms.v1` | Forms | TBL | `tables.base.v1` |
| `search.server.v1` | server search provider | SRCH | workspace |
| `mail.client.v2` | Lark-layout mail client | MAIL | — |
| `workplace.v1` | Apps / Workplace section | WPL | — |
| `storage.visible-root.v1` (v2) | `~/rox` resolution + MIG-13 auto-migration. **Approved exception (PRD D-v2-12, Mark 2026-10-08):** this flag ships ON in W3 after the rehearsal (W3-02) because requirement B is a hard rule. Until then `rox migrate-config` is manual | W1-13 | — |
| `collab.presence.v1` (v2) | presence dots, facepiles, follow mode, typing | COL | workspace |
| `collab.comments.v2` (v2) | threaded / anchored comments, resolve, assign-as-task | COL | `docs.shared.v1` |
| `collab.suggestions.v1` (v2) | suggestion mode | COL | `docs.shared.v1` |
| `collab.receipts.v1` (v2) | message / doc receipts | COL | `workbench.mode.messenger.v1` |
| `xsc.create.v1` (v2) | doc blocks / selection / message → task, event, meeting, doc, group | XSC, MSG-2 | `entities.links.v1` |
| `agents.autonomy.v1` (v2) | personal agent, `@rox` triggers, approvals, audit viewer | AGT-2 | W1-11 contracts |
| `automation.rules.v1` (v2) | R1–R5 consumers + Settings → Automations | AUTO | W1-12 |
| `identity.placeholders.v1` (v2) | invite-to-placeholder, held notifications, activation | ONB | workspace |
| `onboarding.welcome.v1` (v2) | agent DM welcome + starter content + wizard step | ONB | `agents.autonomy.v1` |
| `drive.personal.v1` (v2) | personal drive, quota, storage page, virtual folders | DRV | `docs.drive.v1` |
| `agent.panel.v1` (v2.1) | agent panel «@rox» on every surface, ⌘J, context providers | W1-15, AGP | `agents.autonomy.v1` |
| `workbench.chrome.surfaces.v1` (v2.1) | schema-driven left sidebar + top bar per surface, «Закреплённое», counters | W1-15, CHR | — |
| `xfn.capabilities.v1` (v2.1) | cross-functional capabilities X-13…X-26 (each also needs its owner module's flag) | XFN | `entities.links.v1` |

**Known discrepancy (not changed by this programme):** `workbench.harness.agentTeams` is documented as default `false` (ADR-0019, H-03), but `packages/core/src/platform/workbench/flags.ts` at `aedff592` defaults it to `true` (P35-08; see ROX-CURRENT-STATE §6). This spec does not touch it. Filed as a separate fix ticket for Mark to decide: rox-one/rox-one#1535.

## 9. Compatibility and deprecation
- `personalTasks:*`, `notes:*` and `projects:*` RPC channels stay as thin adapters for one release after their module ships; they emit a deprecation log line when flags are on.
- `okr.json` and `roadmap.json` are read-only after MIG-04/05. They are kept on disk as `.bak` for one release; writers are removed.
- `ROX2_ENTITY_KINDS` stays the source for existing kinds; the new registry re-exports and extends it. Aliases are read-only (never written).
- `chat_link` (Phase-2 design) is never built; quick panels use `entity_link`.

## 10. Storage root migration: `~/.rox` → `~/rox` (v2; ADR-U13, M23, package W1-13)

### 10.0 Current state (audit, `aedff592`)
Both folders are in use today:
- `packages/shared/src/config/env.ts` ✔ `resolveConfigDir()` returns, in order:
  1. `ROX_CONFIG_DIR` (or the deprecated `CRAFT_CONFIG_DIR`);
  2. else `~/rox` **if it exists**;
  3. else `~/.rox`.

  It then calls `importLegacyConfig(homeDir, roxDir)` to copy `~/.craft-agent`.
- `packages/shared/src/identity/manifest.ts` ✔ defines `ROX_CONFIG_DIR_NAME='.rox'`, `ROX_VISIBLE_CONFIG_DIR_NAME='rox'`, `ROX_LEGACY_CONFIG_DIR_NAME='.craft-agent'`.
- Policy doc `docs/plans/2026-10-07-rox-visible-config-migration.md` ✔: opt-in copy, a future `rox migrate-config`, "Do not delete ~/.rox automatically".
- 22 code files still hard-code `.rox` (manifest in §10.2), plus 7 docs and 14 tests. A clean install therefore still creates `~/.rox`.

### 10.1 Target rules
1. `resolveConfigDir()` resolves `ROX_CONFIG_DIR` → `CRAFT_CONFIG_DIR` (deprecated, warns) → **`~/rox` always**.
   - `~/rox` is created with `0700` on first use.
   - If `~/.rox` exists and is not a symlink to `~/rox`, the **migrator** runs first (§10.3).
2. New constants:
   - `ROX_HOME_DIR_NAME = 'rox'`;
   - `ROX_COMPAT_SYMLINK_NAME = '.rox'` (read-only meaning: "may be a symlink");
   - `ROX_CONFIG_DIR_NAME` is kept as a deprecated alias for one release, and its value is documented as the legacy name.
3. **No other module may build a config path from `homedir()`.** Everything goes through `resolveConfigDir()` / `getConfigPaths()` (`config/paths.ts` ✔). A CI grep gate (`scripts/check-config-paths.ts` ✚) fails on `['"]\.rox['"/]` or `'.rox'` outside `identity/manifest.ts`, the migrator and its tests.
4. **Never write defaults into `~/Documents` or `~/Desktop`** (omp remark #13). The projects folder default is `~/rox/projects`, and Drive local is `~/rox/drive`.
5. **Workspace-level metadata folders** stay inside the visible tree, e.g. `{workspaceRoot}/.rox/foreign-import-registry.json` (`sessions/import-registry.ts` ✔) and `browser-data-auto-import.json`. They are hidden *inside* `~/rox/workspaces/{id}/`, which satisfies "all Rox files live in `~/rox`". Renaming them is **not** required (PRD D-v2-11, approved by Mark 2026-10-08; it avoids a second migration for every workspace).
6. **Never touch other dot-configs** (`.omp`, `.codex`, `.hermes`, `.ssh`; omp remark #14).

### 10.2 Code-path manifest (codemod input, `scripts/codemods/rox-home.manifest.json` ✚)

| # | File (✔ exists) | Current use | Change |
|---|---|---|---|
| 1 | `packages/shared/src/config/env.ts` | `existsSync(~/rox) ? ~/rox : ~/.rox` | always `~/rox`; call `migrateHiddenRoxHome()` before `importLegacyConfig` |
| 2 | `packages/shared/src/config/paths.ts` | doc comments "Default (clean install): ~/.rox/" | comments + `getConfigPaths()` docs → `~/rox` |
| 3 | `packages/shared/src/config/storage.ts` | comment "default ~/.rox or ~/rox" | comment → `~/rox` |
| 4 | `packages/shared/src/identity/manifest.ts` | constants | add `ROX_HOME_DIR_NAME`; deprecate `ROX_CONFIG_DIR_NAME` |
| 5 | `packages/shared/src/identity/config-migration.ts` | copies `~/.craft-agent` → `~/.rox` | target = `resolveConfigDir()` (→ `~/rox`); host the new `migrateHiddenRoxHome()` |
| 6 | `packages/shared/src/agent/permissions-config.ts` | comments `~/.rox/permissions/default.json` | comments → `~/rox/permissions/default.json` |
| 7 | `packages/shared/src/sessions/import-registry.ts` | `join(workspaceRoot,'.rox',…)` | unchanged (rule 5); comment clarified |
| 8 | `packages/server-core/src/handlers/rpc/browser-data-auto-import.ts` | `join(root,'.rox',…)` | unchanged (rule 5) |
| 9 | `packages/server-core/src/handlers/rpc/session-foreign-auto-import-storage.ts` | workspace `.rox` | unchanged (rule 5) |
| 10 | `packages/session-tools-core/src/context.ts` | doc comments (`~/.rox/workspaces/{id}`, `~/.rox/feedback/`) | comments → `~/rox/…`; the feedback writer uses `getConfigPaths()` |
| 11 | `packages/session-tools-core/src/templates/loader.ts` | doc comment example `~/.rox/workspaces/ws/sources/linear` | comment |
| 12 | `packages/session-tools-core/src/handlers/mermaid-validate.ts` | user-facing suggestion string "Check the syntax against ~/.rox/docs/mermaid.md" | interpolate the resolved `{configDir}/docs/mermaid.md` |
| 13 | `apps/electron/src/main/meetings/local-asr.ts` | `[join(configDir,'models'), join(homedir(),'.rox','models')]` | drop the second entry (the symlink covers old installs) |
| 14 | `apps/electron/src/main/ssh-tunnel/server-bootstrap.ts` | `REMOTE_INSTALL_DIR='~/.rox/remote-server'`, log / token paths, `mkdir -p ~/.rox`, `pkill -f '[.](rox\|craft-agent)/remote-server'` | new installs use `~/rox/remote-server`. Detect an existing `~/.rox/remote-server` on the host and reuse it until upgrade, then run the remote move + symlink (§10.4). `pkill` pattern → `(\.rox\|/rox\|\.craft-agent)/remote-server` |
| 15 | `apps/electron/src/main/ssh-tunnel/ssh-tunnel-manager.ts` | reads remote `~/.rox/remote-server/.token` | read `REMOTE_TOKEN_PATH` from the bootstrap probe result (whichever exists) |
| 16 | `scripts/install-app.sh` | `config_dir="${ROX_CONFIG_DIR:-$HOME/.rox}"` | `${ROX_CONFIG_DIR:-$HOME/rox}`; call `rox migrate-config --auto` after install |
| 17 | `scripts/verify-server-container-context.ts` | secret-file exclusion fixtures (`.rox/private.json` next to `.omp/auth.json`) | **add** `rox/private.json` (keep `.rox/…`): the build context must exclude both |
| 18 | `scripts/probes/omp-worker-loop.ts` | `ROX_OMP_PACKAGE_DIR ?? join(homedir(),'.rox','toolchain','omp',…)` | fallback → `join(resolveConfigDir(),'toolchain','omp',…)` |
| 19 | `scripts/probes/runtime-map-native-loop.ts` | `ROX_OMP_PACKAGE_DIR ?? join(homedir(),'.rox/toolchain/omp/…')` | same |
| 20 | `tests/final-readiness/rox-readiness-ui-001.seed.ts` | `join(homedir(),'.rox','toolchain')` | `join(resolveConfigDir(),'toolchain')` + a legacy fixture variant |
| 21 | `.cursor/install.sh` | `$HOME/.rox-cloud/bun` (cloud-agent dev env only) | `$HOME/rox-cloud/bun` (dev only; no migration) |
| 22 | `.cursor/start-server.sh` | `~/.rox-cloud` (dev only) | same |

The 7 docs (`docs/**/*.md`) and 14 test files that mention `~/.rox` are updated by the same codemod in "text" mode. Test fixtures keep legacy cases explicitly named `*.legacy-dot-rox.*`.

### 10.3 Migrator `migrateHiddenRoxHome()` (local; MIG-13)
**Inputs:** `home`, `hidden = home/.rox`, `visible = home/rox`. The migrator runs at app start before any store opens, under a lock file `${os.tmpdir()}/rox-migrate-${uid}.lock` (O_EXCL; temporary, not a Rox data file), and skips if `ROX_CONFIG_DIR` is set.

| Start state | Action | End state |
|---|---|---|
| neither exists | `mkdir ~/rox` | `~/rox` only |
| only `~/rox` | — | unchanged |
| `~/.rox` is already a symlink → `~/rox` | — | unchanged |
| only `~/.rox` (real dir) | 1. Write the manifest (path, size, sha256, mode) to `~/.rox/.migration-manifest.json`. 2. **Same filesystem:** `rename(~/.rox, ~/rox)` (atomic). **Cross-device:** copy to `~/rox.tmp-<pid>`, verify against the manifest, `rename(~/rox.tmp, ~/rox)`, then `rename(~/.rox, ~/.rox.migrated-<ts>)`. 3. `symlink(~/rox, ~/.rox)` (Windows: a directory junction). 4. Verify by reading the manifest through both paths | `~/rox` real, `~/.rox` → symlink. On Windows / cross-device, the original is kept as `.rox.migrated-<ts>` (never deleted; the user can remove it from Settings → Storage) |
| both real dirs | Per-file merge into `~/rox`: missing files are copied; identical files are skipped; for differing files the newer mtime wins and the other copy goes to `~/rox/.migration/conflicts/<relpath>`. Then `~/.rox` → `~/.rox.migrated-<ts>` and the symlink is created | `~/rox` real + symlink + conflict report |
| `~/.rox` is a symlink elsewhere | do nothing; warn in Settings → Storage | unchanged |

**Rules:**
- **Never delete.** Running processes holding `~/.rox` files are detected (lock files of server-core / omp workers). If any are found, the migration is deferred to the next start.
- `rox migrate-config [--dry-run] [--revert] [--auto]` (CLI ✚ in `apps/cli`) exposes the same function.
  - `--revert` removes the symlink and renames `~/rox` back to `~/.rox`, but only when no `.migration/conflicts` exist.
- Result report: `~/rox/.migration/report-<ts>.json`, plus a one-time toast «Файлы Rox теперь в папке ~/rox».
- Audit (local JSONL): `storage.root_migrated`.

### 10.4 Remote SSH server installs
`server-bootstrap.ts` probes `test -d ~/rox/remote-server || test -d ~/.rox/remote-server` and uses whichever exists. On the next upgrade it runs the same move + symlink remotely (`mv ~/.rox ~/rox && ln -s ~/rox ~/.rox`, only if `~/rox` is absent; otherwise merge into `~/rox/remote-server` only). New installs use `~/rox/remote-server` directly.

### 10.5 Tests
- Unit tests for all six start states (tmpdir fixtures, cross-device simulated with an injected `rename` that throws `EXDEV`).
- A property test: the manifest is equal before and after.
- An Electron E2E: legacy profile → launch → sessions, permissions and models still load.
- The CI grep gate (rule 3).
- A remote bootstrap test with a mocked `runRemote`.

## 11. Collaboration technology (v2; ADR-U18, M18, package COL)

### 11.1 Presence
- **Server:**
  - `apps/workspace-service/src/modules/presence/` ✚ wraps `packages/shared/src/collaboration/presence.ts` ✔ (types reused);
  - clients send `presence.heartbeat {status, activeRef?, device}` every 20 s over the WS gateway;
  - Valkey key `presence:{ws}:{principal}`, TTL 60 s;
  - transitions emit `presence.changed` on `user:{id}` topics of people who share a chat or space (throttled to 1 per 5 s per principal).
- **Away / DND:**
  - away = 5 min with no input (renderer idle detector);
  - DND = the user's status, or OS focus mode when available.
- **Object presence** ("active now"): `presence.join {ref}` / `presence.leave`. The server keeps a set `presence:obj:{ref}` (TTL 60 s) and publishes on `entity:{kind}:{id}` as `presence.viewers`.
- **Docs** use Hocuspocus awareness instead (§11.2). The facepile merges both sources.

### 11.2 Co-editing
- **Stack:**
  - TipTap ✔ + `@tiptap/extension-collaboration` + `extension-collaboration-cursor`, with `y-prosemirror` underneath;
  - `HocuspocusProvider` connects to `apps/collab-server` ✚ (Hocuspocus + `@hocuspocus/extension-database` writing to `doc_yjs_state`, the v1 DATA-MODEL §5.2 table).
- **Auth:** the Hocuspocus `onAuthenticate` hook verifies the workspace JWT and `acl.can(principal, 'doc:'+id, 'edit'|'comment'|'view')`.
  - Viewers get read-only (`connection.readOnly = true`).
  - Commenters are read-only for content, but can write the comments / suggestions maps (§11.4).
- **Awareness state:** `{user:{id,name,color,avatar}, cursor, selection, following?}`. Colours come from a stable hash of `principal_id` over the 8-hue palette (UI-SPEC §18.2).
- **Follow mode:** the follower subscribes to the leader's awareness `viewport {topBlockId, offset}` and scrolls with `scrollIntoView` (throttled 100 ms).
- **Snapshots:** the existing v1 snapshot worker writes Markdown (`snapshot.written`). Suggestions are excluded from the Markdown export unless accepted.

### 11.3 Comments and threads
- **Storage:** `comment` rows (v1 §5.8, plus the v2 columns).
- **Anchors:** `{start, end}` are `Y.RelativePosition` encoded base64 (`Y.createRelativePositionFromTypeIndex`), plus `quote` and `blockId` for fallback.
  - On load, the client converts them to absolute positions.
  - If both resolve to the same index (the text was deleted), the thread shows as «Текст удалён» with its quote.
- **Highlight:** a ProseMirror decoration plugin (not marks), so comments never alter the document content or the Markdown export.
- **Commands:**
  - `comments.create {targetRef, anchor?, body, mentions[], parentId?}`;
  - `comments.edit`, `comments.delete`;
  - `comments.resolve_thread {rootId}`, `comments.reopen_thread`;
  - `comments.react`;
  - `comments.convert_to_task {commentId, assignee?}` (→ `tasks.create` with `derived-from` comment).
- **Notifications:**
  - mention → `mention` to the mentioned (ACL-checked: someone without access gets the "grant access?" prompt instead, UI-SPEC §18.3);
  - reply → `comment_reply` to thread participants;
  - resolve → `thread_resolved`.
- **Mentions** are parsed from the TipTap JSON (`mention` nodes with `{id: 'person:…' | 'kind:id'}`), never from text.

### 11.4 Suggestion mode
- **Library:** `@handlewithcare/prosemirror-suggest-changes` (MIT, v0.1.x). It provides insertion / deletion / formatting marks with `suggestion` attributes, plus `applySuggestions` / `revertSuggestions` commands.
  - Wrapped as a TipTap extension `SuggestChanges` ✚ in `packages/ui/src/components/markdown/extensions/` ✔ (next to `MermaidBlock.tsx`; the editor is `TiptapMarkdownEditor.tsx` ✔, and the selection bubble actions extend `TiptapBubbleMenus.tsx` ✔).
  - Pinned version; a vendored fallback copy under `third_party/` with LICENSE if upstream stalls.
- **Mode:** a plugin flag `suggesting=true` routes every user transaction through `withSuggestChanges()`. Marks carry `{id, authorId, createdAt}`.
- **Index:** a debounced observer of the Y doc upserts `doc_suggestion` rows (`docs.sync_suggestions`), used for Inbox notifications, counts and the panel list.
  - The Y doc stays the source of truth.
  - A row whose marks disappear without a decision becomes `stale`.
- **Accept / reject:** `docs.decide_suggestion {suggestionId, decision}`. The client applies `applySuggestion(id)` / `revertSuggestion(id)` on the Y doc (an editor-role transaction) and the server records the decision.
  - Commenters can create but not decide.
  - The author can withdraw (= reject own).
- **Commenter enforcement:** Hocuspocus `beforeHandleMessage` validates that commenter updates only add or remove suggestion-marked content (a server-side ProseMirror step check on the decoded update). Otherwise the update is rejected and the client reloads.

### 11.5 Permissions and sharing
- One ACL engine (v1 §3.6, DATA-MODEL §8). Roles map as viewer → `view`, commenter → `view, comment, suggest`, editor → `+edit`, manager → `+share, manage_members`.
- **Link sharing:** `acl_link {ref, audience: 'workspace'|'anyone', role, expires_at, token_hash}`. This is the existing v1 link model, extended with `expires_at`.
- **Inheritance:** folder → children, space → contained objects, task list → tasks, calendar → events. The effective role is the max of direct and inherited, and the UI shows the source.
- **Commands:**
  - `acl.grant {ref, subject, role, notify, message?}`, `acl.revoke`;
  - `acl.set_link {ref, audience, role, expiresAt}`;
  - `acl.request_access {ref, role, note}`, `acl.decide_request`;
  - `acl.transfer_ownership {ref, to}`.
  - Risk classes for agents: grant / link = consequential; link `anyone` + edit, transfer and revoke-others = privileged.

### 11.6 Offline and conflict handling
| Entity type | Mechanism | Conflict UX |
|---|---|---|
| Shared docs | Yjs CRDT, `y-indexeddb` offline cache in the renderer, merge on reconnect | none (automatic) |
| Tasks, events, goals, projects, lists | outbox commands with `expectedRevision`; per-field patches (`{field: value}`) | server applies non-overlapping fields; overlapping field changed since `expectedRevision` → `CONFLICT {field, theirs, mine, revision}` → ConflictChip (UI-SPEC §18.7) |
| Chat messages | outbox with client nonce, server-assigned `seq` | none; "Sending…" until the receipt |
| Comments | append-only create; edit is per-comment LWW with revision | rare chip |
| ACL changes while offline | commands rejected `ACCESS_REVOKED` | local draft kept (private note / local task) |

**Per-field merge rule:** the server stores `field_revisions` (jsonb `{field: revision}`) per entity row (v1 `work_item` gains `field_revisions`). A patch conflicts only if `field_revisions[f] > expectedRevision` for a field it touches.

### 11.7 Read receipts
- **Messages:** `im.mark_read {chatId, seq}` updates `chat_member.last_read_seq` (monotonic max) and emits `read.changed` on `channel:{id}`, throttled to 1 per 2 s per member.
  - "Read by" for message *m* = members with `last_read_seq ≥ m.seq`. It is computed on demand, capped at 500 members.
  - Privacy flag `user_pref.share_read_receipts`: when false, DM `read.changed` isn't emitted to the partner, and the user doesn't receive partners' events either.
- **Docs:** `docs.record_view {docId}` (debounced: once per 10 min per user) upserts `doc_view`.

### 11.8 Shared task lists
- `task_list.share_mode` plus `acl_entry` membership.
- Live updates on `task-list:{id}`. Personal fields (`work_item_user_state`: today, evening, someday, seen_at) are never broadcast.
- Assigning a non-member triggers the "add to list" prompt, which is `acl.grant` with role editor.

### 11.9 Shared calendars
- `calendar_member` roles. `free_busy` viewers receive events redacted to `{start, end, busy:true}` by the query layer, and through the `calendar:{id}` topic filter.
- **Find a time:** `calendar.free_busy {principals[], range}` aggregates over visible calendars, plus a provider free-busy query for external calendars (CalDAV `free-busy-query`, Google freeBusy through the existing provider bridge).

## 12. Cross-surface command contracts (v2; M19, packages XSC + MSG-2)
All of these are command-bus commands (v1 §3.4): zod-validated, idempotent through `command_receipt`, and emitting `domain_event`s. "Risk" is the class applied when an **agent** dispatches the command (§13). Humans are never gated except by ACL.

```ts
// packages/core/src/xsc/commands.ts ✚  (types are shorthand; real schemas are zod)
type Origin =
  | { kind: 'doc-block'; docRef: `note:${string}`; blockId: string; anchor?: YAnchor }
  | { kind: 'message'; chatRef: `channel:${string}`; seq: number; threadRootSeq?: number }
  | { kind: 'comment'; commentId: string }
  | { kind: 'agent'; sessionRef: `session:${string}`; messageRef?: string };

'docs.insert_task_block':   { docRef; afterBlockId; task: TaskDraft }                 → { blockId; taskRef }       // nested tasks.create; risk: routine (private doc) | consequential (shared doc)
'tasks.create_from_selection': { origin: Origin & {kind:'doc-block'}; title; description?; assignee?; due?; listRef? } → { taskRef }   // risk: routine | consequential if assignee ≠ owner
'tasks.create_many_from_checklist': { docRef; blockIds: string[]; shared?: Partial<TaskDraft> } → { taskRefs[] }    // > 20 → privileged (bulk)
'tasks.create_from_message': { origin: Origin & {kind:'message'}; title; assignee?; due?; listRef?; followers?: PersonRef[] } → { taskRef; cardMessageSeq }
'docs.insert_event_block':  { docRef; afterBlockId; event: EventDraft }               → { blockId; eventRef }
'calendar.create_event':    { calendarRef; title; start; end; tz; attendees?: PersonOrEmail[]; call?: boolean; origin?: Origin; description? } → { eventRef; callRef? }   // attendees ≠ ∅ → consequential
'calendar.create_event_from_message': { origin: Origin & {kind:'message'}; title?; start?; end?; attendees: 'chat'|'mentioned'|PersonRef[]; call?: boolean } → { eventRef; cardMessageSeq }
'docs.insert_meeting_block':{ docRef; afterBlockId; mode: 'now'|'scheduled'; event?: EventDraft } → { blockId; callRef; eventRef? }
'vc.start_meeting':         { origin?: Origin; participants?: PersonRef[]; notesDocRef?: NoteRef } → { callRef; joinUrl }    // participants ≠ ∅ → consequential
'docs.embed_view':          { docRef; afterBlockId; ref: `task-list:${string}` | ViewQuery } → { blockId }
'docs.create_from_messages':{ chatRef; seqs: number[]; target: { new: { title; folderRef? } } | { append: NoteRef }; format: 'quotes'|'plain' } → { docRef }
'im.create_chat':           { kind: 'group'|'channel'; name?; description?; visibility: 'public'|'private'; members: PersonRef[]; postingPolicy?: 'all'|'admins'; from?: Origin; carryContext?: { lastN: number } } → { chatRef }   // agent: consequential
'im.send_message':          { chatRef; body: TipTapJSON; mentions: PersonRef[]; attribution?: 'user'|'agent'|'unprompted'; notify?: 'default'|'mentions_only'; messageId?: string } → { seq }
'agents.invoke':            { agentRef; instruction: string; origin: Origin; context?: EntityRef[] } → { sessionRef; replyThread }
```

**Shared rules:**
1. Every `*_from_*` and `insert_*_block` command writes `entity_link(created → origin, 'derived-from', role:'origin', anchor)` in the same transaction.
2. The block or card at the origin is rendered from the ref (live), never as a copy.
3. Idempotency key = client-generated `commandId`. `docs.insert_*_block` derives the created entity id from `uuidv5(docRef + blockId)`, so a Yjs replay never double-creates.
4. Private-note origins (local authority) create a local entity by default. Choosing "create in workspace" dispatches to the server, and the doc block stores the cross-authority ref.
5. Natural-language parsing (`quick-entry.ts` ✔ + chrono-node) runs client-side and is shown before confirm. The agent path parses server-side in the session.

## 13. Agent autonomy (v2; ADR-U14, M20, packages W1-11 + AGT-2)

### 13.1 Principal model and runtime (no second orchestrator)
- **The personal agent** is a `principal(kind='bot')` plus `agent_binding` (DATA-MODEL §5.12).
- **It runs in the existing runtime:**
  - an invocation creates or resumes an ordinary omp **session** through `SessionManager` ✔ / `ExecutionCoordinator` ✔ (`packages/server-core/src/sessions/SessionManager.ts`), keyed by `(agent, origin chat / doc)`, with the session's working dir under `~/rox/workspaces/{ws}/sessions/{id}`;
  - workspace-side invocations are routed by the existing **messaging-gateway** ✔ (`packages/messaging-gateway/src/router.ts`, `binding-store.ts`), which already binds chats to sessions. The internal Messenger becomes one more adapter (`adapters/rox-im` ✚).
- **There is no new service, queue or planner.** Multi-step work uses the session's normal tool loop. Larger efforts may use agent-teams only where that flag is on (ADR-U04 unchanged).
- **The agent acts only through tools that dispatch commands:** the MCP tool catalogue (v1 M17), extended with `rox.create_task`, `rox.create_event`, `rox.create_doc`, `rox.create_group_chat`, `rox.start_call`, `rox.send_message`, `rox.invite_people`, `rox.upload_file`. Each maps 1:1 to a command in §12 / v1. **There are no direct DB or file writes to shared stores.**

### 13.2 Policy evaluation order (per command)
```
1. kill switch     → agent_binding.status='paused' or workspace "pause all agents" → DENIED
2. authN           → agent token (scoped JWT, aud=agent, sub=agent_principal, act=owner) valid
3. scope           → command.type ∈ agent_grant scopes (selector matches container/kind) else DENIED
4. ACL             → acl.can(owner, target, verb) AND acl.can(agent, target, verb) (agent has owner's rights ∩ grants)
5. risk class      → command.riskClass(payload, context)  // computed by the command definition
6. rate limit      → token bucket (Valkey) for (agent, scope) and (agent, '*') → RATE_LIMITED {retryAfter}
7. policy mode     → workspace_floor ⊓ approval_policy.rules[scope, risk] → auto | ask | deny
8. standing        → mode=ask and risk≠privileged and standing_approval matches (scope, selector, not expired) → auto
9. execute or park → auto: dispatch with actor=agent, on_behalf_of=owner; ask: create approval_request (card) and return PENDING_APPROVAL
10. audit          → append audit_log row at every terminal decision (denied / rate_limited / proposed / executed / failed)
```

**Onboarding policy mapping** (UI-SPEC §21.1), onto the existing `PermissionMode` ✔ (`packages/shared/src/agent/mode-types.ts`):

| PermissionMode | Approval policy |
|---|---|
| `ask` (default) | routine auto, consequential ask, privileged ask |
| `safe` | everything ask |
| `allow-all` | routine auto, consequential ask with proactive standing-approval offers after 2 identical approvals; privileged ask |

`allow-all` never auto-approves consequential actions without a standing approval, because requirement D demands approval for consequential actions.

### 13.3 Approvals and standing approvals
- `approval_request` stores the full CommandEnvelope (same `commandId`), so approval executes **exactly** what was previewed.
- "Изменить" produces a new envelope linked by `supersedes`.
- **Expiry:** after 24 h → `expired` (audit). The agent is told through its session's tool result, so the session sees `PENDING_APPROVAL` → later `APPROVED` / `REJECTED` / `EXPIRED` as an async tool completion (the session is resumed with the result message).
- **Standing approval:**
  - created from an approval with `remember {selector, until}`;
  - the default selector is the same container (chat / list / calendar) and the same scope, with an expiry of 30 days;
  - matching is exact on scope and on a container prefix;
  - privileged actions are never eligible (omp remark #16, with the requirement-D guard).

### 13.4 Audit chain
- `audit_log` hash = `sha256(prev_hash ‖ canonical_json(row without hash))`, chained per workspace and serialised by a per-workspace advisory lock.
- Verification job: nightly, plus on demand from the UI (UI-SPEC §22.6).
- Local mode uses the same JSONL under `~/rox/audit/`.
- Export CSV / JSONL. The app DB role cannot UPDATE or DELETE.

### 13.5 Readback before report (omp remark #17)
After execution the tool calls `resolve(createdRef)`, compares the key fields against the command payload, and sets `verification='readback_verified'` (existing `ROX2_VERIFICATIONS` ✔ in `packages/core/src/rox2/platform-contract.ts`).

Only then does the agent post the report card. A mismatch is reported as a failure with details and an audit `failed`.

### 13.6 Agent behaviour rules (omp remarks #15, #18)
- The agent performs actions itself through tools within its grants. It does not reply with instructions for the user to click.
- It replies in the language of the invoking message (falling back to the user's locale).
- It never claims completion without a readback.
- In shared chats it answers in the thread of the invoking message. Messages it posts carry `attribution:'agent'`, and bot messages never trigger other agents (loop guard, as in Macro: TECH-SPEC §17).

### 13.7 Mention triggers
- `im` emits `mention.created` for bot principals.
- `agents` (workspace-service module ✚) consumes it:
  - an explicit mention of `@rox` (resolved to the author's agent) or `@rox-<user>` → `agents.invoke`;
  - **inferred trigger** (optional param, default off; PRD D-v2-13): a reply in a thread whose root or previous message was an agent message from the same agent → invoke. There is no classifier in v2.
  - Messages authored by bots never trigger.
- Docs and comments use the same path, from `comments.create` mentions.
- Local-only: the existing chat surface already talks to the agent. `@rox` in local notes or comments opens a session seeded with the selection.

### 13.8 Rate limiting
- Token buckets in Valkey with `(ws, subject, scope)` keys. The defaults are seeded from DATA-MODEL §5.14 into `rate_limit_policy`.
- A limit hit returns `RATE_LIMITED`. The session tool loop backs off `retryAfter` automatically (at most twice), then reports.
- Local mode uses in-memory buckets.

## 14. Domain rule engine (v2; ADR-U15, packages W1-12 + AUTO)

### 14.1 Contract
```ts
// packages/core/src/automation/rule.ts ✚
interface DomainRule<E extends DomainEvent = DomainEvent> {
  id: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  triggers: E['type'][];                              // domain_event types
  scope: 'workspace' | 'principal';
  enabled(ctx: RuleCtx, e: E): Promise<boolean>;      // reads automation_rule (+ per-user override)
  conditions(ctx: RuleCtx, e: E): Promise<SkipReason | null>;
  key(e: E): string;                                  // idempotency key (DATA-MODEL §5.16)
  steps(ctx: RuleCtx, e: E): RuleStep[];              // ordered; each = one command
}
interface RuleStep { name: string; command: CommandEnvelope; actor: 'system' | { agentOf: PrincipalId }; optional?: boolean }
```

### 14.2 Runtime
- **Where it runs:**
  - in workspace-service, as an outbox / `domain_event` **consumer group** `rules` (the same consumer mechanism as notification fan-out, v1 §3.5);
  - locally, in server-core as an in-process consumer of local domain events (R1, R3 and R5 work offline: local DM with the agent, local drive folder, local notes and tasks).
- **Algorithm per event:**
  1. For each rule whose triggers match: `enabled`?, then `conditions`?
  2. `INSERT rule_execution ON CONFLICT (idempotency_key) DO NOTHING RETURNING`. If the row already exists with status `succeeded`, skip. If it is `running` / `failed`, resume from the first non-succeeded step.
  3. Each step dispatches its command with `commandId = key + ':' + step.name` (`command_receipt` dedupes), and records the receipt in `steps`.
  4. A step failure follows the backoff schedule (DATA-MODEL §5.16). Optional steps can fail without failing the execution (`partially_succeeded`).
- **Rule actions pass through ACL and the rate limits for `rule:*`.** Agent-facing steps (R3 welcome) run as the agent principal and are audited.
- **Ordering:** R3 and R5 both trigger on `identity.account_created`. R2 and R3 share `agents.provision_personal_agent` (same command id → one agent).

### 14.3 R1 details (calendar)
- Triggered for workspace-native events, and for external provider events on first sync (`calendar.external_event_seen`, so CalDAV / Google sync never re-triggers it: the key uses the provider uid).
- **Recurring events:** a scheduler emits `calendar.occurrence_upcoming` 24 h before each occurrence. One notes doc and one task are created per occurrence, with the key including `occurrence_start`.
- **Daily note:** `docs.ensure_daily_note(owner, date)`.
  - Local: `DAILY_VAULT_FOLDER='daily'` ✔ and `dailyNoteDestination()` ✔ (`apps/electron/src/renderer/pages/notes/note-views.ts`), moved into a shared helper in `packages/core/src/docs/daily.ts` ✚ so server-core can call it.
  - Workspace: a `note(subtype='daily', daily_date)` per user.
- **Linking:** the daily link is a block with id = `uuidv5(key + ':daily-link')`. Re-runs update it in place instead of appending.

### 14.4 Observability
- Metrics: `rule_executions_total{rule,status}`, `rule_step_latency`, `rule_duplicates_prevented_total`.
- Traces link `domain_event.id` → `rule_execution` → each command.

## 15. Identity lifecycle (v2; ADR-U16, packages W1-11 + ONB)

### 15.1 Events and commands
- **`identity.account_created`:** emitted by `modules/identity` ✔ on first verified sign-in (OIDC / password / magic link), or by server-core on local profile creation.
- **Commands:**
  - `workspaces.create {name, slug, invites?: {email, role}[]}` → workspace, the default General chat (`chat.kind='group'`, `visibility='public'`, `system_role='general'`, `workspace.general_chat_id`), and the creator as admin. Emits `people.invitations_sent` when invites are present.
  - `people.invite {workspaceId, emails[], role, targets[], message?}`:
    - per email, a lookup of `principal.primary_email` (citext);
    - existing active → `workspace_member(invited)` + Inbox card;
    - else `identity.ensure_placeholder` → R4.
  - **Team chats (D-v2-2):** `im.create_chat {kind:'group'|'channel', name?, description?, visibility:'public'|'private', members[], postingPolicy?}`, `im.join_chat {chatId}` (public only; private → `FORBIDDEN`), `im.leave_chat`, `im.set_visibility {chatId, visibility}` (owner / admin; General is always public), `im.browse_public_chats {query?}`. ACL: private chats are invisible to non-members in lists, search, mentions and previews (the resolver redacts to `{kind:'channel', restricted}`). Agent risk class: creating a chat with other people is consequential; switching private → public is privileged.
  - `identity.activate_placeholder {authSubject, verifiedEmail}`: inside the identity sign-up transaction, the auth subject is attached to the existing placeholder principal (`auth_subject_alias`), `status='active'`, memberships flip, held notifications are released, and `people.member_added` is emitted (→ R2).
  - `identity.merge_placeholder {placeholderId, accountId}`: admin-confirmed and audited. It re-points `chat_member`, `workspace_member`, assignments (`work_item.assignee_id`), `entity_link` people refs and mention indexes in batches, then sets the placeholder to `status='deactivated'` with `merged_into`.
- **Existing code reused:** `apps/workspace-service/src/modules/collaboration/invitations.ts` ✔ (token issue / verify) and `packages/shared/src/collaboration/invite.ts` ✔ (types). Both are extended with `principal_id` and `targets`.

### 15.2 Invite email and security
- **Email:** sent through the existing notification mailer (Stalwart / SMTP).
- **Token:** 32-byte random, stored as a sha256 hash, single use, expiring after 30 days.
- **Reminders:** 3 and 7 days.
- **Abuse limits:** `people:invite` rate limits (DATA-MODEL §5.14) apply to humans too (100 per day per inviter), and admins can restrict invites to allowed domains.
- **Held notifications:** stored as `notification(status='held')`. The daily digest job sends «N обновлений ждут вас в Rox» (titles only, filtered by the inviter-visible rule).

## 16. Personal Drive, quota and storage backend (v2; ADR-U17, M22, package DRV)

### 16.1 Backend
- **SeaweedFS** (Apache-2.0) in the workspace stack:
  - `weed server -s3` with a filer on Postgres or LevelDB, one bucket `rox-drive`;
  - S3 API through `@aws-sdk/client-s3` (Apache-2.0), so cloud deployments can point at any S3.
- **Keys:** `blobs/sha256/{aa}/{bb}/{sha256}` (content-addressed), plus `previews/{file_id}/{version}/{kind}`.
- **Encryption:** server-side at rest (SeaweedFS `-encryptVolumeData`). TLS in transit.
- The v1 DOC-2 Drive (`docs.drive.v1`) is the same `file_object` / `folder` model. v2 adds the per-user `drive`, the ledger, versions, previews and upload sessions (DATA-MODEL §5.15).

### 16.2 Upload protocol
1. `drive.open_upload {folderId, name, size, contentType, sha256?}` → admission check (quota) → `upload_session` + S3 `CreateMultipartUpload` → presigned part URLs (8–64 MB parts).
   - If `sha256` is given and the blob already exists → instant "upload": no bytes are sent, and the ledger is still charged.
2. The client PUTs the parts in parallel (3 at a time). Progress is persisted in `upload_session.parts` for resume after reconnect or restart.
3. `drive.complete_upload {uploadSessionId, parts}` → S3 `CompleteMultipartUpload` → verify the size (and the sha256 when provided, server-side streaming hash) → copy to the content-addressed key → create `file_object` / `file_version` → ledger `upload` → release the reservation → enqueue the preview job.
4. **Abort or expiry** (24 h): `AbortMultipartUpload`, then release the reservation.

### 16.3 Quota accounting
- **Atomicity:** ledger insert and `drive.used_bytes` update happen in one transaction with `SELECT … FOR UPDATE` on the drive row.
- **Admission:** `used + reserved + size ≤ quota`, or else `QUOTA_EXCEEDED {needed, free}`.
- **Trash:** `trash` entries are informational (they move bytes into `trash_bytes`, still counted). `purge` debits.
- **Nightly reconciler:** `Σ file_version.size_bytes` (owned, not purged) vs `used_bytes`. Drift is fixed with an audited `adjust`.
- **Thresholds:** crossing 80 / 90 / 100% emits `drive.quota_threshold_crossed` → a `quota_warning` notification (once per threshold per 7 days).
- **Workspace default quota:** `workspace.settings.default_drive_quota` (default 1 TiB). Admins can set per-user overrides, which are audited.

### 16.4 Previews
- A worker (`apps/workspace-service/src/workers/previews.ts` ✚) runs:
  - **sharp** (Apache-2.0) for image thumbnails (256 / 1024, WebP);
  - **pdf.js** (Apache-2.0) to render page 1 for the thumbnail (and the client views PDFs with pdf.js);
  - ffmpeg (LGPL build, separate process) for the video poster frame;
  - text / code: the first 256 KB, highlighted client-side with Shiki ✔.
- Office formats are `unsupported` in v2 (a later conversion service).
- Previews don't count against quota.

### 16.5 Artifacts ingestion
- **Session artifacts:** server-core already tracks session output files.
  - On "Save to Drive" (UI) or `rox.upload_file` (agent tool), the file is uploaded through §16.2 with `source_ref='session:…'`, charged to the agent's owner.
  - Before that, the virtual folder lists local artifacts through a local Drive provider that reads the session dirs under `~/rox/workspaces/{ws}/sessions/` (no copy, not charged).
- **Chat attachments:** these already upload to S3 (Phase-2 IM). In v2 they create `file_object(source_ref='channel-message:…', owner_drive=uploader)`.
- **Note attachments:** shared-doc attachments → `source_ref='note:…'`.
- **Meeting recordings:** LiveKit Egress output → `recording.file_id`, charged to the organiser.
- **Local-only Drive:** a provider over `~/rox/drive/` (chokidar watcher), shown in the same UI, with sizes from `fs.stat` and no ledger.

## 17. Macro welcome mechanism: research and clean-room adaptation (v2; requirement F)

**Source studied:** `github.com/macro-inc/macro`, cloned read-only to `/workspace/macro-ref` at commit `500858ab`.

**Licence: GNU AGPL-3.0.** No code, templates or text is copied into Rox (Apache-2.0). This section describes behaviour only, and the Rox design is a clean-room re-specification.

### 17.1 How Macro does it (observed)
| Aspect | Macro implementation (paths in the macro repo) |
|---|---|
| Trigger | FusionAuth "user created" webhook → `services/authentication_service/src/api/webhooks/user/create_user_webhook.rs` → `create_user`. After the user row exists, it spawns fire-and-forget tasks: experiments init; team auto-join by email domain (`try_join_team_by_domain`); `initialize_starter_docs_with_retries` (3 attempts, 2 s apart); `channel_service.create_system_channel` (a private "Macro Support x {local_part}" channel with the new user plus 5 support staff); favourite that channel; `post_support_channel_welcome` |
| Who posts | `services/authentication_service/src/service/user/support_channel_welcome.rs`. Posts **as a real staff user** through the normal message command path (`MessageCommands`), with an entity-access receipt (`MessageWrite`) that requires channel membership. `attribution: Unprompted`, `notification_policy: MentionsOnly` |
| Content | A short greeting: it mentions the new user, says this is their personal support channel with the CEO, CTO and the poster, and asks for feedback / bugs. **Only the new user is in the tracked `mentions` list.** Staff are mentioned visually, so they are not notified on every signup |
| Mention format | `crates/mention_utils/src/serialize.rs`: inline `<m-user-mention>{json}</m-user-mention>` tags with `userId` (`macro\|<email>`) and `email`; bots are `bot\|<uuid>` with the display name. JSON escapes `<` / `>`. Parsed with nom (`crates/mention_utils/src/parse.rs`) and by Lexical transformers in the client (`packages/lexical-core/transformers/mentions.ts`) |
| Bots and handles | `crates/bot_id/src/lib.rs`: a compile-time `SYSTEM_BOTS` list with handles (`@macro` classic reply, `macro-new` agent session, `@coder`, `@cursor`, `@codex`, `@claude`; `macro-system` not mentionable) |
| Agent trigger | `crates/channel_bots/src/domain/trigger_detector.rs` `MentionOrInferredDetector`. Explicit @mentions trigger exactly those bots. Inferred triggers fire only for replies in threads that already contain a Macro AI message, gated by a classifier. Bot-authored messages never trigger (loop guard) |
| Starter content | `services/document_storage_service/src/api/documents/initialize_starter_docs.rs`: a how-to guide plus 3 starter tasks from markdown templates. **Deterministic UUIDv5** ids (namespace + `user_id:doc_name`) make it idempotent. Mention backlinks are recorded and the guide is pinned to favourites |
| Discrepancy vs the brief | The brief said the welcome "lists the active @handles". Macro's welcome does not enumerate bot handles: it mentions real staff users, and the starter guide teaches @mentions |

### 17.2 Rox adaptation (clean-room)
| Macro element | Rox design | Where |
|---|---|---|
| Webhook → fire-and-forget tasks | `identity.account_created` domain event → rules R3 + R5 (+ R2 on membership), idempotent steps, retries, `rule_execution` history (not fire-and-forget) | §14, DATA-MODEL §5.16 |
| Support channel with staff | **DM with the user's own personal agent `@rox`** (requirement E3). An optional workspace "Support" channel is out of scope | DATA-MODEL §5.12 |
| Posted as a real user through normal commands | Posted **as the agent principal** through the normal `im.send_message` command with ACL and audit (`attribution:'unprompted'`) | §12, §13 |
| `MentionsOnly` notification; only the new user is tracked | Same principle: `notify:'mentions_only'` and `mentions=[newUser]`. Teammates shown in the text are rendered as mention chips but not in `mentions`, so they aren't notified | UI-SPEC §21.2 |
| Welcome text | Original Rox text (RU / EN), user locale, lists **only resolvable handles**: `@rox`, built-in agents if enabled, up to 5 active teammates; plus how to tag `@rox` from any chat | UI-SPEC §21.2 |
| Mention serialisation as inline tags | Rox stores mentions as TipTap `mention` nodes `{id:'person:<principal>', label}` in the message JSON plus a `mentions uuid[]` column. There are no inline-tag strings, and Markdown export renders `@Name` | v1 DATA-MODEL §5.3, §5.8 |
| `SYSTEM_BOTS` compile-time list | `agent_binding` rows (per member) plus optional built-in agents registered in the kind / handle registry. `@rox` is a contextual alias | DATA-MODEL §5.12 |
| Explicit + inferred triggers, bot loop guard | Explicit mentions trigger. Inferred = thread replies to the same agent (no classifier in v2). Bot-authored messages never trigger | §13.7 |
| UUIDv5 starter docs | `onboarding.seed_starter_content` with UUIDv5 ids, the guide «Как работать в Rox» + 3 starter tasks in Inbox, guide pinned | DATA-MODEL §5.16 (R3 step 3) |

## 18. Agent panel: context contract and runtime (v2.1; ADR-U19, M24, packages W1-15 + AGP)

### 18.1 SurfaceContext
```ts
// packages/core/src/agent-panel/context.ts ✚
export interface SurfaceContext {
  v: 1
  workspaceId: string | null           // null = local-only
  surface: ModeId | 'settings' | 'search' | 'agent-center'
  route: string                         // rox:// route of MAIN
  title: string                         // human title shown in the divider
  focus?: EntityRef                     // the open entity (doc, chat, task, goal, event, person, file…)
  selection?: EntityRef[]               // ≤ 50 selected rows / chips
  textSelection?: { ref: EntityRef; excerpt: string /* ≤ 2,000 chars */; anchor?: unknown }
  visible?: EntityRef[]                 // ≤ 50 refs on screen, provider-ranked
  view?: { kind: string; filters?: Record<string, unknown> }
  locale: string; timeZone: string
  consent: { privateRefs: EntityRef[] }  // private notes / DMs the user explicitly attached
  locked: EntityRef[]                   // chips pinned across navigation
}
export interface AgentContextProvider {
  surface: SurfaceContext['surface']
  getContext(): SurfaceContext           // pure, synchronous, from renderer state
  quickActions(ctx: SurfaceContext): QuickAction[]  // ≤ 8, the first 4 are shown
}
```
- **Registration.** Providers register in the W1-07 slot `agent.context.<surface>`. A surface without a provider falls back to `{surface, route, title}`.
- **Update cadence.** The renderer recomputes the context on route or selection change, debounced 300 ms. The panel shows the pending context. The context is **sent only with the next user message** and is never streamed to the model in the background.

### 18.2 Runtime
- **One session per topic.** A panel topic is an omp session created through the existing session API with `origin: 'agent-panel'`, `workspaceId` and `labels: ['agent-panel']`. There is no new runtime and no new orchestrator (ADR-U14 / R-AG-09).
- **Message envelope.** Each user message carries `contextSnapshot: SurfaceContext` (stored on the message for audit and replay). The server-core expands refs through the resolver with the **owner's ACL** into a bounded context block:
  - ≤ 24 k tokens;
  - the priority order is focus → textSelection → selection → locked → visible;
  - restricted refs become `{ref, restricted: true}`.
- **Tools.** The agent's tools are the command registry entries allowed by its grants (TECH-SPEC §13), plus the read-only resolvers. Proposals become `CommandEnvelope`s with `origin: {kind:'agent-panel', sessionId, messageId, surface}`. Risk classes, approvals, rate limits, audit and readback are unchanged (§13.2–§13.8).
- **Docs editing.** On shared docs the agent can call only `docs.suggest_changes`, which creates suggestions authored by the agent principal on the owner's behalf. `docs.apply_patch` is allowed only on `authority='local'` notes owned by the user, and only after an approval card.
- **Persistence.**
  - Open state, width and dock mode go in `{configDir}/ui/agent-panel.json`.
  - The current topic per workspace and the drafts go in `{configDir}/ui/agent-panel-drafts.json`.
  - Messages live in the session store (existing).
  - Restart restores everything.
- **Realtime.**
  - Streaming uses the existing session event stream.
  - Approval state changes arrive on the `agent.approvals` topic (§5).
  - Multiple windows subscribe to the same session.
- **Offline.** The message is queued in the client outbox (W1-03). Read-only questions about local data can run against a local model if one is configured (existing runtime setting).

### 18.3 Privacy rules (tests in W1-10)
1. Auto-attach never includes `note` with `authority='local'` that is not the focus, DMs other than the open one, or any ref the user cannot read.
2. Excerpts are cut at 2,000 chars at a block boundary.
3. The context snapshot is stored with the message, so the audit shows exactly what the agent saw.
4. A workspace admin can disable the auto-context (`agent_panel.auto_context=false` in `approval_policy` defaults). Then only explicit chips are sent.

### 18.4 Dock layout engine
`apps/electron/src/renderer/platform/right-dock.ts` ✚ computes the mode from the window width and the open panels, as a pure function so that it can be tested:
```
mode = sideBySide  if W ≥ 48 + S + 640 + I + A + 44
       sharedDock  if W ≥ 1280
       overlay     otherwise
```
- **Variables:** `S` = sidebar width (or 56 if auto-collapsed), `I` = inspector width (0 / 328 / 360 / 560), `A` = agent width.
- **Order:** auto-collapse of the sidebar is tried first.
- **Tests:** a table test over widths 960…2560 and every panel combination asserts MAIN ≥ 640.

## 19. Surface chrome registry (v2.1; ADR-U20, M25, packages W1-15 + CHR)

```ts
// packages/core/src/platform/chrome.ts ✚
export interface SidebarSchema {
  surface: string
  defaultWidth: 220 | 224 | 240 | 260 | 280
  header: { titleKey: string; create?: { default: CommandName; menu: CommandName[] } }
  pinned: { kinds: EntityKind[] } | false
  sections: SidebarSection[]            // ordered; ids are slot ids `<surface>.sidebar.<section>`
  footer?: 'quota' | 'org' | 'accounts' | 'agent-status' | null
  contextMenu: { extra: MenuItemSpec[] } // appended to the common menu
}
export interface SidebarSection {
  id: string; titleKey?: string; collapsible: boolean
  rows: 'static' | 'provider'            // provider = list from a module query (lists, folders, chats…)
  counter?: { provider: string; tone: 'action' | 'volume' }
  drop?: CommandName                     // X-13 drop target command
}
export interface TopBarSchema {
  surface: string
  left: Array<'back-forward' | 'breadcrumb' | 'title' | 'status' | 'privacy' | 'saved-state'>
  center: { kind: 'views'; views: ViewId[] } | { kind: 'date-nav'; ranges: ('day'|'week'|'month')[] }
        | { kind: 'tabs'; tabs: TabId[] } | { kind: 'query' } | null
  right: Array<'filter' | 'sort' | 'search' | 'presence' | 'share' | { primary: CommandName } | 'more'>
  // '@rox' is appended by the shell; surfaces cannot remove or reorder it
}
```
- **Registration.** Each surface package registers its `SidebarSchema` and `TopBarSchema` in W1-07's slot registry (`<surface>.chrome`).
- **Rendering.** The shell renders both from the schemas, so there are no per-surface header components.
- **Contributions.** Other packages add sections or right-zone items only through existing slot ids (e.g. DOC-2 adds «Диск ▸» to `docs.sidebar`, DRV supplies the quota footer).
- **Counters.** Counter providers are queries registered by the owner module (`counter.<id>`). They are pushed through the realtime topic `user.counters` with a 1 s coalescing window.
- **Persistence.** Widths and collapsed state go in `{configDir}/ui/chrome.json`, per surface.
- **Tests:**
  - a schema lint: every surface in UI-SPEC §26.2 has a schema, the right-zone order matches §26.1, and there is at most one center control;
  - snapshot tests per surface in both UI profiles;
  - a DOM gate: there is exactly one element with `role="navigation"` and `data-rail`.

## 20. Cross-functional capability contracts X-13…X-26 (v2.1; M26, package XFN)
All commands below are additive to the catalogue (contract RFC after `contracts-v1`; W1-15 registers their names and zod schemas). Each one has a W1-06-style reference handler.

| ID | Command / query | Owner module | Writes | Risk class (agent) | Undo |
|---|---|---|---|---|---|
| X-13 | `entities.drop{source: EntityRef[], target: EntityRef, intent?}` | core (dispatcher) | resolves to one owner command by a `(sourceKind, targetKind)` table; unknown pairs → `available:false` | as the resolved command | yes (via the resolved command) |
| X-14 | `calendar.create_time_block{taskRef, start, end}` | calendar | `calendar_event` with `origin_ref = task:<id>`, `show_as='busy'`, + `entity_link(task → calendar-event, 'in-calendar', role 'time-block')`. Without a workspace calendar it writes through the provider adapter; without either, the capability is unavailable | routine | yes |
| X-15 | `meetings.publish_outcomes{callId, decisions[], tasks[], summary}` | meetings | `decision` records, `tasks.create` × n, `docs.append_block` to the minutes doc, `im.send_message` (summary card); all `derived-from` the call | consequential (assigns others, posts) | per created item |
| X-16 | `reminders.create{subjectRef, at}`, `reminders.cancel{id}` | tasks / calendar (reminder kind 18) | the local `reminder` record with a new `subjectRef`; at fire time it emits notification kind `reminder_due` → Inbox + OS | routine | yes |
| X-17 | `checkins.draft_from_activity{subjectRef, since}` | goals (CHK) | none (returns a draft) | routine | — |
| X-18 | `goals.link_work{goalRef, workRef}` / `goals.unlink_work` | goals | `entity_link(work → goal, 'aligned-to')` or `(task → project, 'member-of')` | routine (own work) / consequential (others' work) | yes |
| X-19 | `commands.batch{commands[], label}` | core | runs each command, one batch receipt, one undo group; partial failure reports per item | max of the items | yes (group) |
| X-20 | `people.get_overview{personRef}` | contacts | none (read model over `entity_link`, calendar free / busy, ACL-filtered) | — | — |
| X-21 | `agenda.today{date}` | core read model (W1-09) | none; merges calendar, time blocks, tasks, check-ins due, approvals, R1 notes | — | — |
| X-22 | `tasks.create_from_email`, `calendar.create_event_from_email`, `docs.create_from_email`, `im.share_entity{ref: mail-message}` | tasks / calendar / docs / messenger | the target entity + `derived-from` the mail message; attachments → Drive (`drive.import_attachment`) | routine / consequential (attendees) | yes |
| X-23 | `forms.configure_on_submit{formRef, actions[]}`; runtime: on `forms.response_submitted` the form owner's actions dispatch `tasks.create` / `tables.insert_row` / `im.send_message` | forms (TBL) | per action; idempotency key `formResponseId:actionIndex` | consequential (configuring) | per action |
| X-24 | `vc.start_meeting{origin: EntityRef, invite: principalIds}` | meetings | `call` + invitations, `derived-from` the origin | consequential | end call |
| X-25 | `agents.panel_open{focusRef}` | agent panel (AGP) | none (UI command) | — | — |
| X-26 | `entities.pin{ref}`, `entities.unpin{ref}`, `entities.reorder_pins{refs[]}` | core | `entity_link(person:me → ref, 'relates-to', role 'pin', anchor {position})`. Pin links are **private to `created_by`** and excluded from backlinks, search and activity (ACL rule `pin-private`). Local-only users store pins in `{configDir}/ui/pins.json` | routine | yes |

- **Capability discovery.** Each entry point asks the registry (`available`, `reason`), as in W1-03. With `xfn.capabilities.v1` off or the owner module's flag off, the entry is hidden.
- **Events.** `xfn.*` events are not added. The resolved owner commands emit their usual events, so activity and notifications need no new types except notification kind `reminder_due`, which is added to DATA-MODEL §9.
