/** Native prerequisite handoff before any local source/agent/MCP initialization. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathEnvKey, prependPath, readWindowsBootstrap, setWindowsBootstrapRuntime } from '@craft-agent/shared/toolchain';
import type { WindowsDependencyMode } from '@craft-agent/shared/toolchain';

export async function runNativeBootstrap(script: string, mode: WindowsDependencyMode, env: NodeJS.ProcessEnv): Promise<number> {
  const windows = env.SystemRoot ?? env.SYSTEMROOT;
  if (!windows) return 1;
  // Sysnative crosses WOW64 to the required 64-bit PowerShell, never WSL.
  const powershell = join(windows, process.arch === 'ia32' ? 'Sysnative' : 'System32',
    'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode],
      { env, timeout: 120_000, maxBuffer: 256 * 1024, windowsHide: true }, (error) => {
        resolve(!error ? 0 : typeof error.code === 'number' ? error.code : 1);
      });
  });
}

export async function initializeWindowsBootstrap(options: {
  isPackaged: boolean;
  resourcesPath: string;
  managedRoot: string;
  preference?: WindowsDependencyMode;
  /** User Git Bash selection always wins over the optional installer path. */
  gitBashPreference?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  read?: typeof readWindowsBootstrap;
  run?: typeof runNativeBootstrap;
}) {
  const env = options.env ?? process.env;
  if ((options.platform ?? process.platform) !== 'win32') return null;
  const key = pathEnvKey(env, true);
  const inheritedPath = env[key] ?? '';
  const excludedRoots = [options.resourcesPath, options.managedRoot];
  const read = options.read ?? readWindowsBootstrap;
  const readOptions = { platform: 'win32' as const, localAppData: env.LOCALAPPDATA,
    preference: options.preference, pathEnv: inheritedPath, excludedRoots };
  let runtime = await read(readOptions);
  // A damaged/missing receipt on a packaged install must not restore legacy
  // downloads or permit private bins to masquerade as system executables.
  if (!runtime && options.isPackaged) {
    readOptions.preference = options.preference ?? 'auto';
    runtime = await read(readOptions);
  }
  let recoveryCode: number | undefined;
  const script = join(options.resourcesPath, 'windows-bootstrap', 'bootstrap.ps1');
  if (options.isPackaged && (!runtime || runtime.missingTools.length > 0) && existsSync(script)) {
    // Only native offline provisioning. WSL consent is installer-only.
    recoveryCode = await (options.run ?? runNativeBootstrap)(script, runtime?.mode ?? options.preference ?? 'auto', env);
    runtime = await read(readOptions);
  }
  setWindowsBootstrapRuntime(runtime);
  if (runtime) {
    // Remove previously injected prerequisite bins, preserving all unrelated PATH,
    // managed tools and the separate vendored rg/Bun/uv locations.
    const next = prependPath({ ...env, [key]: await runtime.filterPath(inheritedPath) }, (await runtime.pathEntries()).join(';'), true);
    for (const name of Object.keys(env)) if (name.toUpperCase() === 'PATH') delete env[name];
    env[key] = next[key];
    if (!options.gitBashPreference && !env.CLAUDE_CODE_GIT_BASH_PATH) {
      const bash = await runtime.gitBashPath();
      if (bash) env.CLAUDE_CODE_GIT_BASH_PATH = bash;
    }
  }
  return runtime ? { mode: runtime.mode, receiptState: runtime.receiptState, missingTools: runtime.missingTools, recoveryCode }
    : { mode: options.preference ?? 'auto', receiptState: 'absent' as const, missingTools: ['gh', 'git', 'node', 'jq', 'yq'], recoveryCode };
}
