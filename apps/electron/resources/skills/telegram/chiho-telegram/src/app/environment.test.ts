import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getEnvironmentFileCandidates,
  loadEnvironment,
} from "./environment.js";

const testKey = "TGCHATS_ENV_DISCOVERY_TEST";
const originalValue = process.env[testKey];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalValue === undefined) {
    delete process.env[testKey];
  } else {
    process.env[testKey] = originalValue;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("local environment discovery", () => {
  it("keeps the linked package .env available from an installed plugin cache", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "tgchats-env-"));
    temporaryDirectories.push(fixtureRoot);
    const packageRoot = join(fixtureRoot, "linked-package");
    const pluginCache = join(fixtureRoot, "plugin-cache");
    await Promise.all([
      mkdir(packageRoot, { recursive: true }),
      mkdir(pluginCache, { recursive: true }),
    ]);
    await writeFile(join(packageRoot, ".env"), `${testKey}=loaded\n`);
    delete process.env[testKey];

    loadEnvironment({
      currentWorkingDirectory: pluginCache,
      environment: process.env,
      packageRoot,
      userHomeDirectory: join(fixtureRoot, "home"),
    });

    expect(process.env[testKey]).toBe("loaded");
  });

  it("supports an explicit env path before portable fallback locations", () => {
    expect(
      getEnvironmentFileCandidates({
        currentWorkingDirectory: "/plugin-cache",
        environment: {
          TGCHATS_ENV_PATH: "/configured/tgchats.env",
          XDG_CONFIG_HOME: "/xdg",
        },
        packageRoot: "/linked-package",
        userHomeDirectory: "/home/user",
      }),
    ).toEqual([
      "/configured/tgchats.env",
      "/plugin-cache/.env",
      "/linked-package/.env",
      "/xdg/telegram-for-ai-agents/.env",
    ]);
  });
});
