import { existsSync, rmSync } from "fs";
import { basename } from "path";

export interface ElectronDevOptions {
  clean: boolean;
  fullRuntime: boolean;
  replaceVite: boolean;
}

export function parseElectronDevOptions(args: readonly string[]): ElectronDevOptions {
  return {
    clean: args.includes("--clean"),
    fullRuntime: args.includes("--full-runtime"),
    replaceVite: args.includes("--replace-vite"),
  };
}

function normalizePort(value: string, source: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${source} must be an integer between 1 and 65535`);
  }

  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error(`${source} must be an integer between 1 and 65535`);
  }

  return String(port);
}

/**
 * Resolve the one port that both the Vite CLI and Electron must use.
 * Explicit environment always wins; the numbered-worktree convention remains
 * a compatibility fallback for sibling checkouts such as craft-agents-1.
 */
export function resolveVitePort(
  env: Record<string, string | undefined>,
  rootDir: string,
): string {
  if (env.ROX_VITE_PORT) return normalizePort(env.ROX_VITE_PORT, "ROX_VITE_PORT");
  if (env.CRAFT_VITE_PORT) return normalizePort(env.CRAFT_VITE_PORT, "CRAFT_VITE_PORT");
  if (env.VITE_PORT) return normalizePort(env.VITE_PORT, "VITE_PORT");

  const match = basename(rootDir).match(/-(\d+)$/);
  return match ? `${match[1]}173` : "5173";
}

export function detectInstanceNumber(rootDir: string): string | undefined {
  return basename(rootDir).match(/-(\d+)$/)?.[1];
}

/**
 * `esbuild.watch()` performs its own first build after a verified one-shot
 * build. Suppress that first watch callback regardless of its result: a
 * subsequent successful callback must restart Electron even if the initial
 * watch build hit a transient error.
 */
export function createSuccessfulRebuildGuard(): (errorCount: number) => boolean {
  let initialBuild = true;

  return (errorCount: number): boolean => {
    if (initialBuild) {
      initialBuild = false;
      return false;
    }
    return errorCount === 0;
  };
}

export interface ResourceStageDecisionInput {
  force: boolean;
  sourceExists: boolean;
  outputExists: boolean;
  sourceLatestMtimeMs: number;
  stagedSourceLatestMtimeMs: number | undefined;
}

/**
 * Keep resource staging cheap on the edit loop, but restage whenever output is
 * absent, an input is newer than the last successful stage, or the caller
 * explicitly asks for a clean/full runtime refresh.
 */
export function shouldStageElectronResources(input: ResourceStageDecisionInput): boolean {
  if (!input.sourceExists) return false;
  if (input.force || !input.outputExists) return true;
  if (input.stagedSourceLatestMtimeMs === undefined) return true;
  return input.sourceLatestMtimeMs > input.stagedSourceLatestMtimeMs;
}

/**
 * Keep the Playwright webServer endpoint on IPv4 loopback unless a developer
 * explicitly chooses a different Vite host for direct use.
 */
export function resolvePlaygroundHost(args: readonly string[]): string {
  const inlineHost = args.find((arg) => arg.startsWith("--host="));
  if (inlineHost) {
    const host = inlineHost.slice("--host=".length);
    if (!host) throw new Error("--host requires a non-empty value");
    return host;
  }

  const hostIndex = args.indexOf("--host");
  if (hostIndex === -1) return "127.0.0.1";

  const host = args[hostIndex + 1];
  if (!host || host.startsWith("-")) {
    throw new Error("--host requires a non-empty value");
  }
  return host;
}

export function shouldOpenPlayground(args: readonly string[]): boolean {
  return !args.includes("--no-open");
}

// Playwright closes the webServer command's stdin after spawning it. Vite must
// not inherit that pipe or it may stop between visual-test projects.
export const PLAYGROUND_VITE_STDIN = "ignore" as const;

export interface RuntimeArtifactDecisionInput {
  force: boolean;
  sourceExists: boolean;
  outputExists: boolean;
  outputIsUsable: boolean;
  sourceLatestMtimeMs: number;
  outputMtimeMs: number | undefined;
}

export function shouldBuildRuntimeArtifact(input: RuntimeArtifactDecisionInput): boolean {
  if (!input.sourceExists) return false;
  if (input.force || !input.outputExists || !input.outputIsUsable || input.outputMtimeMs === undefined) return true;
  return input.sourceLatestMtimeMs > input.outputMtimeMs;
}

/**
 * A generated artifact can be replaced in-place when it is a valid file, but
 * a directory or a corrupt file must be removed first for its builder to
 * recreate the expected output path.
 */
export function shouldRemoveInvalidRuntimeArtifactOutput(input: {
  outputPathExists: boolean;
  outputIsUsable: boolean;
}): boolean {
  return input.outputPathExists && !input.outputIsUsable;
}

/** Remove exactly one invalid generated artifact, leaving sibling outputs intact. */
export function removeInvalidRuntimeArtifactOutput(
  outputPath: string,
  input: { outputPathExists: boolean; outputIsUsable: boolean },
): boolean {
  if (!shouldRemoveInvalidRuntimeArtifactOutput(input)) return false;

  rmSync(outputPath, { recursive: true, force: true });
  return !existsSync(outputPath);
}
