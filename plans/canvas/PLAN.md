# PLAN — «Доска»
Each WP = its own branch from origin/main → independent adversarial review (fresh reviewer) → fixes → re-review → PR. Merges only per batch with Mark's ok. Commit as agisota. tsc on the Mac (8GB heap) in ~/rox-work/canvas.

## Phase 0 — Discovery & design (this) ✅
PRD/SPEC/PLAN; license verdict (ELv2 → clean-room).

## Phase 1 — Foundations (parallel)
- WP1.1 `canvas-core`: schema+zod, Yjs binding, fractional index, commands, undo, migrations. Tests.
- WP1.2 Surface shell: route, WORKBENCH flag `canvas`, primary-nav/pill entry «Доска» + glyph, empty board list, i18n keys in 12 locales.
- WP1.3 Local persistence in main (workspace/canvas), board index, IPC/RPC.
- WP1.4 Relay MVP (`canvas-relay`): y-protocols, SQLite log, healthz, a shared-secret auth mode; binary + Dockerfile.
## Phase 2 — Editor core (parallel after 1.1)
- WP2.1 Stage renderer, pan/zoom, hit-test, selection/transform, snapping/guides.
- WP2.2 Basic objects: shape, text (Y.Text), sticky, line, ink, image (assets), frame, group.
- WP2.3 Panels: toolbar, inspector (style), layers, minimap, context menu, shortcuts, ⌘K.
## Phase 3 — Live entity cards (right after the editor core)
- WP3.1 canvas-core `entity` type + `EntityKindRegistry` + board ops (DONE on feat/canvas-core, tested).
- WP3.2 entity-links: kind `canvas` with objectId fragment; link/unlink RPC; backlinks render «На доске …».
- WP3.3 adapters for every EntityKind, auto-registered from the kind list (create via existing APIs, read, subscribe, open, explicit delete).
- WP3.4 card UI (title/status/preview, open natively), «+ Сущность» picker of creatable kinds, drag-and-drop of existing entities, delete dialog (unlink vs. delete entity).
- WP3.5 agent tools `canvas_create_entity_card`, `canvas_link_entity`.
## Phase 4 — Collaboration & auth
- WP4.1 rox-id token endpoint + JWKS verification in the relay; scopes; guest share links. (Server change → backup, reversible.)
- WP4.2 Presence: cursors, avatars, selections, follow mode; offline merge tests (2-client e2e).
- WP4.3 eu-swiss deploy: canvas.rox.one TLS, systemd/docker, backups, monitoring. Settings section with relay URL + test.
## Phase 5 — Full object parity
- WP5.1 Connectors + routing, mindmap, diagram-code (mermaid), auto-layout.
- WP5.2 Table, chart, embed, video/audio, QR, icon/sticker/stamp, mask/boolean, effects/gradients/patterns.
- WP5.3 Comments, version history, templates, present mode, export PNG/SVG/PDF/JSON, search.
## Phase 6 — AI & entity links
- WP6.1 Entity kind `canvas` (+fragment), link UI in the inspector, backlinks in notes/tasks.
- WP6.2 Agent tools (§6 SPEC), @rox prompt bar, generate/organize/summarize, stickies→tasks.
## Phase 7 — Sheets & formulas
- WP7.1 formula engine (packages/canvas-formula): tokenizer, parser, evaluator, dependency graph, recalculation; ~150 functions. WP7.2 sheet object + standalone sheet UI; charts bound to ranges.
## Phase 8 — Docs
- WP8.1 doc object/page on Y.XmlFragment (editor reusing Rox's notes editor stack where possible). WP8.2 export (md/docx/pdf).
## Phase 9 — Timeline (video/audio)
- WP9.1 timeline model (tracks/clips/keyframes) in canvas-core. WP9.2 editor UI. WP9.3 render pipeline (ffmpeg in main, progress, cancel).
## Phase 10 — Print & publishing
- WP10.1 print export (bleed/crop marks/page sizes). WP10.2 publish as website (static bundle + hosting on the relay host, view links, unpublish).
## Phase 11 — Stock library & AI studio
- WP11.1 stock provider adapters + licensing metadata. WP11.2 AI studio: generate/edit/remove-bg/upscale via Rox providers; text-to-design.
## Phase 12 — Hardening
Perf (5k objects), a11y, RTL (ar), i18n coverage 100%, e2e Playwright, self-host docs, release.

Parallel lanes: {1.1,1.2,1.3,1.4} → {2.x, 3.1, 3.3 prep} → {3.2, 4.x, 5.1} → {5.2} → 6.

Parallel lanes extended: phases 6–10 run in parallel with each other after Phase 2 (they depend only on canvas-core + editor shell).

## Phase 1 status
- WP1.1 canvas-core (schema, fractional z-order, CanvasDoc, per-actor undo) + WP1.3 local file store: implemented, 10 tests green.
- WP1.4 relay MVP: implemented (Bun WS, y-protocols, SQLite, HS256 room tokens, Docker, single binary), 3 tests green.
- WP1.2 nav entry + screen + locales: next.

## Open risks
1. License: ELv2 — even "inspiration" must stay clean-room (no copying of code, icons, theme catalog, or templates). Get Mark to confirm we don't want a commercial license instead.
2. Full 1:1 scope confirmed: the timeline render (ffmpeg licensing/bundling), the stock-provider API terms, and the 150-function formula engine are the biggest effort items.
3. Arc Glass is not on main yet: token names may change; depend on tokens via semantic aliases.
4. rox-id/Pocket ID: unknown support for custom token endpoints/JWKS. May need a small sidecar on eu-swiss.
5. The workspace path: the code uses `~/.rox/workspaces/<ws>`, while the brief says `~/rox`. Confirm.
6. The comment-only scope enforcement on Yjs updates is non-trivial (server-side decode).
7. Electron renderer perf for 5k objects with rich text; may need WebGL later.
8. Box memory: no full tsc/build on the box; validation on the Mac.
9. The subdomain DNS for canvas.rox.one (who controls DNS?).

## Cross-cutting: performance budgets
Every phase must keep the budgets in SPEC "Performance budgets" green (lazy chunk, list ≤150 ms, 1k open ≤500 ms, 60 fps on 5k via culling, rAF-batched Yjs, no >50 ms block). `bun run bench` in packages/canvas-core and the surface measurements run on the Mac; numbers go into each report.
