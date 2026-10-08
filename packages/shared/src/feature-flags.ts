/**
 * Feature flags for controlling experimental or in-development features.
 */

/** Safe accessor for process.env — returns undefined in browser/renderer contexts. */
function getEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/**
 * Shared runtime detector for development/debug environments.
 *
 * Use this instead of app-specific debug flags (e.g., Electron main isDebugMode)
 * so behavior stays consistent across shared code and subprocess backends.
 */
export function isDevRuntime(): boolean {
  const nodeEnv = (getEnv('NODE_ENV') || '').toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'dev' || getEnv('CRAFT_DEBUG') === '1';
}

/**
 * Runtime-evaluated check for developer feedback feature.
 * Explicit env override has precedence over dev-runtime defaults.
 */
export function isDeveloperFeedbackEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_DEVELOPER_FEEDBACK'));
  if (override !== undefined) return override;
  return isDevRuntime();
}

/**
 * Runtime-evaluated check for craft-agents-cli integration.
 *
 * Defaults to disabled. Override with CRAFT_FEATURE_CRAFT_AGENTS_CLI=1|0.
 */
export function isCraftAgentsCliEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_CRAFT_AGENTS_CLI'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Runtime-evaluated check for embedded server settings page.
 *
 * Defaults to disabled. Override with CRAFT_FEATURE_EMBEDDED_SERVER=1|0.
 */
export function isEmbeddedServerEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_EMBEDDED_SERVER'));
  if (override !== undefined) return override;
  return false;
}
/**
 * Runtime-evaluated check for the native Knowledge mode (SiYuan document surface).
 *
 * Defaults to enabled. Override with CRAFT_FEATURE_KNOWLEDGE=1|0.
 */
export function isKnowledgeFeatureEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_KNOWLEDGE'));
  if (override !== undefined) return override;
  return true;
}

/**
 * Runtime-evaluated check for the native craft-native sidecar (UDS + index).
 *
 * Defaults to disabled. Override with CRAFT_FEATURE_NATIVE_SIDECAR=1|0.
 */
export function isNativeSidecarEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_NATIVE_SIDECAR'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Rust writes session.jsonl (journal primary). Requires the sidecar flag.
 * Override with CRAFT_FEATURE_NATIVE_JOURNAL_PRIMARY=1|0.
 */
export function isNativeJournalPrimaryEnabled(): boolean {
  if (!isNativeSidecarEnabled()) return false;
  return parseBooleanEnv(getEnv('CRAFT_FEATURE_NATIVE_JOURNAL_PRIMARY')) === true;
}

/**
 * Rust source-index is primary (20k/256MB caps). Requires the sidecar flag.
 * Override with CRAFT_FEATURE_NATIVE_INDEX_PRIMARY=1|0.
 */
export function isNativeIndexPrimaryEnabled(): boolean {
  if (!isNativeSidecarEnabled()) return false;
  return parseBooleanEnv(getEnv('CRAFT_FEATURE_NATIVE_INDEX_PRIMARY')) === true;
}

/**
 * Watch local source folders and debounce-reindex.
 * Independent of the sidecar (TS facade still works). Default off.
 * Override with CRAFT_FEATURE_NATIVE_INDEX_WATCH=1|0.
 */
export function isNativeIndexWatchEnabled(): boolean {
  return parseBooleanEnv(getEnv('CRAFT_FEATURE_NATIVE_INDEX_WATCH')) === true;
}

/**
 * Workbench flag id for the entity links subsystem.
 * Mirrors `WORKBENCH_FLAG.entitiesLinksV1` in
 * `packages/core/src/platform/workbench/flags.ts` (kept as a literal here
 * so `@rox/shared` stays free of the platform import graph).
 */
export const ENTITIES_LINKS_WORKBENCH_FLAG = 'entities.links.v1';

/** Env key for the explicit `entities.links.v1` override. */
export const ENTITIES_LINKS_ENV_KEY = 'CRAFT_FEATURE_ENTITIES_LINKS';

/**
 * Explicit env override for `entities.links.v1`, if set to a known boolean.
 * Returns undefined in the context-isolated renderer (no `process`): the
 * renderer learns the effective state from main instead (see
 * `EntitiesLinksEffectiveState`).
 */
export function parseEntitiesLinksEnvOverride(env?: Record<string, string | undefined>): boolean | undefined {
  return parseBooleanEnv(env ? env[ENTITIES_LINKS_ENV_KEY] : getEnv(ENTITIES_LINKS_ENV_KEY));
}

export interface EntitiesLinksEffectiveState {
  /** Value all three hosts (main, renderer, server) must agree on. */
  enabled: boolean;
  /** Persisted user toggle (workbench flag), before the env override. */
  persisted: boolean;
  /** Explicit env override when `CRAFT_FEATURE_ENTITIES_LINKS` parses. */
  envOverride: boolean | undefined;
}

/**
 * Single effective-state computation shared by main (which publishes it over
 * IPC), the renderer (which consumes it for the route gate + Settings UI)
 * and tests. Precedence: explicit env override > persisted workbench flag.
 * Default OFF. Agrees with `isEntitiesLinksEnabled` by construction.
 */
