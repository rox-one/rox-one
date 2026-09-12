import { basename } from "path";

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
 * Keep the Playwright / playground endpoint on IPv4 loopback unless a
 * developer explicitly chooses a different Vite host.
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
