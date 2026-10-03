import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./schema.js";

describe("kind-aware peer identity migration", () => {
  it("recovers mtcute-marked channel IDs before migrating child identities", () => {
    const migration = MIGRATIONS.find(
      (candidate) => candidate.id === "005_kind_aware_peer_identity",
    );
    expect(migration).toBeDefined();

    const channelRecovery = migration!.sql.indexOf(
      "WHERE peer_kind = 'chat' AND peer_id < -1000000000000",
    );
    const childMigration = migration!.sql.indexOf("UPDATE dialogs child");
    expect(channelRecovery).toBeGreaterThanOrEqual(0);
    expect(childMigration).toBeGreaterThan(channelRecovery);
  });
});
