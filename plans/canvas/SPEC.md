# SPEC — «Доска»

## 1. Package layout (rox-one, bun monorepo)
- `packages/canvas-core` (new, pure TS, no DOM): schema, Yjs binding, geometry, hit-testing (rbush), routing, layout (elkjs), commands, undo, serialization/export, mermaid→graph. Unit-tested with bun test.
- `packages/canvas-relay` (new): Bun WebSocket server (y-protocols sync + awareness), auth verifier, persistence (SQLite/LevelDB snapshot + update log), health/metrics. Compiled with `bun build --compile` → single binary; Dockerfile.
- `apps/electron/src/renderer/surfaces/canvas/*`: React renderer (Canvas2D/WebGL stage + DOM overlay for text editing), toolbars, panels, using `packages/ui` components and tokens.
- `apps/electron/src/main/canvas/*`: local persistence (y-leveldb or file store), relay connection manager, token fetch via Rox identity.
- `packages/session-tools-core`: canvas tool defs (see §6).

## 2. Integration points (found in rox-one)
- Navigation: `apps/electron/src/renderer/components/app-shell/primary-nav.ts` (ONE ordered list for the sidebar + ActivityRail, flag gating `shellFlag`/`modeFlag`), `sidebar-registry.ts`, `nav-placement.ts`, `platform/mode-registry-bootstrap.ts`, `platform/modes-seed.ts` (`SEEDED_MODES`), `platform/usePillNav.ts`, `pill-composition.ts`, `SurfaceTabs.tsx`, `surface-shell.ts`. Icons: `platform/glyphs.ts` (`GLYPHS`) + `lucide-icon.ts` → use the lucide `PenTool`/`Presentation` style consistent with the rail (verify glyphs.test.ts). Routes: `apps/electron/src/shared/routes` + `isXNavigation` guards in `shared/types`. Add a workbench flag `canvas` (WORKBENCH_FLAG in `@rox/core/platform`).
- i18n: `packages/shared/src/i18n/locales/{ar,de,en,es,fr,hu,ja,ko,pl,ru,zh-Hans,zh-Hant}.json`, with keys under `canvas.*`.
- Entity links: `packages/shared/src/entities/schemas.ts` (`EntityKind`, `kindTakesFragment`), `packages/server-core/src/entities/link-store.ts` (`getEntityLinkStore(workspaceRoot)`), RPC `packages/server-core/src/handlers/rpc/entities.ts`. Add kind `canvas` with fragment = objectId, so a link can point at a board or at a single object.
- Agent tools: `packages/session-tools-core/src/tool-defs.ts` (`{name, description, inputSchema, executionMode:'registry', safeMode, readOnly, handler}`), `tool-defs-filtering.ts`; capability catalog `apps/electron/src/renderer/lib/capability-catalog.ts`.
- Settings: `apps/electron/src/renderer/components/settings/*` (SettingsSection/Row/Input/Toggle) → section «Доска»: relay URL, self-host test-connection, default share scope, cursor name/color.
- Workspace storage: the workspace dir from getConfigPaths() (storage-paths tests). The brief says "~/rox": confirm. Boards at `<ws>/canvas/<boardId>.ydoc` + `index.json`.
- Theme: Arc Glass is on branch `feat/theme-arc-glass` (not on main in my shallow clone). The canvas surface renders as a floating card content; panels flush inside. Consume tokens only (no hex), with a lint rule similar to HyCanvas's theme-token check (written independently).

## 3. Data model (Yjs doc per board)
```
Y.Doc (guid = boardId)
 meta: Y.Map { schemaVersion, title, createdBy, createdAt, background, gridMode }
 objects: Y.Map<objectId, Y.Map>          // flat; tree via parentId
   common: id, type, parentId, index (fractional string for z-order), x,y,w,h, rotation,
           locked, hidden, opacity, style (Y.Map: fill, stroke, effects, font), name,
           links: Y.Array<{kind,id,fragment?}>, createdBy, updatedAt
   type-specific: text → Y.Text (rich via Y.Text attributes); points (ink/path) → Y.Array<number>;
     connector → {from:{objectId,anchor}|{x,y}, to, routing:'straight'|'elbow'|'curved', label:Y.Text, heads};
     table → cells Y.Map<"r:c", Y.Text>, rows/cols Y.Array; chart → spec Y.Map + data Y.Array;
     image/video/audio → assetId; embed → url; qr → payload; diagramcode → source Y.Text + rendered cache;
     mindmap → collapsed flag (topology via parentId); frame → clip, slideIndex; boardview → boardId
 assets: Y.Map<assetId,{hash,mime,size,name}>   // blobs content-addressed outside the doc
 comments: Y.Map<threadId, Y.Map{anchor, resolved, messages:Y.Array}>
```
- Z-order = fractional indexing (no array reorder conflicts). Undo = `Y.UndoManager` with a local origin (per user). Migrations keyed on `schemaVersion`. Validation with zod in canvas-core; unknown types preserved (forward-compat).
- Assets: content-addressed `<ws>/canvas/assets/<sha256>`; relay stores blobs per room (`PUT/GET /assets/:room/:hash`, authorized by the same token).

