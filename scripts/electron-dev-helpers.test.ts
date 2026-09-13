import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  detectInstanceNumber,
  PLAYGROUND_VITE_STDIN,
  resolvePlaygroundHost,
  resolveVitePort,
  shouldOpenPlayground,
} from "./electron-dev-helpers";

describe("electron dev helpers", () => {
  test("prefers the ROX port, then the Craft compatibility port, then Vite", () => {
    expect(resolveVitePort({ ROX_VITE_PORT: "5123", CRAFT_VITE_PORT: "6123", VITE_PORT: "7123" }, "/tmp/craft-agents-9"))
      .toBe("5123");
    expect(resolveVitePort({ CRAFT_VITE_PORT: "6123", VITE_PORT: "7123" }, "/tmp/craft-agents-9"))
      .toBe("6123");
  });

  test("uses VITE_PORT before the numbered-worktree fallback", () => {
    expect(resolveVitePort({ VITE_PORT: "7123" }, "/tmp/craft-agents-9")).toBe("7123");
  });

  test("preserves the numbered-worktree port convention", () => {
    expect(detectInstanceNumber("/tmp/craft-agents-9")).toBe("9");
    expect(resolveVitePort({}, "/tmp/craft-agents-9")).toBe("9173");
    expect(resolveVitePort({}, "/tmp/rox-one")).toBe("5173");
  });

  test("ignores branch-id suffixes that would overflow the TCP port range", () => {
    expect(detectInstanceNumber("/tmp/visual-qa-polish-1771")).toBe("1771");
    expect(resolveVitePort({}, "/tmp/visual-qa-polish-1771")).toBe("5173");
    expect(resolveVitePort({}, "/tmp/cursor/rox-issue05-heatmap-1771")).toBe("5173");
  });

  test("rejects invalid explicit ports instead of silently starting elsewhere", () => {
    expect(() => resolveVitePort({ ROX_VITE_PORT: "not-a-port" }, "/tmp/craft-agents"))
      .toThrow("ROX_VITE_PORT must be an integer between 1 and 65535");
  });

  test("uses IPv4 loopback for Playwright unless a developer overrides the host", () => {
    expect(resolvePlaygroundHost([])).toBe("127.0.0.1");
    expect(resolvePlaygroundHost(["--host", "0.0.0.0"])).toBe("0.0.0.0");
    expect(resolvePlaygroundHost(["--host=localhost"])).toBe("localhost");
    expect(() => resolvePlaygroundHost(["--host"])).toThrow("--host requires a non-empty value");
  });

  test("opens the playground for direct use unless explicitly suppressed", () => {
    expect(shouldOpenPlayground([])).toBe(true);
    expect(shouldOpenPlayground(["--no-open"])).toBe(false);
  });

  test("keeps the Vite child independent from Playwright webServer stdin", () => {
    expect(PLAYGROUND_VITE_STDIN).toBe("ignore");
  });

  test("playground:dev uses the worktree-safe launcher instead of killing port 5173", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["playground:dev"]).toBe("bun run scripts/playground-dev.ts");
    expect(pkg.scripts["playground:dev"]).not.toContain("kill");
  });
});
