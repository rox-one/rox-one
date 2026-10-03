import { describe, expect, it } from "vitest";
import { createOpaqueCursorCodec } from "./opaqueCursor.js";

describe("opaque cursor codec", () => {
  it("round-trips state without exposing its contents", () => {
    const codec = createOpaqueCursorCodec("secret", () => 1_000);
    const cursor = codec.encode("dialogs", "account-a:all", {
      accessHash: "sensitive-access-hash",
      offset: 12,
    });

    expect(cursor).not.toContain("sensitive-access-hash");
    expect(codec.decode(cursor, "dialogs", "account-a:all")).toEqual({
      accessHash: "sensitive-access-hash",
      offset: 12,
    });
  });

  it("rejects cross-account and expired cursors", () => {
    let now = 1_000;
    const codec = createOpaqueCursorCodec("secret", () => now);
    const cursor = codec.encode("contacts", "account-a", { offset: 10 });

    expect(() => codec.decode(cursor, "contacts", "account-b")).toThrow(
      /invalid, expired, or belongs to another account/,
    );
    now += 24 * 60 * 60 * 1000 + 1;
    expect(() => codec.decode(cursor, "contacts", "account-a")).toThrow(
      /invalid, expired, or belongs to another account/,
    );
  });

  it("rejects tampered cursors", () => {
    const codec = createOpaqueCursorCodec("secret");
    const cursor = codec.encode("dialogs", "account-a:all", { offset: 10 });
    const replacement = cursor.endsWith("A") ? "B" : "A";

    expect(() =>
      codec.decode(`${cursor.slice(0, -1)}${replacement}`, "dialogs", "account-a:all"),
    ).toThrow(/invalid, expired, or belongs to another account/);
  });
});
