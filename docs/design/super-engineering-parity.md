# super.engineering UX parity (rox-one)

**Branch:** `feat/super-engineering-ui-parity`  
**Reference spec:** `/Users/t/Pictures/Shots/Agents/super-engineering-ux-20261007/super-engineering-UX-spec-2026-10-07.md`  
**Reference frames:** `.../reference-frames/` (14 PNG)  
**PRD:** [`docs/tasks/prd-super-engineering-ui-profile.md`](../tasks/prd-super-engineering-ui-profile.md)  
**Technical spec:** [`super-engineering-spec.md`](./super-engineering-spec.md)  
**Wave contract:** [`se-wave1-contract.json`](./se-wave1-contract.json)

**Target:** optional profile `super-engineering` via `data-ui-profile` / theme `super-engineering.json` — default Rox light profile unchanged.

## Stack note

super.engineering is **GPUI (Rust)**; rox-one is **Electron + React + Vite**. Parity is **visual and interaction**, not pixel-perfect native behavior.

## Phase checklist

| ID | Area | Spec | Frames | Code status |
|----|------|------|--------|-------------|
| P0 | Design doc + frames | ✓ | ✓ | **Done** (this branch S0) |
| P1 | Theme `super-engineering.json`, tokens, `data-ui-profile`, glass/blur | Spec § tokens | 01, 15 | Theme JSON seeded; wiring **W1-A** |
| P2 | Onboarding 1–4 | §01–04 | 01–04 | Partial; **W1-G** |
| P3 | Project hub + scramble taglines | §05–08 | 05+ | **W1-E** |
| P4 | What's New, Quick start, Clone | Spec | 07–09 | **W1-G** |
| P5 | Workspace shell + auto-hide | Spec | 09–11 | **W1-C**, **W1-D** |
| P6 | Git status bar | Spec | 10–11 | **W1-F** |
| P7 | Right Files panel | Spec | 12–13 | **W1-D** |
| P8 | Settings Appearance | Spec | 14 | **W1-H** |
| P9 | View menu | Spec § View | — | **W1-H** |
| P10 | Acceptance + visual QA | — | All | **W1-I** |

## Sidebar architecture (summary)

- **Rox default:** `LeftSidebar` + `nav-destinations.ts` (unchanged).
- **SE workspace:** `WorkspaceNavigator` (project tree, Changes/Overview/Checks) — see technical spec §2–3.
- **Icons:** SE styling layer on nav; workspace uses dedicated Lucide set — spec §4.

## Motion tokens

- Modal spring: damping ~1.0, response ~0.35s  
- Sidebar hover reveal: ~200–300ms  
- Hub tagline scramble: 2–4s cycle  
- Backdrop blur: **20px** minimum on glass surfaces  

## Rox defaults (do not break)

- Light, compact, Russian copy, Rox Mono remain default when profile is not `super-engineering`.

## Parallel wave 1

Run agents **W1-A … W1-H** in parallel per contract; **INTEGRATOR** merges `AppShell` last.
