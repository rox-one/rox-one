import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../app/context.js";

const printJson = vi.hoisted(() => vi.fn());
vi.mock("../output.js", () => ({ printJson }));

const telegram = vi.hoisted(() => ({
  ensureAuthorized: vi.fn(),
  getTelegramContacts: vi.fn(),
  mapTelegramContact: vi.fn((user: any) => ({
    peerId: String(user.id),
    displayName: user.displayName,
    username: user.username,
  })),
}));

vi.mock("../services/telegram.js", () => telegram);

import { runContacts } from "./contacts.js";

function context(): AppContext {
  return {
    config: {
      jsonOutput: true,
      accountLabel: "default",
      sessionPath: "/tmp/test.session",
      apiHash: "test-api-hash",
    },
    telegram: {},
  } as AppContext;
}

describe("Telegram contact commands", () => {
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    printJson.mockImplementation((value: unknown) => logs.push(JSON.stringify(value)));
    telegram.ensureAuthorized.mockResolvedValue(undefined);
    telegram.getTelegramContacts.mockResolvedValue(
      Array.from({ length: 913 }, (_, index) => ({
        id: index + 1,
        displayName: `Contact ${String(index + 1).padStart(3, "0")}`,
        username: null,
        phoneNumber: `+1${index}`,
      })),
    );
  });

  it("reports all 913 Telegram contacts independently of any dialog count", async () => {
    await runContacts(context(), ["count"]);

    expect(JSON.parse(logs.at(-1) ?? "")).toMatchObject({
      ok: true,
      source: "telegram-contacts",
      contactTotal: 913,
    });
  });

  it("paginates contacts while preserving the complete total and privacy boundary", async () => {
    await runContacts(context(), ["list", "--page-size", "29"]);

    const payload = JSON.parse(logs.at(-1) ?? "");
    expect(payload).toMatchObject({
      contactTotal: 913,
      hasMore: true,
    });
    expect(payload.contacts).toHaveLength(29);
    expect(payload.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(payload)).not.toContain("phoneNumber");
  });

  it("rejects continuation after the Telegram contact snapshot changes", async () => {
    await runContacts(context(), ["list", "--page-size", "29"]);
    const firstPage = JSON.parse(logs.at(-1) ?? "");
    expect(firstPage).toMatchObject({ contactTotal: 913, hasMore: true, nextCursor: expect.any(String) });

    telegram.getTelegramContacts.mockResolvedValueOnce(
      Array.from({ length: 912 }, (_, index) => ({
        id: index + 2,
        displayName: `Contact ${String(index + 2).padStart(3, "0")}`,
        username: null,
        phoneNumber: `+1${index + 2}`,
      })),
    );

    await expect(
      runContacts(context(), [
        "list",
        "--page-size",
        "29",
        "--cursor",
        firstPage.nextCursor,
      ]),
    ).rejects.toThrow("The cursor is invalid, expired, or belongs to another account.");
  });
});
