import { describe, expect, it, vi } from "vitest";
import {
  commitContactSnapshot,
  commitDialogInventoryPage,
  listPersistedDialogs,
  type TelegramSyncRun,
} from "./inventory.js";

function syncRun(overrides: Partial<TelegramSyncRun> = {}): TelegramSyncRun {
  return {
    runId: "run-1",
    accountId: 1n,
    mode: "full",
    includeArchived: true,
    status: "running",
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

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    ...syncRun(),
    accountId: "1",
    phase: "archived",
    cursorToken: "encrypted-next-cursor",
    fetchedCount: 1,
    persistedCount: 1,
    ...overrides,
  };
}

const dialog = {
  peer: {
    id: "123",
    kind: "user" as const,
    displayName: "Alice",
    username: "alice",
  },
  archived: false,
  pinned: false,
  unreadCount: 2,
  lastMessage: {
    id: 50,
    date: "2026-08-20T00:00:00.000Z",
    preview: "hello",
  },
};

describe("durable inventory transactions", () => {
  it("reads a CRM page and its snapshot version from one repeatable-read snapshot", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim());
        if (sql.includes("crm_dialog_persisted_count")) {
          return {
            rows: [
              {
                syncedTotal: 1,
                lastSyncedAt: new Date("2026-08-20T00:00:00.000Z"),
              },
            ],
          };
        }
        if (sql.includes("FROM telegram_dialog_index")) {
          return {
            rows: [
              {
                peerId: "123",
                peerKind: "user",
                displayName: "Alice",
                username: null,
                location: "active",
                pinned: false,
                unreadCount: 0,
                lastMessageId: null,
                lastMessageAt: null,
                lastMessagePreview: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as any;

    await expect(
      listPersistedDialogs(pool, { accountId: 1n, limit: 100, offset: 0 }),
    ).resolves.toMatchObject({
      total: 1,
      lastSyncedAt: new Date("2026-08-20T00:00:00.000Z"),
      dialogs: [{ peer: { id: "123", kind: "user" } }],
    });
    expect(queries[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(queries.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("commits dialog rows, canonical index, cursor, and counters atomically", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim());
        if (sql.includes("INSERT INTO peers")) return { rows: [{ peerId: "123" }] };
        if (sql.includes("SELECT COUNT(*)")) return { rows: [{ count: "1" }] };
        if (sql.includes("UPDATE telegram_sync_runs")) return { rows: [runRow()] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as any;

    const result = await commitDialogInventoryPage(pool, {
      run: syncRun(),
      phase: "active",
      dialogs: [dialog],
      nextPhase: "archived",
      nextCursorToken: "encrypted-next-cursor",
      activeAvailableCount: 420,
      archivedAvailableCount: 80,
    });

    expect(result).toMatchObject({
      phase: "archived",
      cursorToken: "encrypted-next-cursor",
      persistedCount: 1,
    });
    expect(queries).toEqual(expect.arrayContaining([
      "BEGIN",
      expect.stringContaining("ON CONFLICT (account_id, peer_kind, peer_id)"),
      expect.stringContaining("INSERT INTO telegram_dialog_index"),
      expect.stringContaining("UPDATE telegram_sync_runs"),
      "COMMIT",
    ]));
    expect(queries).not.toContain("ROLLBACK");
    expect(
      queries.some((sql) =>
        sql.includes("WHERE account_id = $1 AND sync_run_id = $2"),
      ),
    ).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back without advancing the cursor when any page write fails", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim());
        if (sql.includes("INSERT INTO peers")) return { rows: [{ peerId: "123" }] };
        if (sql.includes("INSERT INTO telegram_dialog_index")) {
          throw new Error("database unavailable");
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as any;

    await expect(
      commitDialogInventoryPage(pool, {
        run: syncRun(),
        phase: "active",
        dialogs: [dialog],
        nextPhase: "active",
        nextCursorToken: "must-not-commit",
        activeAvailableCount: 420,
        archivedAvailableCount: 80,
      }),
    ).rejects.toThrow("database unavailable");

    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(queries.some((sql) => sql.includes("UPDATE telegram_sync_runs"))).toBe(false);
  });

  it("keeps the previous contact generation active when snapshot refresh fails", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim());
        if (sql.includes("INSERT INTO telegram_inventory_state")) {
          throw new Error("generation switch failed");
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as any;

    await expect(
      commitContactSnapshot(pool, {
        run: syncRun({ phase: "contacts" }),
        contacts: [{ peerId: "1", displayName: "Alice", username: null }],
      }),
    ).rejects.toThrow("generation switch failed");

    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(queries.some((sql) => sql.startsWith("DELETE FROM telegram_contacts"))).toBe(false);
  });

  it("reconciles a completed full run into persisted and skipped totals", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim());
        if (sql.includes("UPDATE telegram_sync_runs")) {
          return {
            rows: [
              runRow({
                phase: "complete",
                status: "complete",
                persistedCount: 499,
                skippedCount: 1,
              }),
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as any;

    await expect(
      commitContactSnapshot(pool, {
        run: syncRun({
          activeAvailableCount: 420,
          archivedAvailableCount: 80,
          persistedCount: 499,
          phase: "contacts",
        }),
        contacts: [],
      }),
    ).resolves.toMatchObject({
      persistedCount: 499,
      skippedCount: 1,
      status: "complete",
    });
    expect(
      queries.some(
        (sql) =>
          sql.includes("skipped_count = GREATEST") &&
          sql.includes("CASE WHEN include_archived"),
      ),
    ).toBe(true);
    expect(queries).toContain("COMMIT");
  });
});
