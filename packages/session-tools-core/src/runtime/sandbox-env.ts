/**
 * Shared environment sanitization for script-execution tools.
 *
 * The credential blocklist lives in `@craft-agent/core/env` so MCP stdio
 * spawn cannot drift from this sanitizer (inventory 6.4).
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BLOCKED_ENV_VAR_PREFIXES,
  BLOCKED_ENV_VARS,
  isBlockedEnvVar,
} from '@craft-agent/core/env';
import type { ScriptRuntimeLanguage } from './resolve-script-runtime.ts';

export { BLOCKED_ENV_VAR_PREFIXES, BLOCKED_ENV_VARS, isBlockedEnvVar };

/**
 * Return a shallow-copied environment with sensitive variables removed.
 */
export function createSanitizedEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (isBlockedEnvVar(key)) {
      delete env[key];
    }
  }
  return env;
}

export interface ScriptRuntimeEnvOptions {
  language: ScriptRuntimeLanguage;
  dataDir: string;
}

/**
 * Build a sanitized subprocess env with runtime-local cache/temp paths.
 *
 * For Python/uv, redirect caches away from home-directory defaults (e.g. ~/.cache/uv)
 * into the writable session data directory so sandboxed execution remains reliable.
 * For non-Python runtimes, host python/uv cache vars inherited from the parent
 * process are stripped: a host path like ~/cache/uv may lie outside the dirs a
 * sandboxed subprocess is allowed to touch, and is meaningless for node/bun.
 */
export function createScriptRuntimeEnv(
  options: ScriptRuntimeEnvOptions,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = createSanitizedEnv(baseEnv);
  const dataDir = resolve(options.dataDir);

  const tmpDir = join(dataDir, '.tmp');
  mkdirSync(tmpDir, { recursive: true });

  // Shared temp override (helps avoid host temp paths that may be blocked by FS isolation)
  env.TMPDIR = tmpDir;
  env.TMP = tmpDir;
  env.TEMP = tmpDir;

  if (options.language === 'python3') {
    const uvCacheDir = join(dataDir, '.uv-cache');
    const xdgCacheHome = join(dataDir, '.cache');
    const pythonPyCachePrefix = join(dataDir, '.pycache');

    mkdirSync(uvCacheDir, { recursive: true });
    mkdirSync(xdgCacheHome, { recursive: true });
    mkdirSync(pythonPyCachePrefix, { recursive: true });

    env.UV_CACHE_DIR = uvCacheDir;
    env.XDG_CACHE_HOME = xdgCacheHome;
    env.PYTHONPYCACHEPREFIX = pythonPyCachePrefix;
  } else {
    // Keep the subprocess env hermetic: never leak host python/uv cache paths
    // into non-python runtimes (they may point outside the session data dir).
    delete env.UV_CACHE_DIR;
    delete env.XDG_CACHE_HOME;
    delete env.PYTHONPYCACHEPREFIX;
  }

  return env;
}
