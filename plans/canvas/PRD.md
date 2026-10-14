# PRD — Rox «Доска» (Canvas)

## License verdict (HyCanvas)
- HyCanvas = **Elastic License 2.0** (LICENSE, package.json `"license":"Elastic-2.0"`), + CLA, NOTICE, COMMERCIAL.md (HyScaler).
- Not GPL/AGPL, but **source-available, not OSI open-source**. ELv2 forbids providing the software to third parties as a hosted/managed service, forbids circumventing license keys, requires keeping notices.
- rox-one is **Apache-2.0**. Copying ELv2 code would make parts of rox-one non-Apache, and running it via our eu-swiss relay for all users is at risk under the managed-service clause.
- **Decision (Mark, 2026-10-14): clean-room reimplementation from behavior/docs only. No code, assets, or theme files copied.** Use MIT/Apache dependencies (Yjs, y-protocols, perfect-freehand, elkjs, rbush...). Feature parity is defined by behavior, not by porting.

## Problem / goal
Rox has notes, tasks, sessions, and pages, but no spatial whiteboard. «Доска» adds a native, collaborative, AI-assisted infinite canvas with HyCanvas-level features, linked to Rox entities.

## Users
Rox workspace members (realtime co-editing), external guests (share link, limited scope), Rox agents/@rox (programmatic editing).

## Scope (parity targets, from the HyCanvas inventory)
Object types: shape (rect/ellipse/polygon/star etc.), path/vector (pen), ink (freehand), line, connector (routed, with arrowheads and labels), text (rich, bullets), sticky, sticker, stamp, icon, image, video, audio, embed, QR, table, chart, group, frame/section/region, mask, boolean ops, mindmap, diagram-as-code (mermaid), boardview (nested board), slide/deck (present mode), comments.
Styling: solid/linear/gradient/pattern/image fills, strokes, effects (drop/inner shadow, fade, blur, hologram), themes/brand kit, fonts.
Editor: infinite pan/zoom, select/multi-select/marquee, transform/rotate, snapping and smart guides, align/distribute, z-order, lock/hide, layers panel, grouping, copy/paste/duplicate, undo/redo (per-user), keyboard shortcuts, command menu (⌘K), search on the board, minimap, templates, auto-layout of diagrams (tree/mindmap/flow), export PNG/SVG/PDF/JSON, import images/files by drag-drop, present mode (frames as slides), accessibility (keyboard nav, alt text).
Collab: live cursors, presence avatars, selections of others, follow mode, comments/threads, version history and restore.
Also in scope (Mark: FULL 1:1, nothing deferred) — the Canva-sized modules, each clean-room:
- **Sheets**: grid object + standalone sheet, formula engine (own parser/evaluator, A1 refs, ranges, ~150 common functions), charts bound to ranges.
- **Docs**: rich-text document object/page (Y.XmlFragment), headings/lists/tables/images, export.
- **Timeline**: video/audio timeline editor (tracks, clips, trims, transitions, captions), render via ffmpeg in main.
- **Print**: print-ready export (PDF/X-like: bleed, crop marks, CMYK preview), page sizes.
- **Publishing**: publish a board/deck/doc as a website (static export + optional hosting on our relay host), custom slugs, view-only links.
- **Stock library**: provider adapters (Unsplash/Pexels/Openverse APIs with user keys; licenses shown), search/insert.
- **AI studio**: image generation/editing, background removal, upscaling via Rox AI providers; text-to-design.
- Brand kit, templates (our own originals), audio objects.
Billing is not part of Rox and stays out.

## AI (Rox-native)
@rox and agents: create/edit/delete/move objects; generate a diagram or board from a prompt (mermaid → nodes, mindmap, flow, kanban, retro); organize (cluster, auto-layout, tidy); summarize a selection or a board to a note/task; convert stickies → tasks; link objects ↔ notes/tasks/sessions/pages via entity-links; canvas as session context (export of selection as structured text plus a snapshot).

## Non-functional
- Native Rox UI (tokens, Arc Glass, panel strip, sidebar/pill), no WebView.
- Offline-first: works without a relay, then syncs. Local doc in the workspace.
- 60 fps at 5k objects; open in <500 ms for 1k objects.
- 12 locales: ar (RTL), de, en, es, fr, hu, ja, ko, pl, ru, zh-Hans, zh-Hant.
- Default relay works out of the box (eu-swiss); self-host via a single binary or Docker; relay URL in Settings.
- Security: signed room tokens, scoped guest links, no secrets in logs.

## Success metrics
Two users on different machines co-edit with <150 ms cursor latency; zero lost edits in offline merge tests; every listed object type creatable via UI and via AI tool; all strings localized (coverage check = 100%).
