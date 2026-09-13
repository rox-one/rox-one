# Zen Shell acceptance (ZS-08)

Release gate for #238–#244. Native macOS/Windows effects are **blocked** on the Linux cloud agent host, not passed. DOM screenshots are not evidence of outer shadow, true desktop blur, or WebContentsView occlusion.

## Baseline

| Field | Value |
|---|---|
| Epic | #237 |
| Flag | `shell.zen.v1` default **OFF**. OFF delegates to the existing window/material path. |
| Unified shell / workbench | `featureUnifiedShellAtom` and `featureWorkbenchAtom` stay default **OFF**. |
| Electron manifest | `^39.2.7` (not a lockfile/runtime pin) |
| This host | Linux cloud agent — no macOS vibrancy, no Windows mica, no WebContentsView |
| Fixture | Playground story `zen-shell-qa-fixture` (≥500 nested Russian sidebar rows, 2 opaque panels, draft + click/scroll counters) |
| Evidence | `docs/qa/zen-shell-evidence.json` |

## Requirement map

| ID | Owner | This host |
|---|---|---|
| ZS-R01 Native outer corners/shadow | #238 | **blocked** (no macOS window) |
| ZS-R02 Native controls | #238/#240 | **blocked** OS; source check **passed** (no HTML traffic lights) |
| ZS-R03 Material resolver | #238 | **passed** (unit) |
| ZS-R04 First paint | #238 | **passed** (source/unit) |
| ZS-R05 System a11y beats glass | #238 | **passed** (unit) |
| ZS-R06 Glass chrome / opaque content | #239 | **passed** (tokens) |
| ZS-R07 Geometry tokens | #239 | **passed** |
| ZS-R08 Hover/focus/selected | #239 | **passed** (tokens) |
| ZS-R09 Drag/no-drag safe area | #240 | **passed** (unit) |
| ZS-R10 History and menu | #240 | **passed** (source) |
| ZS-R11 Disclosure without text shift | #241 | **passed** |
| ZS-R12 Keyboard/ARIA/focus | #241 | **passed** |
| ZS-R13 Shared splitter | #242 | **passed** |
| ZS-R14 Commit/cancel/cleanup | #242 | **passed** (100 cancel cycles) |
| ZS-R15 Keyboard separator | #242 | **passed** |
| ZS-R16 min/max/infeasible | #242 | **passed** |
| ZS-R17 Commit-only persistence | #243 | **passed** |
| ZS-R18 Migration | #243 | **passed** |
| ZS-R19 Window isolation | #243 | **passed** |
| ZS-R20 Native suppression | #244 | unit **passed**; real occlusion **blocked** |
| ZS-R21 Native coordinates/zoom | #244 | contract **passed**; OS zoom/fullscreen **blocked** |
| ZS-R22 No remount/reload | #244 | VPS viewport isolation **passed**; live browser **blocked** |
| ZS-R23 Classic/workbench/platform | #246 | **passed** (flags OFF; Linux/web solid) |
| ZS-R24 Performance | #242/#246 | solveSplit budget **passed**; pointer→layout p95 **not_run** |
| ZS-R25 Reduced motion | #239/#241/#242 | **passed** (`transition: none`) |
| ZS-R26 i18n / contrast | #246 | i18n **passed**; painted contrast **not_run** |
| ZS-R27 Flag/rollback | #238/#243/#246 | **passed** (default OFF, no remote force-on) |
| ZS-R28 Evidence | #246 | this document + JSON |

## Matrix (host-honest)

| Group | Result |
|---|---|
| macOS window (launch, inactive, fullscreen, two windows, restart) | blocked |
| Material on a real desktop (wallpaper, theme switch, paint failure) | blocked; resolver unit passed |
| Input (mouse, keyboard, coarse, Escape, blur, cancel, unmount) | unit/source passed; GUI not_run |
| Size (800×600, web 375/767/768, zoom 100/125/150, 1×/2×) | token/safe-area unit passed; painted not_run |
| Shell (classic, workbench ON, navigator hidden, focus mode) | classic default OFF passed; workbench GUI not_run |
| State (workspace switch, corrupt storage, quota, panel removed) | adapter unit passed; two-window OS blocked |
| Native content (input/scroll, modal+resize, bounds after move) | contract passed; WebContentsView blocked |
| Other platforms | Linux/web solid passed; Windows mica OS blocked; build≥22000 unit passed |

## Commands

Recorded in `docs/qa/zen-shell-evidence.json` → `commands` on this Linux host:

| Command | Exit | Note |
|---|---:|---|
| `bun run typecheck:electron` | 2 | Baseline: ChatDisplay / CloudRuns JSX on main |
| `bun run webui:typecheck` | 2 | Same baseline parse errors |
| `bun run lint:electron` | 1 | Baseline 23 errors; zen-shell-qa files clean |
| `bun run lint:i18n:parity` | 0 | Passed (12 locales) |
| `bun run lint:i18n:coverage` | 1 | Baseline 71 missing keys on main |
| `bun run test:perf-budgets` | 0 | Passed |
| `bun run electron:build` | 1 | Baseline: vite cannot parse ChatDisplay.tsx |
| `bun run webui:build` | 1 | Same ChatDisplay parse error |
| `bun test` zen-shell modules | 0 | ZS-01–ZS-08 unit tests passed |

Targeted unit tests: `bun test` on zen-shell modules under `apps/electron` and `packages/ui/src/styles/__tests__/zen-shell-tokens.test.ts`. Existing full-suite failures are baseline, not hidden. Native GUI still **blocked** here.

## Rollout

- Toggle lives in Appearance → Zen Shell (`preferences.json`, main-owned).
- Do not remotely force `shell.zen.v1` ON.
- Rollback: set enabled false, restart; layout keys are not deleted.
- Black frame, broken input, lost state, or overlapping native view → keep the flag OFF.

## Fixture

Playground → Unified Shell → **Zen Shell QA fixture**. Stress data: `buildZenShellQaFixture()` in `apps/electron/src/renderer/lib/zen-shell-qa-fixture.ts`.
