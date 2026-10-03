import { describe, expect, it } from "vitest";
import { errorPayload, isJsonModeArgv } from "./output.js";

describe("output helpers", () => {
  it("detects --json flag", () => {
    expect(isJsonModeArgv(["inbox", "--json"])).toBe(true);
    expect(isJsonModeArgv(["inbox"])).toBe(false);
  });

  it("returns stable error payload", () => {
    expect(errorPayload("boom")).toEqual({ ok: false, error: "boom" });
  });

  it("includes an optional code", () => {
    expect(errorPayload("boom", "BANG")).toEqual({
      ok: false,
      error: "boom",
      code: "BANG",
    });
  });
});
