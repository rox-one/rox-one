import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../app/context.js";

const dependencies = vi.hoisted(() => ({
  listPersistedDialogs: vi.fn(),
  migrate: vi.fn(),
  requireAccountId: vi.fn(),
  printJson: vi.fn(),
}));

vi.mock("../db/inventory.js", () => ({
  listPersistedDialogs: dependencies.listPersistedDialogs,
}));
vi.mock("../db/migrate.js", () => ({ migrate: dependencies.migrate }));
vi.mock("../app/account.js", () => ({
  requireAccountId: dependencies.requireAccountId,
}));
vi.mock("../output.js", () => ({ printJson: dependencies.printJson }));

import { runCrm } from "./crm.js";

function context(): AppContext {
  return {
    config: {
      jsonOutput: true,
      accountLabel: "default",
      sessionPath: "/tmp/test.session",
      apiHash: "test-api-hash",
    },
    db: {},
  } as AppContext;
}

describe("persisted CRM dialog pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.migrate.mockResolvedValue(undefined);
    dependencies.requireAccountId.mockResolvedValue(1n);
    dependencies.listPersistedDialogs.mockResolvedValue({
      total: 2,
      lastSyncedAt: new Date("2026-08-20T00:00:00.000Z"),
      dialogs: [
        {
          peer: {
            id: "1",
            kind: "user",
            displayName: "Alice",
            username: null,
          },
          archived: false,
          pinned: false,
          unreadCount: 0,
          lastMessage: null,
        },
      ],
    });
  });

  it("rejects continuation after a newer inventory snapshot is committed", async () => {
    await runCrm(context(), ["dialogs", "list", "--page-size", "1"]);
    const firstPage = dependencies.printJson.mock.calls[0]?.[0];
    expect(firstPage).toMatchObject({ source: "chiho-crm", hasMore: true });
    expect(firstPage?.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor.length).toBeGreaterThan(0);

    dependencies.listPersistedDialogs.mockResolvedValueOnce({
      total: 2,
      lastSyncedAt: new Date("2026-08-20T00:01:00.000Z"),
      dialogs: [],
    });

    await expect(
      runCrm(context(), [
        "dialogs",
        "list",
        "--page-size",
        "1",
        "--cursor",
        firstPage.nextCursor,
      ]),
    ).rejects.toThrow("The cursor is invalid, expired, or belongs to another account.");
  });
});
