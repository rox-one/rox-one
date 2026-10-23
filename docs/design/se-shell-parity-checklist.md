# Rox Engineering shell parity checklist

**Against:** [`super-engineering-spec.md`](./super-engineering-spec.md) (§2–5) + canon tokens (Designer / New Bot 2026-10-23)  
**Profile:** `uiProfile=super-engineering` → `html[data-ui-profile="super-engineering"]`  
**Theme:** `apps/electron/resources/themes/super-engineering.json` («Rox Engineering»)  
**Updated:** 2026-10-23  
**Contract:** [`se-shell-parity-contract.json`](./se-shell-parity-contract.json)

Glass / blur is **optional and pointwise** (blur ~20px on chrome accents). Not a second design system; Arc Glass Design is retired. Do not open cosmetic blur PRs while the DONE rows below stay green.

## Shell chrome (DONE)

| Spec / canon | Status | Where |
|--------------|--------|--------|
| DOM `data-ui-profile="super-engineering"` | DONE | ThemeContext + `packages/ui` profile block |
| bg `#0d0d0f` / fg `#e8eaed` / accent `#7aa2f7` | DONE | theme JSON + shell bg/fg wiring |
| paper `#141416` / navigator `#121214` / input `#1a1a1e` | DONE | theme JSON + PanelSlot / ActivityRail / search chrome |
| Composer radius **10px** | DONE | `--radius-composer: 10px` under SE |
| Control / pill radius **8px** (`--radius-md`) | DONE | mode-pill density under SE |
| Flush panels (`--rox-radius-panel: 0`) | DONE | deliberate; overrides vague “panel radius 8” for grid panes |
| Ultra-wide paper measure + edge inset | DONE | SE ultra-wide CSS |
| Panel fluid gutter / measure (opt-in) | DONE | PanelSlot wiring |
| Micro-interactions (rail / pills / panel headers) | DONE | SE micro CSS + springs |
| Focus rings + reduced-motion / resize zero | DONE | `--motion-*` + focus-visible |
| Skeleton in shared shell loading | DONE | Skeleton primitive + shell wire |
| Rail collapse below 1280 | DONE | shell width tokens |
| Compact WorktreeHoverCard **200–300ms** delay | DONE | `WORKTREE_HOVER_DELAY_MS=250` in WorkspaceNavigator |
| Optional icons v2 SVG extract | DONE | `packages/ui/src/icons/se/` (stroke 1.5; WorkspaceNavigator wired) |
| Workspace navigator design width **~260** | DONE | `NAVIGATOR_WIDTH_DEFAULT = 260` in `shell-layout-preferences.ts` |
| Dialog / Popover enter–exit springs | DONE | SE CSS → `--motion-spring` / `--ease-spring` (mirrors `SE_SPRING_MODAL`) |
| Menu / Drawer overlay / Tooltip SE springs | DONE | Dropdown+Context `data-overlay-motion`; drawer overlay modal spring; menus/tooltip lighter `--motion-disclosure`/`--motion-base` |
| SimpleDropdown enter via overlay-motion | DONE | drops `duration-100` animate-in; SE menu spring via `dropdown-menu-content` slot |

## Pointwise glass / popover blur (DONE — do not re-PR)

| Spec / canon | Status | Where |
|--------------|--------|--------|
| `--chrome-glass-blur` → **20px** under SE | DONE | `html[data-ui-profile=…] { --chrome-plate-blur: 20px }` (aliases `--chrome-glass-blur`) |
| Popover / menu / dropdown blur ~20px under SE accents | DONE | `material.css` `--glass-blur: 20px` + `arc-glass-skin.css` on `[data-glass-slot="popover"]` |
| Shared Popover / DropdownMenu / ContextMenu + `packages/ui` StyledDropdown / PremiumMenu / SimpleDropdown / FilterableSelectPopover carry `data-glass-slot="popover"` | DONE | shell + ui primitives |
| Accents **opt-in** (`layers.glass` default **0**; `data-glass-accents` when intensity > 0) | DONE | theme JSON + installGlassSkin |
| Weak GPU / `data-glass=basic` / `prefers-reduced-transparency` / high-contrast / low-power → **solid paper**, blur 0 | DONE | skin degradations + renderer opaque-overlay gates |
| No liquid-glass refraction on popovers/menus | DONE | refraction only on pill / Rox Mini at `data-glass=full` |
| Opaque overlays stay opaque when accents off | DONE | `index.css` PERF-07 / UI-AUDIT P1-10 gates |

Lock tests: `packages/ui/src/components/glass/__tests__/glass.test.ts`, `se-accent-skin.test.ts`, plus `apps/electron/src/renderer/platform/__tests__/se-shell-parity-checklist.test.ts`.

## Remaining gaps (open)

| ID | Spec § | Gap | Owner hint |
|----|--------|-----|------------|
| G4 | Frame map / parity | Manual PNG QA vs reference frames still optional (`super-engineering-parity.md`) | QA on Mac |
| G5 | Product | Default SE ships with glass accents **off**; enabling by default would be a product change, not a Design polish PR | Product / New Bot |

## Non-goals (do not chase)

- Arc Glass Design / wallpaper-as-system / content-layer glass skins  
- Editing `GlassSurface.tsx` recipes owned by Rox Glass beyond shared SE accent skin  
- Liquid Glass for all users / intensity-scaled popover blur  
- Surface-agent territory (Messenger / Calls / Tasks / Home content) beyond shared tokens and shell
