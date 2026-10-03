import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../app/context.js";

const inventoryDb = vi.hoisted(() => ({
  commitContactSnapshot: vi.fn(),
  commitDialogInventoryPage: vi.fn(),
  getLatestSyncRun: vi.fn(),
  getOrCreateActiveSyncRun: vi.fn(),
  markSyncRunFailed: vi.fn(),
  markSyncRunRunning: vi.fn(),
  markSyncRunWaiting: vi.fn(),
}));
const migration = vi.hoisted(() => ({ migrate: vi.fn() }));
const account = vi.hoisted(() => ({ requireAccountId: vi.fn() }));
const telegram = vi.hoisted(() => ({
  ensureAuthorized: vi.fn(),
  fetchChatHistory: vi.fn(),
  fetchTelegramDialogFolderPage: vi.fn(),
  getTelegramContacts: vi.fn(),
  getTelegramDialogTotals: vi.fn(),
  listDialogs: vi.fn(),
  mapDialogInventoryItem: vi.fn(),
  mapTelegramContact: vi.fn(),
  telegramRateLimit: vi.fn(),
  withTelegramRateLimitBackoff: vi.fn(),
}));
const crm = vi.hoisted(() => ({
  getSyncCursor: vi.fn(),
  updateSyncCursor: vi.fn(),
}));
const writes = vi.hoisted(() => ({
  insertMessage: vi.fn(),
  upsertDialog: vi.fn(),
  upsertPeer: vi.fn(),
}));

vi.mock("../db/inventory.js", () => inventoryDb);
vi.mock("../db/migrate.js", () => migration);
vi.mock("../app/account.js", () => account);
vi.mock("../services/telegram.js", () => telegram);
vi.mock("../db/crm.js", () => crm);
vi.mock("../db/writes.js", () => writes);

import { runSync } from "./sync.js";

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    accountId: 1n,
    mode: "full",
    includeArchived: false,
    status: "queued",
    phase: "active",
    cursorToken: null,
    fetchedCount: 0,
    persistedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    activeAvailableCount: 0,
    archivedAvailableCount: 0,
    resumeAt: null,
    lastErrorCode: null,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    updatedAt: new Date("2026-08-20T00:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function context(options: { lockAcquired?: boolean } = {}): AppContext {
  const lockClient = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("pg_try_advisory_lock")
        ? [{ locked: options.lockAcquired !== false }]
        : [{ pg_advisory_unlock: true }],
    })),
    release: vi.fn(),
  };
  return {
    config: {
      jsonOutput: true,
      accountLabel: "default",
      sessionPath: "/tmp/test.session",
      apiHash: "test-api-hash",
    },
    db: { connect: vi.fn(async () => lockClient) },
    telegram: {},
  } as unknown as AppContext;
}

