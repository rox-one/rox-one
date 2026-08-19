import { getRuntimeEnvOverrides as defaultGetRuntimeEnvOverrides } from '@craft-agent/shared/config'
import { refreshRuntimeSecretEnv as defaultRefreshRuntimeSecretEnv } from '@craft-agent/shared/secrets'

export interface ComposeSpawnEnvInput {
  workspaceRootPath: string
  miniModel?: string
}

export interface ComposeSpawnEnvDeps {
  refreshRuntimeSecretEnv?: () => Promise<unknown>
  getRuntimeEnvOverrides?: () => Record<string, string>
}

/**
 * Spawn-time env composition used by SessionManager when creating a backend.
 *
 * Refreshes the in-memory secret fragment, then merges persisted
 * `runtime.envOverrides` + that fragment (via getRuntimeEnvOverrides), then
 * overlays per-session structural keys which always win.
 */
export async function composeSpawnEnv(
  input: ComposeSpawnEnvInput,
  deps: ComposeSpawnEnvDeps = {},
): Promise<Record<string, string>> {
  const refresh = deps.refreshRuntimeSecretEnv ?? defaultRefreshRuntimeSecretEnv
  const getOverrides = deps.getRuntimeEnvOverrides ?? defaultGetRuntimeEnvOverrides

  // Resolve configured secret refs (runtime.secretRefs) into the in-memory
  // fragment that getRuntimeEnvOverrides() merges — every backend spawning
  // from here inherits the values via subprocess env. Never throws.
  await refresh()

  return {
    // User-configured session env (config runtime.envOverrides); the
    // structural keys below (workspace path, mini model) always win.
    ...getOverrides(),
    CRAFT_WORKSPACE_PATH: input.workspaceRootPath,
    // Pass mini model to SDK subprocess so built-in tools like WebFetch
    // use the correct model for summarization (instead of hardcoded Haiku)
    ...(input.miniModel ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: input.miniModel } : {}),
  }
}
