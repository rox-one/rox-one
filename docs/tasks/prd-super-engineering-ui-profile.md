# PRD: super.engineering UI profile (rox-one)

## Introduction

Optional dark glass agent-IDE shell for users who want super.engineering-like UX inside Rox Electron app. Default install remains light/Russian Rox.

## Goals

- G1: User can select theme **super.engineering** in Appearance without affecting other profiles.
- G2: With a git workspace, project tree + Changes/Overview/Checks tabs resemble SE frames 10–13.
- G3: Hub, onboarding, and post-update flows match reference spec when profile active.
- G4: All acceptance automated where possible; visual QA against 14 reference PNGs.

## Non-goals

- Replacing Rox global sidebar with SE for all users.
- GPUI binary parity or shipping super.engineering fork.
- HIPAA/commercial certification surfaces.

## User stories (wave 1)

### US-SE-001: Theme preset
**Description:** As a user, I want a super.engineering color theme so the app matches the reference IDE.

**Acceptance:**
- [ ] `super-engineering.json` appears in theme picker
- [ ] Selecting it sets `data-ui-profile="super-engineering"` on `<html>`
- [ ] Default new profile still uses Rox light theme
- [ ] Typecheck passes

### US-SE-002: Workspace navigator skeleton
**Description:** As a developer with a repo, I want a left project panel like SE.

**Acceptance:**
- [ ] Compact/Detailed toggle in Appearance (persisted)
- [ ] Detailed shows branch row + mock stats from fixture
- [ ] Compact shows hover card delay ≥200ms
- [ ] Rox-default layout unchanged without SE theme

### US-SE-003: Git status strip
**Description:** As a user, I see branch and dirty count above the composer (frame 10).

**Acceptance:**
- [ ] `GitStatusBar` visible in SE workspace mode
- [ ] Click on identity error opens details (stub OK)
- [ ] Verify in browser with SE theme + mock repo

### US-SE-004: Hub tagline
**Description:** As a user on empty hub, I see rotating scramble taglines (frames 05–06).

**Acceptance:**
- [ ] `ScrambleTagline` cycles phrases from `hub-taglines.ts`
- [ ] Scramble phase uses charset noise between phrases
- [ ] Reduced motion → cross-fade only

### US-SE-005: Edge-reveal inspector
**Description:** As a user, I can hide the right panel and reveal it by hovering the edge.

**Acceptance:**
- [ ] Three states: hidden → hover (~8px) → pinned
- [ ] Interruptible spring; respects `auto_hide_sidebars`
- [ ] zen-shell acceptance tests still pass

## Functional requirements

- FR-1: `uiProfile` derived from theme JSON field `uiProfile` when present.
- FR-2: `ShellLayoutMode` enum: `rox-default` | `se-workspace`.
- FR-3: Parallel agents obey `se-wave1-contract.json` allowlists.
- FR-4: INTEGRATOR merges shell after W1-A–D complete.

## Success metrics

- SE theme selectable in &lt;3 clicks from Settings.
- No regression in `zen-shell-acceptance.test.ts` on default profile.
- 14-frame checklist in `super-engineering-parity.md` tracks code status.

## Open questions

- Ship SE onboarding only on first run with SE theme, or global wizard variant?
- Extract taglines from SE binary vs curated list for v1?
