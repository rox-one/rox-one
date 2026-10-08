/**
 * J19 (v2) Team with invites → placeholder → activation — journey stub (PLAN §5.1).
 *
 * Pending until the owning wave-2 package fills it in. The skip below is
 * the runner's pending mechanism: the journey exists, is listed, and
 * cannot pass vacuously.
 */
import { describe, test } from "bun:test";
import { createTwoUserHarness } from "../harness.ts";

describe.skip("J19 (v2) Team with invites → placeholder → activation", () => {
  test("journey flow (pending: owner wave-2 package)", async () => {
    const harness = createTwoUserHarness();
    await harness.alice.sendMessage(harness.workspace.dmChatId, "hello");
  });
});
