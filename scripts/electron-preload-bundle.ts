import { join } from 'path'

/**
 * Preload is a renderer-side CJS bundle. The Claude Agent SDK is pure ESM and
 * calls `createRequire(import.meta.url)` at module init; esbuild's CJS output
 * leaves `import.meta.url` empty, which throws ERR_INVALID_ARG_VALUE and
 * prevents `window.electronAPI` from being installed.
 *
 * Alias to the same inert stub the Vite renderer uses. Do not bundle or
 * `require()` the real SDK in preload.
 */
export const CLAUDE_AGENT_SDK_PRELOAD_STUB = join(
  import.meta.dir,
  '..',
  'apps/electron/src/renderer/shims/claude-agent-sdk-stub.ts',
)

/** Shared inert stub for SDKs that must never evaluate inside preload. */
export const PRELOAD_HEAVY_DEP_STUB = join(
  import.meta.dir,
  '..',
  'apps/electron/src/renderer/shims/preload-heavy-dep-stub.ts',
)

export const PRELOAD_BUNDLE_EXTERNALS = ['electron'] as const

/**
 * Packages that only exist for agent/tool runtimes. Preload reaches them today
 * only through accidental barrel imports (`@rox/shared/config` → models-pi /
 * session-tools → mermaid). Alias them so a regression cannot ship a multi-MB
 * bootstrap-preload.cjs again.
 */
export const PRELOAD_HEAVY_DEP_ALIASES: Record<string, string> = {
  '@earendil-works/pi-ai': PRELOAD_HEAVY_DEP_STUB,
  '@google/genai': PRELOAD_HEAVY_DEP_STUB,
  'beautiful-mermaid': PRELOAD_HEAVY_DEP_STUB,
  elkjs: PRELOAD_HEAVY_DEP_STUB,
}

export const PRELOAD_BUNDLE_ALIAS: Record<string, string> = {
  '@anthropic-ai/claude-agent-sdk': CLAUDE_AGENT_SDK_PRELOAD_STUB,
  ...PRELOAD_HEAVY_DEP_ALIASES,
}
