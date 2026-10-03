import { beforeEach, describe, expect, it, vi } from "vitest";

const telegram = vi.hoisted(() => ({
  dialogInventoryKey: vi.fn((dialog: any) => dialog.key),
  fetchTelegramDialogFolderPage: vi.fn(),
  getTelegramDialogTotals: vi.fn(),
  mapDialogInventoryItem: vi.fn((dialog: any) => ({ key: dialog.key })),
}));

vi.mock("./telegram.js", () => telegram);

import { listTelegramDialogInventoryPage } from "./dialogInventory.js";

describe("listTelegramDialogInventoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telegram.getTelegramDialogTotals.mockResolvedValue({
      activeTotal: 420,
      archivedTotal: 80,
      allTotal: 500,
    });
  });

  it("keeps a 101-row Telegram slice distinct from the 500-row inventory total", async () => {
    const dialogs = Array.from({ length: 101 }, (_, index) => ({ key: `user:${index + 1}` }));
    telegram.fetchTelegramDialogFolderPage.mockResolvedValue({
      dialogs,
      total: 420,
      nextOffset: {
        date: 1_700_000_000,
        id: 101,
        peer: { kind: "user", id: "101", accessHash: "secret" },
      },
    });

    const page = await listTelegramDialogInventoryPage({} as any, {
      location: "all",
      pageSize: 100,
    });

    expect(page.inventoryTotal).toBe(500);
    expect(page.dialogs).toHaveLength(101);
    expect(page.nextState).toMatchObject({ phase: "active", seenActive: 101 });
  });

  it("continues from the supplied offset without repeating the boundary record", async () => {
    telegram.fetchTelegramDialogFolderPage.mockResolvedValue({
      dialogs: [{ key: "user:201" }, { key: "user:202" }],
      total: 420,
      nextOffset: {
        date: 1_699_000_000,
        id: 202,
        peer: { kind: "user", id: "202", accessHash: "secret" },
      },
    });
    const offset = {
      date: 1_700_000_000,
      id: 200,
      peer: { kind: "user" as const, id: "200", accessHash: "secret" },
    };

    const page = await listTelegramDialogInventoryPage({} as any, {
      location: "active",
      pageSize: 2,
      state: {
        phase: "active",
        offset,
        seenActive: 200,
        seenArchived: 0,
      },
    });

    expect(telegram.fetchTelegramDialogFolderPage).toHaveBeenCalledWith(
      expect.anything(),
      { location: "active", limit: 2, offset },
    );
    expect(page.dialogs).toEqual([{ key: "user:201" }, { key: "user:202" }]);
  });

  it("fills the remainder of an all-dialog page from archive after active is exhausted", async () => {
    telegram.getTelegramDialogTotals.mockResolvedValue({
      activeTotal: 2,
      archivedTotal: 3,
      allTotal: 5,
    });
    telegram.fetchTelegramDialogFolderPage
      .mockResolvedValueOnce({
        dialogs: [{ key: "user:1" }, { key: "user:2" }],
        total: 2,
        nextOffset: null,
      })
      .mockResolvedValueOnce({
        dialogs: [{ key: "channel:3" }, { key: "channel:4" }],
        total: 3,
        nextOffset: {
          date: 1,
          id: 4,
          peer: { kind: "channel", id: "4", accessHash: "secret" },
        },
      });

    const page = await listTelegramDialogInventoryPage({} as any, {
      location: "all",
      pageSize: 4,
    });

    expect(page.dialogs).toEqual([
      { key: "user:1" },
      { key: "user:2" },
      { key: "channel:3" },
      { key: "channel:4" },
    ]);
    expect(page.nextState).toMatchObject({
      phase: "archived",
      seenActive: 2,
      seenArchived: 2,
    });
  });
});