export function resolveEntitiesLinksEffectiveState(
  persisted: boolean,
  envOverride: boolean | undefined = parseEntitiesLinksEnvOverride(),
): EntitiesLinksEffectiveState {
  if (envOverride !== undefined) return { enabled: envOverride, persisted, envOverride };
  return { enabled: persisted, persisted, envOverride: undefined };
}

/**
 * Runtime-evaluated check for the entity links subsystem (W1-02: link store,
 * resolver, `rox://` deep-link targets).
 *
 * Server-evaluated — same shape as `isPagesSharingEnabled`: the renderer gates
 * its UI on the `entities.links.v1` workbench flag and learns the server-side
 * state from the RPC responses. The user-toggleable workbench flag controls
 * the default; `CRAFT_FEATURE_ENTITIES_LINKS=1|0` remains as an explicit
 * env override. Defaults to DISABLED.
 *
 * Pass the enabled workbench flag set when the caller tracks it (server
 * handlers receive it via runtime; the renderer passes its atom state).
 * Without a set, only the env override applies (still default OFF).
 */
export function isEntitiesLinksEnabled(enabledWorkbenchFlags?: ReadonlySet<string>): boolean {
  const override = parseEntitiesLinksEnvOverride();
  if (override !== undefined) return override;
  if (enabledWorkbenchFlags?.has(ENTITIES_LINKS_WORKBENCH_FLAG)) return true;
  return false;
}

/**
 * Runtime-evaluated check for Pages sharing (Cloudflare publication).
 *
 * Server-evaluated: the renderer learns it via `pages:getShareCapabilities`,
 * never from its own process.env. Gates publish/update only — unpublish stays
 * available regardless, so disabling the flag never strands a published page.
 *
 * Defaults to ENABLED as of 2026-08-27 (the Cloudflare publication Worker is
 * deployed and verified live). Publishing sends the page bundle to Cloudflare,
 * so this is opt-out: set CRAFT_FEATURE_PAGES_SHARING=0 to hide the Share UI.
 */
export function isPagesSharingEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_PAGES_SHARING'));
  if (override !== undefined) return override;
  return true;
}

export const FEATURE_FLAGS = {
  /** Enable Opus 4.7 fast mode (speed:"fast" + beta header). 6x pricing. */
  fastMode: false,
  /**
   * Enable agent developer feedback tool.
   *
   * Defaults to enabled in explicit development runtimes; disabled otherwise.
   * Override with CRAFT_FEATURE_DEVELOPER_FEEDBACK=1|0.
   */
  get developerFeedback(): boolean {
    return isDeveloperFeedbackEnabled();
  },
  /**
   * Enable craft-agent CLI guidance and guardrails.
   *
   * Defaults to disabled. Override with CRAFT_FEATURE_CRAFT_AGENTS_CLI=1|0.
   */
  get craftAgentsCli(): boolean {
    return isCraftAgentsCliEnabled();
  },
  /**
   * Enable embedded server settings page.
   *
   * Defaults to disabled. Override with CRAFT_FEATURE_EMBEDDED_SERVER=1|0.
   */
  get embeddedServer(): boolean {
    return isEmbeddedServerEnabled();
  },
  /**
   * Enable native Knowledge mode (SiYuan as first-class Craft shell surface).
   *
   * Defaults to enabled. Override with CRAFT_FEATURE_KNOWLEDGE=1|0.
   */
  get knowledge(): boolean {
    return isKnowledgeFeatureEnabled();
  },
  /**
   * Enable the Rust craft-native sidecar (index shadow, journal, exec, rund).
   *
   * Defaults to disabled. Override with CRAFT_FEATURE_NATIVE_SIDECAR=1|0.
   */
  get nativeSidecar(): boolean {
    return isNativeSidecarEnabled();
  },
  /**
   * Enable Rust as the primary session.jsonl writer.
   * Requires CRAFT_FEATURE_NATIVE_SIDECAR=1.
   */
  get nativeJournalPrimary(): boolean {
    return isNativeJournalPrimaryEnabled();
  },
  /**
   * Enable Rust as the primary source index (lifted 20k/256MB caps).
   * Requires CRAFT_FEATURE_NATIVE_SIDECAR=1.
   */
  get nativeIndexPrimary(): boolean {
    return isNativeIndexPrimaryEnabled();
  },
  /**
   * Watch local source folders and debounce-reindex.
   * Defaults to disabled. Override with CRAFT_FEATURE_NATIVE_INDEX_WATCH=1|0.
   */
  get nativeIndexWatch(): boolean {
    return isNativeIndexWatchEnabled();
  },
  /**
   * Enable Pages sharing (publish to Cloudflare).
   *
   * Defaults to ENABLED (Worker deployed 2026-08-27). Opt out with
   * CRAFT_FEATURE_PAGES_SHARING=0.
   */
  get pagesSharing(): boolean {
    return isPagesSharingEnabled();
  },
} as const;
