import { describe, expect, it } from "vitest";
import { parseTagsSetArgs } from "./tags.js";

describe("parseTagsSetArgs", () => {
  it("does not treat --json as a tag", () => {
    expect(parseTagsSetArgs(["@alice", "Codex Smoke Test", "--json"])).toEqual({
      peer: "@alice",
      tags: ["Codex Smoke Test"],
    });
  });

  it("requires a peer and at least one tag", () => {
    expect(() => parseTagsSetArgs(["@alice", "--json"])).toThrow(
      "Usage: tgchats tags set"
    );
  });
});
