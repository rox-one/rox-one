import { describe, expect, it } from "vitest";
import { executeCliJson } from "./cli-runner.js";

describe("executeCliJson", () => {
  it("serializes parallel JSON commands and restores global console methods", async () => {
    const originalLog = console.log;
    const originalError = console.error;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => executeCliJson(["auth", "status"])),
    );

    for (const result of results) {
      expect(result).toMatchObject({ ok: true });
    }
    expect(console.log).toBe(originalLog);
    expect(console.error).toBe(originalError);
  });
});
