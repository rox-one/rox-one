# Golden Gate: tokens and shared controls

The shared source is `packages/ui/src/styles/index.css`. Electron adds viewport,
scenic material, and chrome rules in `apps/electron/src/renderer/index.css`.
Existing color and per-role font preferences retain their priority.

## Palette and roles

| Role | Light default | Dark default |
| --- | --- | --- |
| Canvas | `#f7f7f5` | `#202120` |
| Primary text | `#262624` | `#ededeb` |
| Accent | `#a65c3a` | `#d9936c` |
| Secondary text | foreground 74% mixed with canvas | same semantic mix |
| Muted text | foreground 64% mixed with canvas | same semantic mix |
| Links | accent 88% mixed with foreground | same semantic mix |
| Subtle / strong border | foreground 12% / 24% mixed with canvas | same semantic mix |

Core defaults agree with `DEFAULT_THEME`, the bundled default preset, and
`BACKGROUND_HEX`. Presets now populate `--input-surface`; `--input` retains its
existing border role. Hex-based semantic RGB aliases follow the selected theme.

Zen content derives from `--surface-document`, so it follows the chosen palette.
Scenic content uses the preset's opaque popover color. Translucency and a static
12px blur are limited to chrome. Named solid palettes, reduced transparency,
solid material, and high contrast remove that blur. Tooltip and popover content
are opaque and no longer force a dark subtree.

## Geometry and interaction

- Desktop top bar / rail / tab strip / panel header remain 40 / 44 / 34 / 32px.
- Shared buttons, fields, menu items, and editor actions have a 28px mouse floor;
  coarse pointers use 44px. This does not change body font sizes or content rows.
- Radii use 4 / 6 / 8 / 12 / 16px. Legacy 6 / 8px ROX aliases remain available.
- Content elevation is border-led. Transient menus use a separate finite shadow.
- Motion tokens are 120 / 180 / 220ms. Popover and tooltip reveal uses opacity and
  transform; blur is never animated. Reduced motion removes ongoing decorative
  animation and shortens transitions.
- Input, Select, Textarea, and Button use semantic focus, surface, and border roles.

Rendered markdown uses solid underlines for real links and standard focus.
Standalone explanatory citations retain dotted underlines. Links containing a
citation have one keyboard stop. File links without a DOM-safe `href` support
Enter; safe web links retain native behavior without an application callback.
Code, search marks, table boundaries, and quotation text use semantic roles.

## Verification evidence

2026-09-14:

- 42 targeted tests passed across token, font-role, theme, markdown link-routing,
  and citation suites. This includes custom input surfaces, semantic RGB aliases,
  default/preset/window color agreement, and citation keyboard-stop behavior.
- `bun run tsc --noEmit` in `packages/ui` passed.
- Tailwind compilation passed. Fixing the swallowed header comment by merely
  reactivating imports duplicated reset and typography output. Shared CSS is now
  explicitly token-only; each consuming app owns its entry. Viewer received the
  same entry used by Electron. Compiled renderer still has one typography block
  and the same two `box-sizing: border-box` declarations (preflight plus app base).
- Default canvas contrast calculated from compiled sRGB colors: light primary
  14.13:1, muted 5.05:1, links 5.29:1, accent 4.65:1; dark primary 13.78:1,
  muted 5.93:1, links 7.14:1, accent 6.42:1. These are token calculations, not a
  claim that all existing screens or user-provided themes have passed an audit.
- Renderer build transformed 4,684 modules, then stopped at the concurrently
  unfinished `DeviceStatusChip` import. The coordinator owns the integrated build.
- `git diff --check` passed.

Visual browser and native macOS acceptance remain open: the available browser
policy did not authorize navigation to the local app. No substitute screenshot,
native material validation, or GPU performance result is claimed.

## Shared screen implementation

The second pass applies the compact language through reusable screen components;
individual screen fields, actions, routes, storage, and data loading are retained.

Requirements implemented:

- `SettingsUIConstants` owns 14px horizontal / 10px vertical row padding, a 44px
  row floor, 13px labels, 12px descriptions, 8px section gaps, and 8px card radii.
  Row, Toggle, Input, Select, MenuSelect, Textarea, RadioGroup, and SegmentedControl
  consume these roles. Card content and footers use the same padding.
- Settings field wrappers no longer suppress the Input/Textarea focus ring.
  Descriptions wrap instead of silently truncating. The Switch keeps a compact
  32×18px visual track inside a 28px mouse / 44px coarse-pointer target.
- `PanelHeader` uses `--chrome-panel-header-height` (32px desktop, 48px coarse
  pointer). Its title and stoplight-spacing transitions respect reduced motion.
  Compact shell registration and action slots retain their existing behavior.
- `Info_Page` uses opaque content, 20px gutters/section gaps, and a 960px maximum
  readable width. Its old 32px scroll-edge masks are removed so content and
  controls remain visible. `Info_Section` shares settings section/card styles;
  definition-list properties stack in narrow panels.
- Collection controls, operation strip, bulk bar, and display/filter menu rows
  share semantic surfaces, compact spacing, and hit-target floors. Collection
  menu/bulk surfaces no longer apply backdrop blur.
- Shared StyledDropdown exposes standard slot hooks, 13px menu typography,
  semantic hover/selection/focus, viewport width limits, and finite motion.
  Dialog uses opaque content, a semantic dimming backdrop, 20px padding, 12px
  radius, a viewport height limit, and a full-size close target. Existing portal,
  dismissal, focus management, and action callbacks remain with Radix.

Exact source coverage, audited against the 22-component settings registry and
non-test/non-playground JSX consumers on 2026-09-14:

| Shared layer | Direct coverage |
| --- | --- |
| PanelHeader | 22 / 22 registered settings pages |
| SettingsSection | 19 / 22 registered settings pages |
| SettingsCard | 20 / 22 registered settings pages |
| Row / field families | 15 / 22 registered pages use them directly |
| Info_Page | SourceInfoPage, SkillInfoPage, ProjectInfoPage, AutomationInfoPage |
| CollectionViewChrome | Navigator in AppShell, KanbanBoardContainer, SessionTableHost, SessionHeatmapHost |
| StyledDropdown | 33 consuming source files across renderer and shared UI |
| DialogContent | 32 consuming source files |

The 15 pages directly using shared row/field families are account, privacy,
runtime, context, knowledge, app, ai, appearance, input, workspace, accounts,
organizations, server, cloudRuns, and shortcuts. Permissions, labels, messaging,
and security inherit shared sections/cards around specialized bodies. Marketplace
uses the shared card/header; extensions and import use the shared header and base
controls while retaining their custom bodies. These are source-inheritance counts,
not a claim that every conditional state received visual inspection.

Additional verification:

```sh
bun test apps/electron/src/renderer/components/settings/__tests__ \
  apps/electron/src/renderer/components/app-shell/collection/__tests__ \
  apps/electron/src/renderer/pages/settings/__tests__/settings-chrome-p35.test.ts \
  packages/ui/src/components/ui/__tests__/styled-dropdown.test.ts \
  packages/ui/src/styles/__tests__
```

Result: **82 passed, 0 failed**, 325 assertions across 19 files. The existing header
consistency assertion now checks the shared height token instead of the former
42px literal. Shared UI TypeScript checking passed. Electron TypeScript checking
still reports pre-existing repository errors; none target the changed settings,
info, dialog, collection, PanelHeader, or StyledDropdown components.

Tailwind compilation confirms generated settings padding, header height, dialog
radius, and scoped overlay-motion rules, with one typography block and unchanged
reset count. `git diff --check` passed. Browser/native visual acceptance remains
open under the limitation documented above.