## 4. Relay protocol & auth
- Transport: WSS `wss://canvas.rox.one/r/<roomId>` (proposed subdomain). Messages = standard y-protocols (sync step1/2, update, awareness) + a custom `auth-refresh` frame. Compatible with `y-websocket` clients.
- Room id = `<workspaceId>:<boardId>`.
- Token: short-lived (10 min) JWT, EdDSA, issued by rox-id (id.rox.one / Pocket ID on eu-swiss) via a new endpoint `POST /canvas/token {workspaceId, boardId}` → claims `{sub, ws, room, scope:'edit'|'comment'|'view', exp, jti}`. The relay verifies offline using JWKS (cached). Guest share links: `rox://canvas/join?t=<shareId>` → rox-id exchanges shareId for a guest token with limited scope/expiry; revocable list.
- Server enforces scope: view/comment clients cannot send doc updates (comment scope may only write under `comments`, enforced by decoding the update into a staging doc and checking changed keys).
- Persistence: append updates to an SQLite log per room, compact into a snapshot every N updates; daily backups; no hard delete (tombstone + retention).
- Offline: client keeps a local y-leveldb/IndexedDB-equivalent file store in main; reconnect = sync step1 diff.
- Awareness: `{user:{id,name,color,avatar}, cursor:{x,y}, selection:[ids], viewport, following?}`, throttled 30 Hz.

## 5. Self-host packaging
- `bun build --compile` → `rox-canvas-relay` (linux-x64/arm64). Config via env: `PORT`, `DATA_DIR`, `JWKS_URL` (or `SHARED_SECRET` mode for standalone self-host), `ALLOWED_ORIGINS`, `MAX_DOC_MB`.
- Docker image (distroless), compose example with Caddy for TLS. `/healthz`, `/metrics`.
- Settings: «Сервер синхронизации»: Rox default (eu-swiss) / custom URL + "Проверить". Standalone mode: the workspace owner generates an invite secret; no rox-id dependency.
- eu-swiss deploy: systemd unit or docker, behind existing reverse proxy, TLS cert for canvas.rox.one; backup DATA_DIR; reversible (previous binary kept).

## 6. AI tools (session-tools-core)
`canvas_list_boards`, `canvas_read(boardId, {selection?, bbox?, format:'outline'|'json'})` (readOnly), `canvas_create_board`, `canvas_add_objects(boardId, objects[])`, `canvas_update_objects`, `canvas_delete_objects` (safeMode: ask), `canvas_layout(boardId, ids, algo:'tree'|'flow'|'grid'|'cluster')`, `canvas_from_mermaid(boardId, source, at)`, `canvas_generate(boardId, prompt, template?)` (LLM → JSON plan → validated ops), `canvas_summarize(boardId, ids?) → note`, `canvas_link(objectId, entity)`, `canvas_stickies_to_tasks`.
Agent edits are applied as Yjs transactions with origin `agent:<sessionId>` (separate undo stack, visible "agent cursor" in awareness). All tools go through canvas-core commands, so the same validation applies as for UI.
In-canvas: an @rox prompt bar on a selection; context menu "Спросить Rox".

## 7. Rendering
Canvas2D stage with a retained scene graph, dirty-rect redraws, an rbush spatial index, and an LOD for far zoom; DOM overlay for text editing (contenteditable bound to Y.Text) and embeds. perfect-freehand for ink. Export: SVG serializer → PNG via offscreen canvas, PDF via the existing Rox PDF path (verify) or pdf-lib (MIT).

## 8. Live entity cards
- Object type `entity`: `props = { kind, entityId, snapshot?: {title,status?,preview?,icon?,updatedAt?}, provenance: 'created'|'linked' }`; `links` carries the ref. Snapshot is a cache for offline render, never the source of truth.
- `canvas-core/src/entities.ts` (implemented): `EntityKindRegistry` + `EntityKindAdapter { kind, labelKey, icon, creatable, create?, read, subscribe?, open, delete? }`, `EntityLinker { link, unlink }`, and board ops `createEntityCard`, `linkEntityCard`, `applyEntitySnapshot`, `removeEntityCards({deleteEntities?})`, `entityCards`. Failed link → card rolled back (no orphan).
- App side (electron renderer): one adapter per `EntityKind` from `packages/shared/src/entities` / `@rox/core/entities` (`isEntityKind`, `entityRoute`), auto-registered by iterating the kind list; create via each module's existing RPC (notes, pages, tasks, sessions, dashboards…); links via `server-core/entities/link-store.ts` RPC with new kind `canvas` (fragment = objectId, `kindTakesFragment('canvas') = true`); `subscribe` via existing entity change events → `applyEntitySnapshot`; `open` → `entityRoute(ref)`.
- Drag-and-drop: `application/x-rox-entity` payload `{kind,id}` from sidebar/omnibox/backlinks → `linkEntityCard`.
- AI tools: `canvas_create_entity_card(boardId, kind, title, at)`, `canvas_link_entity(boardId, ref, at)`; deletion of entities is never done by agents without user confirmation (safeMode: ask).

## Performance budgets (mandatory, enforced by tests/benchmarks)

| Budget | Target | Enforced by |
|---|---|---|
| App startup / other screens | zero cost: «Доска» surface + editor are a separate lazy chunk | `React.lazy` in surface-pages; bundle check |
| Board list interactive | ≤ 150 ms | surface perf measurement (Mac build) |
| Open 1k-object board | ≤ 500 ms | `perf.test.ts` + editor measurement |
| Pan/zoom with 5k objects | 60 fps (≤ 16 ms/frame) | viewport culling via `SpatialIndex` (rbush), query p95 ≤ 2 ms |
| Yjs updates | applied off the render path, coalesced per animation frame (`Y.mergeUpdates`) | editor implementation |
| Main-thread blocking | no single op > 50 ms | `perf.test.ts` |
| z-order keys | bounded growth (integer-head fractional index) | `perf.test.ts` (5k appends → length < 6) |

Numbers measured on the Mac build are included in every report.
