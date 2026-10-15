/**
 * Keeps the OpenUI Inspect devtools widget out of the ROX renderer.
 *
 * `@openuidev/react-lang`'s web entry (`dist/index.mjs`) runs a top-level side
 * effect that auto-mounts `@openuidev/devtools` whenever the consumer bundles
 * it with `process.env.NODE_ENV === "development"`. The mounted widget then
 * dynamically imports its browser bundle from `cdn.jsdelivr.net` at runtime and
 * — while its own popover is open — installs a **document-level, capture-phase**
 * `keydown` listener:
 *
 *     c.key === "Escape" && (c.stopPropagation(), c.preventDefault(), ...)
 *
 * That listener runs before anything else on the page, so the Escape key never
 * reaches the app's own dismissal paths: `PremiumMenu`'s search input
 * (`onKeyDown`) and `DismissibleLayerContext`'s window listener. In practice
 * Escape stopped closing menus, popovers and drawers in every development
 * bundle, and the product-tour browser fixtures (which bundle the renderer with
 * esbuild's default `NODE_ENV=development`) regressed with it.
 *
 * The widget is a browser debugging aid, its CDN fetch is unwanted inside the
 * Electron renderer, and the library already documents the auto-mount flag as a
 * de-duplication marker ("a manually mounted instance always wins over the
 * auto-mount — only one instance ever renders"). Claiming the flag before
 * `@openuidev/react-lang` is evaluated therefore skips the auto-mount, and the
 * import below must stay ahead of every `@openuidev/*` import so that the side
 * effect never runs first.
 */
const AUTO_MOUNT_FLAG = Symbol.for('openui.devtools.autoMount')
;(globalThis as unknown as Record<symbol, unknown>)[AUTO_MOUNT_FLAG] = true

export {}
