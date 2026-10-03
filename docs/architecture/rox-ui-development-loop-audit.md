# ROX UI development loop audit

## Scope and baseline

This audit compares the supplied ROX UI development-loop architecture brief
with the live `origin/main` baseline at `d6f343c`.

The implementation in this branch deliberately changes only behaviour that has
a concrete target in the checkout. It does not claim that an absent visual
authoring runtime, its IPC bridge, or a sidecar protocol exists.

## Audit result

| Brief area | Live baseline | Result in this branch |
| --- | --- | --- |
| Renderer HMR | Vite already serves the Electron renderer and Playground. | Retained; `dev:ui` makes the UI-only path explicit. |
| Main and preload iteration | esbuild watched files but Electron continued running old bundles. | A persistent supervisor restarts Electron after a successful, debounced main, preload, toolbar-preload, or extension-worker rebuild. |
| Cold-start work | Vite cache, resources, and optional workers were prepared unconditionally. | `--clean` controls Vite cache removal; staged resources are reused until inputs change; missing, stale, or invalid Pi/messaging bundles rebuild on demand; `--full-runtime` forces their preparation. |
| Parallel worktrees | The conventional numbered instance existed, but default launchers could kill another Vite process. | One port resolver supports explicit `ROX_VITE_PORT`/`CRAFT_VITE_PORT`/`VITE_PORT`; port replacement requires `--replace-vite`; the Playground launcher never kills a port owner. |
| Component explorer | Playground used real components, mocks, and manual registry imports. | File-discovered `*.playground.tsx` stories coexist with legacy entries, with level, viewport, and appearance metadata. |
| UI taxonomy | Existing categories were feature-oriented. | Tokens, Primitives, Patterns, Screens, and Flows are first-class Playground levels; legacy entries normalize to Patterns during migration. |
| Theme live updates | `App` observed app overrides separately from the provider that owns DOM CSS variables. | `ThemeProvider` now owns app override resolution and live updates, including default-preset CSS injection. |
| Visual regression | No deterministic browser baseline existed. | Playwright config and a light/dark × desktop/tablet/mobile production-screen screenshot matrix are provided and run in CI after Playwright Chromium installation. |
| Design Manifest Compiler | No Rox Design runtime or manifest contract existed in the checkout. | A pure shared v1 compiler validates JSON-only grid manifests against a caller-owned component allowlist. |
| Rox Design embedding and bridge | No `rox-design` payload, HostBridge, EmbedReceiver, or Open Design runtime is vendored by this checkout. | Not implemented here: the separately hosted Open Design service is not an Electron runtime dependency. The manifest compiler is the bounded prerequisite for a later, explicitly integrated bridge. |
| Sidecar reconnect protocol | No concrete sidecar client/server protocol exposes reconnect, version, or snapshot operations. | Not implemented: adding one would invent a transport contract outside the live codebase; current dev work only rebuilds/restarts concrete Electron bundles. |

## Development modes

```text
dev:ui   → Vite Playground only
dev:app  → Vite + Electron supervisor
dev:full → dev:app plus optional Pi and messaging runtime preparation
```

Renderer edits use Vite HMR. Changes to Electron main, either preload bundle,
or the extension-host worker coalesce into one restart after a successful
rebuild. The Vite process and esbuild watch contexts outlive that child restart.

## Playground story contract

New stories may live beside their production components anywhere below
`apps/electron/src/renderer/` and use the `*.playground.tsx` suffix. Each
story exports a production component reference, not a copied implementation.
The loader accepts one entry, an entry array, or a grouped `stories` export,
while the old registry remains a compatibility layer.

Story metadata records a design-system level, optional named viewport, and
appearance constraints. A declared viewport applies automatically on selection;
a declared theme or mode uses preview-only state and never persists or
broadcasts a user's app preference. Duplicate story IDs fail fast during
registry normalization.

## Theme ownership

The effective colour precedence remains:

```text
preview preset → workspace preset → app/default preset → app theme overrides
```

The final app override is merged by `ThemeProvider`, which is also the only
place that computes CSS variables, scene mode, darkness, and Shiki selection.
This prevents a `theme.json` update from changing a hook result while leaving
the rendered DOM unchanged. A live app-theme event wins over a stale bootstrap
read, and preview mode never writes preferences or IPC-broadcasts.

## Design manifest boundary

`@craft-agent/shared/design-manifest` accepts only versioned serializable data:
grid coordinates, IDs, JSON-safe props, an allowlisted component type, and an
allowlisted theme preset. It rejects arbitrary JSX, functions, accessors,
prototype-polluting keys, duplicates, unknown themes, and out-of-grid modules.
Persistence and code generation are intentionally outside this pure compiler.

## Verification commands

```bash
bun test scripts/electron-dev-helpers.test.ts
bun test apps/electron/src/renderer/context/__tests__/theme-app-overrides-wiring.test.ts
bun test apps/electron/src/renderer/playground/__tests__/story-loader.test.ts
bun test packages/shared/src/design-manifest/compiler.test.ts
bun run typecheck:electron
bun run test:visual
```

Screenshot snapshots should be created once with Playwright's
`--update-snapshots` and then rerun unchanged. The browser environment must use
the repository's complete native dependency tree; a partial worktree
`node_modules` is not valid visual-test evidence.

The workflow installs Playwright Chromium before visual checks. Local runs use
the installed Chrome channel for faster macOS review; CI uses the pinned
Playwright browser so baselines stay reproducible.
