# super.engineering UI profile — technical spec (rox-one)

**Status:** Wave 1 in progress on branch `feat/super-engineering-ui-parity`  
**Contract:** [`se-wave1-contract.json`](./se-wave1-contract.json)

## 1. Scope

- **In:** Opt-in visual/interaction parity with super.engineering (GPUI reference).
- **Out:** Pixel-perfect native GPUI, replacing Rox September PRD defaults (U06 Inter/Rox brand), Liquid Glass for all users, merging Conation fork.

## 2. Shell layout modes

| Mode | When | Left column | Center | Right |
|------|------|-------------|--------|-------|
| `rox-default` | `uiProfile !== super-engineering` | `LeftSidebar` global nav (`nav-destinations.ts`) | Navigator + content | `InspectorHost` |
| `se-workspace` | SE profile + git repo open | `WorkspaceNavigator` (260px) + optional 52px rail | Chat / commits / terminal stack | Edge-reveal inspector |

Composition root: `ShellLayoutMode.tsx` (new). **Only INTEGRATOR** wires it in `AppShell.tsx`.

## 3. Sidebar semantics (SE)

Mirror `~/.super.engineering/settings.json`:

- `left_sidebar_layout`: `compact` | `detailed`
- `auto_hide_sidebars`: boolean
- `left_sidebar_width_design`: ~260

**Compact:** short labels; git/PR on hover (`WorktreeHoverCard`, 200–300ms).  
**Detailed:** branch rows with diff stats (+128/−12).

Data layer: `useWorkspaceGitModel()` (stub OK in wave 1; fixtures for UI).

## 4. Icons

1. **Global nav (unchanged glyphs in v1):** `getSeNavIconProps(destinationId)` — stroke 1.5, muted foreground, active `bg-white/6`.
2. **Workspace nav:** Lucide `FolderGit2`, `GitBranch`, `GitPullRequest`, `CircleCheck`, etc.
3. **v2 (optional):** SVG extract → `packages/ui/src/icons/se/`.

Rox default path must not change icon sizes (U06 compact rail alignment).

## 5. Theme & tokens

- Preset: `apps/electron/resources/themes/super-engineering.json` (`uiProfile: super-engineering`).
- DOM: `html[data-ui-profile="super-engineering"]` in `packages/ui/src/styles/index.css`.
- Glass: `--chrome-glass-blur: 20px`, panel radius 8px, composer 10px.
- Motion: `super-engineering-springs.ts` — panel stiffness ~380, modal ~520, damping ~38–42.

`ThemeContext` sets `dataset.uiProfile` when resolved theme includes `uiProfile`.

## 6. Frame map (acceptance)

| Frame | State | Primary components |
|-------|--------|-------------------|
| 01–04 | Onboarding | `OnboardingWizard` SE steps |
| 05–06 | Hub + tagline | `ProjectHub`, `ScrambleTagline` |
| 07 | What's New | `WhatsNewSheet` |
| 08–09 | Quick start / clone | hub dialogs |
| 10–11 | Workspace + git strip | `GitStatusBar`, composer |
| 12–13 | Right files / changes | `InspectorHost` + edge-reveal |
| 14 | Settings | `AppearanceSettingsPage` |

## 7. Relation to September PRD

See [`super-engineering-spec-addendum.md`](./super-engineering-spec-addendum.md) — U06/U15 unchanged for default; SE is additive.
