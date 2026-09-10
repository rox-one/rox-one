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

export const PRELOAD_BUNDLE_EXTERNALS = ['electron'] as const

export const PRELOAD_BUNDLE_ALIAS: Record<string, string> = {
  '@anthropic-ai/claude-agent-sdk': CLAUDE_AGENT_SDK_PRELOAD_STUB,
}
