import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createSuccessfulRebuildGuard,
  detectInstanceNumber,
  parseElectronDevOptions,
  PLAYGROUND_VITE_STDIN,
  resolvePlaygroundHost,
  resolveVitePort,
  shouldOpenPlayground,
  shouldBuildRuntimeArtifact,
  shouldRemoveInvalidRuntimeArtifactOutput,
  removeInvalidRuntimeArtifactOutput,
  shouldStageElectronResources,
} from "./electron-dev-helpers";

describe("electron dev helpers", () => {
  test("parses explicit dev-runtime flags", () => {
    expect(parseElectronDevOptions(["--clean", "--full-runtime", "--replace-vite"])).toEqual({
      clean: true,
      fullRuntime: true,
      replaceVite: true,
    });
  });

  test("leaves Vite replacement disabled by default", () => {
    expect(parseElectronDevOptions([]).replaceVite).toBe(false);
  });

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
  });

  test("rejects invalid explicit ports instead of silently starting elsewhere", () => {
    expect(() => resolveVitePort({ ROX_VITE_PORT: "not-a-port" }, "/tmp/craft-agents"))
      .toThrow("ROX_VITE_PORT must be an integer between 1 and 65535");
  });

  test("suppresses the first watch callback, then restarts after a repaired build", () => {
    const shouldRestart = createSuccessfulRebuildGuard();
    expect(shouldRestart(1)).toBe(false);
    expect(shouldRestart(0)).toBe(true);
    expect(shouldRestart(1)).toBe(false);
    expect(shouldRestart(0)).toBe(true);
  });

  test("stages resources only when missing, newer, or explicitly refreshed", () => {
    const current = {
      sourceExists: true,
      outputExists: true,
      outputIsUsable: true,
      sourceLatestMtimeMs: 200,
      stagedSourceLatestMtimeMs: 200,
    };

    expect(shouldStageElectronResources({ ...current, force: false })).toBe(false);
    expect(shouldStageElectronResources({ ...current, force: true })).toBe(true);
    expect(shouldStageElectronResources({ ...current, outputExists: false, force: false })).toBe(true);
    expect(shouldStageElectronResources({ ...current, sourceLatestMtimeMs: 201, force: false })).toBe(true);
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

  test("builds runtime artifacts only when missing, stale, or forced", () => {
    const current = {
      sourceExists: true,
      outputExists: true,
      outputIsUsable: true,
      sourceLatestMtimeMs: 200,
      outputMtimeMs: 200,
    };

    expect(shouldBuildRuntimeArtifact({ ...current, force: false })).toBe(false);
    expect(shouldBuildRuntimeArtifact({ ...current, force: true })).toBe(true);
    expect(shouldBuildRuntimeArtifact({ ...current, outputExists: false, force: false })).toBe(true);
    expect(shouldBuildRuntimeArtifact({ ...current, outputIsUsable: false, force: false })).toBe(true);
    expect(shouldBuildRuntimeArtifact({ ...current, sourceLatestMtimeMs: 201, force: false })).toBe(true);
    expect(shouldBuildRuntimeArtifact({ ...current, sourceExists: false, force: true })).toBe(false);
  });

  test("removes only unusable generated runtime outputs before rebuilding", () => {
    expect(shouldRemoveInvalidRuntimeArtifactOutput({ outputPathExists: true, outputIsUsable: false })).toBe(true);
    expect(shouldRemoveInvalidRuntimeArtifactOutput({ outputPathExists: false, outputIsUsable: false })).toBe(false);
    expect(shouldRemoveInvalidRuntimeArtifactOutput({ outputPathExists: true, outputIsUsable: true })).toBe(false);
  });

  test("recovers a directory at a generated runtime artifact path without touching siblings", () => {
    const root = mkdtempSync(join(tmpdir(), "rox-runtime-artifact-"));
    const outputPath = join(root, "dist", "index.js");
    const siblingPath = join(root, "dist", "worker.cjs");
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(siblingPath, "sibling output");

    try {
      expect(removeInvalidRuntimeArtifactOutput(outputPath, {
        outputPathExists: true,
        outputIsUsable: false,
      })).toBe(true);
      expect(existsSync(outputPath)).toBe(false);
      expect(existsSync(siblingPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
