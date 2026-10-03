import { describe, expect, it, vi } from "vitest";
import {
  clearPeerTags,
  deleteAutomationRule,
  setAutomationRuleEnabled,
  unlinkPeerCompany,
} from "./crm.js";
import type { DbPool } from "./pool.js";

function mockPool(rowCount = 1) {
  const query = vi.fn().mockResolvedValue({ rowCount, rows: [] });
  return {
    pool: { query } as unknown as DbPool,
    query,
  };
}

describe("CRM cleanup helpers", () => {
  it("clears tags for only the scoped account and peer", async () => {
    const { pool, query } = mockPool(2);

    await expect(
      clearPeerTags(pool, { accountId: 10n, peerId: 123, peerKind: "user" })
    ).resolves.toBe(2);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM peer_tags"),
      ["10", "user", 123]
    );
    expect(query.mock.calls[0][0]).toContain(
      "WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3",
    );
  });

  it("unlinks company metadata for only the scoped account and peer", async () => {
    const { pool, query } = mockPool(1);

    await expect(
      unlinkPeerCompany(pool, {
        accountId: 10n,
        peerId: 123,
        peerKind: "channel",
      })
    ).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM peer_company"),
      ["10", "channel", 123]
    );
    expect(query.mock.calls[0][0]).toContain(
      "WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3",
    );
  });

  it("disables rules for only the scoped account and rule id", async () => {
    const { pool, query } = mockPool(1);

    await expect(
      setAutomationRuleEnabled(pool, {
        accountId: 10n,
        enabled: false,
        ruleId: 7,
      })
    ).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE automation_rules"),
      ["10", 7, false]
    );
    expect(query.mock.calls[0][0]).toContain("WHERE account_id = $1 AND rule_id = $2");
  });

  it("deletes rules for only the scoped account and rule id", async () => {
    const { pool, query } = mockPool(1);

    await expect(
      deleteAutomationRule(pool, { accountId: 10n, ruleId: 7 })
    ).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM automation_rules"),
      ["10", 7]
    );
    expect(query.mock.calls[0][0]).toContain("WHERE account_id = $1 AND rule_id = $2");
  });
});