describe("durable sync.once", () => {
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, "log").mockImplementation((value: string) => logs.push(value));
    migration.migrate.mockResolvedValue(undefined);
    account.requireAccountId.mockResolvedValue(1n);
    inventoryDb.getLatestSyncRun.mockImplementation(async () =>
      inventoryDb.getOrCreateActiveSyncRun.mock.results.at(-1)?.value,
    );
    telegram.ensureAuthorized.mockResolvedValue(undefined);
    telegram.getTelegramDialogTotals.mockResolvedValue({
      activeTotal: 200,
      archivedTotal: 0,
      allTotal: 200,
    });
    telegram.mapDialogInventoryItem.mockReturnValue({
      peer: {
        id: "1",
        kind: "user",
        displayName: "One",
        username: null,
      },
      archived: false,
      pinned: false,
      unreadCount: 0,
      lastMessage: null,
    });
    telegram.telegramRateLimit.mockImplementation((error: any) =>
      error?.errorMessage === "FLOOD_WAIT_300"
        ? { code: "FLOOD_WAIT_300", waitMs: 300_000 }
        : null,
    );
  });

  it("keeps committed page progress and persists a resumable flood-wait", async () => {
    const initial = run();
    inventoryDb.getOrCreateActiveSyncRun.mockResolvedValue(initial);
    inventoryDb.markSyncRunRunning.mockResolvedValue(
      run({ status: "running" }),
    );
    telegram.fetchTelegramDialogFolderPage
      .mockResolvedValueOnce({
        dialogs: Array.from({ length: 100 }, () => ({})),
        total: 200,
        nextOffset: {
          date: 1_700_000_000,
          id: 100,
          peer: { kind: "user", id: "100", accessHash: "secret" },
        },
      })
      .mockRejectedValueOnce({ errorMessage: "FLOOD_WAIT_300" });
    inventoryDb.commitDialogInventoryPage.mockImplementation(
      async (_db: unknown, params: any) =>
        run({
          status: "running",
          phase: params.nextPhase,
          cursorToken: params.nextCursorToken,
          fetchedCount: 100,
          persistedCount: 100,
        }),
    );
    inventoryDb.markSyncRunWaiting.mockImplementation(
      async (_db: unknown, params: any) =>
        run({
          status: "waiting_for_telegram",
          cursorToken: "committed-encrypted-cursor",
          fetchedCount: 100,
          persistedCount: 100,
          resumeAt: params.resumeAt,
          lastErrorCode: params.errorCode,
        }),
    );

    await runSync(context(), [
      "once",
      "--mode",
      "full",
      "--exclude-archived",
    ]);

    expect(inventoryDb.commitDialogInventoryPage).toHaveBeenCalledTimes(1);
    expect(inventoryDb.markSyncRunWaiting).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-1",
        errorCode: "FLOOD_WAIT_300",
      }),
    );
    expect(JSON.parse(logs.at(-1) ?? "")).toMatchObject({
      ok: true,
      status: "waiting_for_telegram",
      fetchedCount: 100,
      persistedCount: 100,
      lastErrorCode: "FLOOD_WAIT_300",
    });
  });

  it("does not call Telegram again before a persisted resumeAt", async () => {
    inventoryDb.getOrCreateActiveSyncRun.mockResolvedValue(
      run({
        status: "waiting_for_telegram",
        resumeAt: new Date(Date.now() + 300_000),
        lastErrorCode: "FLOOD_WAIT_300",
      }),
    );

    await runSync(context(), ["once", "--mode", "full"]);

    expect(telegram.ensureAuthorized).not.toHaveBeenCalled();
    expect(telegram.getTelegramDialogTotals).not.toHaveBeenCalled();
    expect(inventoryDb.markSyncRunRunning).not.toHaveBeenCalled();
    expect(JSON.parse(logs.at(-1) ?? "")).toMatchObject({
      status: "waiting_for_telegram",
      lastErrorCode: "FLOOD_WAIT_300",
    });
  });

  it("returns the shared active run without starting a second local worker", async () => {
    inventoryDb.getOrCreateActiveSyncRun.mockResolvedValue(
      run({ status: "running" }),
    );

    await runSync(context({ lockAcquired: false }), ["once", "--mode", "full"]);

    expect(inventoryDb.markSyncRunRunning).not.toHaveBeenCalled();
    expect(telegram.ensureAuthorized).not.toHaveBeenCalled();
    expect(telegram.fetchTelegramDialogFolderPage).not.toHaveBeenCalled();
    expect(JSON.parse(logs.at(-1) ?? "")).toMatchObject({
      runId: "run-1",
      status: "running",
    });
  });

  it("does not revive a run completed while waiting to acquire the worker lock", async () => {
    inventoryDb.getOrCreateActiveSyncRun.mockResolvedValue(
      run({ status: "running" }),
    );
    inventoryDb.getLatestSyncRun.mockResolvedValueOnce(
      run({
        status: "complete",
        phase: "complete",
        completedAt: new Date("2026-08-20T00:01:00.000Z"),
      }),
    );

    await runSync(context(), ["once", "--mode", "full"]);

    expect(inventoryDb.markSyncRunRunning).not.toHaveBeenCalled();
    expect(telegram.ensureAuthorized).not.toHaveBeenCalled();
    expect(JSON.parse(logs.at(-1) ?? "")).toMatchObject({
      runId: "run-1",
      status: "complete",
      phase: "complete",
    });
  });

  it("resumes an existing durable run with its stored options", async () => {
    inventoryDb.getOrCreateActiveSyncRun.mockResolvedValue(
      run({ mode: "full", includeArchived: false }),
    );
    inventoryDb.markSyncRunRunning.mockResolvedValue(
      run({ mode: "full", includeArchived: false, status: "running" }),
    );
    telegram.fetchTelegramDialogFolderPage
      .mockResolvedValueOnce({
        dialogs: Array.from({ length: 100 }, () => ({})),
        total: 200,
        nextOffset: {
          date: 1_700_000_000,
          id: 100,
          peer: { kind: "user", id: "100", accessHash: "secret" },
        },
      })
      .mockRejectedValueOnce({ errorMessage: "FLOOD_WAIT_300" });
    inventoryDb.commitDialogInventoryPage.mockImplementation(
      async (_db: unknown, params: any) =>
        run({
          mode: "full",
          includeArchived: false,
          status: "running",
          phase: params.nextPhase,
          cursorToken: params.nextCursorToken,
          fetchedCount: 100,
          persistedCount: 100,
        }),
    );
    inventoryDb.markSyncRunWaiting.mockImplementation(
      async (_db: unknown, params: any) =>
        run({
          mode: "full",
          includeArchived: false,
          status: "waiting_for_telegram",
          cursorToken: "committed-encrypted-cursor",
          fetchedCount: 100,
          persistedCount: 100,
          resumeAt: params.resumeAt,
          lastErrorCode: params.errorCode,
        }),
    );

    await runSync(context(), [
      "once",
      "--mode",
      "recent",
      "--include-archived",
    ]);

    expect(inventoryDb.getOrCreateActiveSyncRun).toHaveBeenCalledWith(
      expect.anything(),
      { accountId: 1n, mode: "recent", includeArchived: true },
    );
    expect(telegram.fetchTelegramDialogFolderPage).toHaveBeenCalledTimes(2);
    expect(inventoryDb.commitDialogInventoryPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        nextPhase: "active",
        nextCursorToken: expect.any(String),
      }),
    );
    expect(inventoryDb.markSyncRunWaiting).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "FLOOD_WAIT_300" }),
    );
  });

  it("bounds recent sync to one page per requested folder and does not refresh contacts", async () => {
    inventoryDb.getOrCreateActiveSyncRun.mockResolvedValue(
      run({ mode: "recent", includeArchived: true }),
    );
    inventoryDb.markSyncRunRunning.mockResolvedValue(
      run({
        mode: "recent",
        includeArchived: true,
        status: "running",
      }),
    );
    telegram.getTelegramDialogTotals.mockResolvedValue({
      activeTotal: 420,
      archivedTotal: 80,
      allTotal: 500,
    });
    telegram.fetchTelegramDialogFolderPage
      .mockResolvedValueOnce({
        dialogs: [{}],
        total: 420,
        nextOffset: { date: 1, id: 1, peer: { kind: "user", id: "1" } },
      })
      .mockResolvedValueOnce({
        dialogs: [{}],
        total: 80,
        nextOffset: { date: 2, id: 2, peer: { kind: "channel", id: "2" } },
      });
    inventoryDb.commitDialogInventoryPage
      .mockImplementationOnce(async (_db: unknown, params: any) =>
        run({
          mode: "recent",
          includeArchived: true,
          status: "running",
          phase: params.nextPhase,
          fetchedCount: 1,
          persistedCount: 1,
        }),
      )
      .mockImplementationOnce(async (_db: unknown, params: any) =>
        run({
          mode: "recent",
          includeArchived: true,
          status: "complete",
          phase: params.nextPhase,
          fetchedCount: 2,
          persistedCount: 2,
          completedAt: new Date(),
        }),
      );

    await runSync(context(), ["once", "--mode", "recent", "--include-archived"]);

    expect(telegram.fetchTelegramDialogFolderPage).toHaveBeenCalledTimes(2);
    expect(inventoryDb.commitDialogInventoryPage.mock.calls[0][1]).toMatchObject({
      phase: "active",
      nextPhase: "archived",
    });
    expect(inventoryDb.commitDialogInventoryPage.mock.calls[1][1]).toMatchObject({
      phase: "archived",
      nextPhase: "complete",
    });
    expect(telegram.getTelegramContacts).not.toHaveBeenCalled();
    expect(inventoryDb.commitContactSnapshot).not.toHaveBeenCalled();
  });

  it("reads sync.status without authorizing or calling Telegram", async () => {
    inventoryDb.getLatestSyncRun.mockResolvedValue(
      run({ status: "complete", phase: "complete", completedAt: new Date() }),
    );

    await runSync(context(), ["status", "--run-id", "run-1"]);

    expect(inventoryDb.getLatestSyncRun).toHaveBeenCalledWith(expect.anything(), {
      accountId: 1n,
      runId: "run-1",
    });
    expect(telegram.ensureAuthorized).not.toHaveBeenCalled();
    expect(JSON.parse(logs.at(-1) ?? "")).toMatchObject({
      runId: "run-1",
      status: "complete",
    });
  });
});
