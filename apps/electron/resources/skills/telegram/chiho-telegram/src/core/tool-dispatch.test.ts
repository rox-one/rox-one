import { afterEach, describe, expect, it } from "vitest";
import { buildToolCommandArgs } from "./tool-dispatch.js";

describe("buildToolCommandArgs", () => {
  const originalAccountLabel = process.env.TELEGRAM_ACCOUNT_LABEL;

  afterEach(() => {
    if (originalAccountLabel === undefined) {
      delete process.env.TELEGRAM_ACCOUNT_LABEL;
    } else {
      process.env.TELEGRAM_ACCOUNT_LABEL = originalAccountLabel;
    }
  });

  it("maps dialogs.list to inbox args", () => {
    expect(buildToolCommandArgs("dialogs.list", {
      location: "archived",
      pageSize: 15,
      cursor: "next-page",
    })).toEqual([
      "inbox",
      "--location",
      "archived",
      "--page-size",
      "15",
      "--cursor",
      "next-page",
    ]);
  });

  it("maps semantic inventory, contact, CRM, and durable sync tools", () => {
    expect(buildToolCommandArgs("inventory.summary", {})).toEqual([
      "inventory",
      "summary",
    ]);
    expect(buildToolCommandArgs("contacts.count", {})).toEqual([
      "contacts",
      "count",
    ]);
    expect(buildToolCommandArgs("contacts.list", { pageSize: 25 })).toEqual([
      "contacts",
      "list",
      "--page-size",
      "25",
    ]);
    expect(buildToolCommandArgs("crm.dialogs.list", { pageSize: 30 })).toEqual([
      "crm",
      "dialogs",
      "list",
      "--page-size",
      "30",
    ]);
    expect(buildToolCommandArgs("sync.once", {
      mode: "full",
      includeArchived: false,
    })).toEqual([
      "sync",
      "once",
      "--mode",
      "full",
      "--exclude-archived",
    ]);
    expect(buildToolCommandArgs("sync.status", { runId: "run-1" })).toEqual([
      "sync",
      "status",
      "--run-id",
      "run-1",
    ]);
  });

  it("maps lossless chat history cursors to chat args", () => {
    expect(
      buildToolCommandArgs("chat.read", {
        peer: "123",
        limit: 200,
        sinceMessageId: 400,
        offsetDate: 1_700_000_000,
        offsetMessageId: 456,
      })
    ).toEqual([
      "chat",
      "123",
      "--limit",
      "200",
      "--since",
      "400",
      "--offset-date",
      "1700000000",
      "--offset-message-id",
      "456",
    ]);
  });

  it("rejects chat history cursors outside Telegram's integer range", () => {
    for (const field of ["sinceMessageId", "offsetDate", "offsetMessageId"]) {
      expect(() =>
        buildToolCommandArgs("chat.read", {
          peer: "123",
          [field]: 2_147_483_648,
        })
      ).toThrow("must be at most 2147483647");
    }
  });

  it("maps folders.update order to folders order", () => {
    expect(
      buildToolCommandArgs("folders.update", {
        action: "create",
        title: "Leads",
        peer: "@alice",
      })
    ).toEqual(["folders", "create", "--title", "Leads", "--peer", "@alice"]);

    expect(
      buildToolCommandArgs("folders.update", {
        action: "order",
        folderIds: ["1", "2", "3"],
      })
    ).toEqual(["folders", "order", "1", "2", "3"]);
  });

  it("requires an initial peer for folders.update create", () => {
    expect(() =>
      buildToolCommandArgs("folders.update", {
        action: "create",
        title: "Leads",
      })
    ).toThrow("peer is required");
  });

  it("maps PR 9 folder tools to folder commands", () => {
    expect(
      buildToolCommandArgs("folders.create", {
        title: "Leads",
        peer: "@alice",
        idempotencyKey: "folder-1",
      })
    ).toEqual([
      "folders",
      "create",
      "--title",
      "Leads",
      "--peer",
      "@alice",
      "--idempotency-key",
      "folder-1",
    ]);

    expect(
      buildToolCommandArgs("folders.addDialog", {
        folderId: "7",
        peer: "@alice",
      })
    ).toEqual(["folders", "add", "7", "@alice"]);
  });

  it("maps payload write tools to payload commands without accountId", () => {
    process.env.TELEGRAM_ACCOUNT_LABEL = "default";
    const cases: Array<{
      toolName: string;
      input: Record<string, unknown>;
      expectedPrefix: string[];
      expectedPayload: Record<string, unknown>;
    }> = [
      {
        toolName: "outbox.preview",
        input: { accountId: "default", peers: ["@alice"], text: "Hello" },
        expectedPrefix: ["outbox", "preview"],
        expectedPayload: { peers: ["@alice"], text: "Hello" },
      },
      {
        toolName: "message.sendDraft",
        input: { accountId: "default", peer: "@alice", text: "Hello" },
        expectedPrefix: ["message", "send-draft"],
        expectedPayload: { peer: "@alice", text: "Hello" },
      },
      {
        toolName: "members.invitePreview",
        input: { accountId: "default", userId: "123", groups: ["@group"] },
        expectedPrefix: ["members", "invite-preview"],
        expectedPayload: { userId: "123", groups: ["@group"] },
      },
      {
        toolName: "groups.leavePreview",
        input: { accountId: "default", groups: ["@group"] },
        expectedPrefix: ["groups", "leave-preview"],
        expectedPayload: { groups: ["@group"] },
      },
    ];

    for (const { toolName, input, expectedPrefix, expectedPayload } of cases) {
      expect(buildToolCommandArgs(toolName, input)).toEqual([
        ...expectedPrefix,
        "--payload",
        JSON.stringify(expectedPayload),
      ]);
    }
  });

  it("maps Telegram client reads and previews to JSON-first commands", () => {
    process.env.TELEGRAM_ACCOUNT_LABEL = "default";
    const cases = [
      ["message.get", ["message", "get"], { peer: "@alice", messageId: 12 }],
      ["thread.read", ["thread", "read"], { peer: "@group", messageId: 9 }],
      ["scheduled.list", ["scheduled", "list"], { peer: "@alice" }],
      ["media.info", ["media", "info"], { peer: "@alice", messageId: 12 }],
      ["media.download", ["media", "download"], { peer: "@alice", messageId: 12 }],
      ["members.list", ["members", "list"], { peer: "@group" }],
      ["attention.list", ["attention", "list"], { peers: ["@alice"] }],
      ["drafts.list", ["drafts", "list"], { peers: ["@alice"] }],
      ["draft.save", ["draft", "save"], { peer: "@alice", text: "reply later" }],
      ["forumTopics.list", ["forum-topics", "list"], { peer: "@group" }],
      ["joinRequests.list", ["join-requests", "list"], { peer: "@group" }],
      ["inviteLinks.list", ["invite-links", "list"], { peer: "@group" }],
      ["inviteLinkMembers.list", ["invite-link-members", "list"], { peer: "@group", link: "https://t.me/+code" }],
      ["chat.adminLog", ["chat-admin-log", "list"], { peer: "@group" }],
      ["person.contextGet", ["person-context", "get"], { peer: "@alice" }],
      ["updates.poll", ["updates", "poll"], { limit: 25 }],
      [
        "message.actionPreview",
        ["message", "action-preview"],
        { action: "reaction", peer: "@alice", messageId: 12, emoji: "👍" },
      ],
      [
        "media.sendPreview",
        ["media", "send-preview"],
        { peer: "@alice", uploadRef: "upload-1", mediaKind: "photo" },
      ],
    ] as const;

    for (const [toolName, prefix, payload] of cases) {
      expect(buildToolCommandArgs(toolName, { accountId: "default", ...payload })).toEqual([
        ...prefix,
        "--payload",
        JSON.stringify(payload),
      ]);
    }
  });

  it("requires explicit idempotency keys for approved Telegram actions", () => {
    expect(
      buildToolCommandArgs("message.actionApproved", {
        previewId: "message.action:1",
        idempotencyKey: "run-1",
      }),
    ).toEqual([
      "message",
      "action-approved",
      "message.action:1",
      "--idempotency-key",
      "run-1",
    ]);
    expect(
      buildToolCommandArgs("media.sendApproved", {
        previewId: "media.send:1",
        idempotencyKey: "run-2",
      }),
    ).toEqual([
      "media",
      "send-approved",
      "media.send:1",
      "--idempotency-key",
      "run-2",
    ]);
    expect(() =>
      buildToolCommandArgs("message.actionApproved", { previewId: "x" }),
    ).toThrow("idempotencyKey is required");
  });

  it("maps rules.dryRun to rules run dry-run", () => {
    expect(buildToolCommandArgs("rules.dryRun", { dialogs: 3 })).toEqual([
      "rules",
      "run",
      "--dry-run",
      "--dialogs",
      "3",
    ]);
  });

  it("rejects malformed or over-limit rule dialog bounds", () => {
    for (const dialogs of [0, "3abc", "3.7", "3.0", "1e2", "01", true, [3], 1001]) {
      expect(() => buildToolCommandArgs("rules.run", { dialogs })).toThrow(
        dialogs === 1001
          ? "--dialogs must be at most 1000"
          : "--dialogs must be a positive integer"
      );
      expect(() => buildToolCommandArgs("rules.dryRun", { dialogs })).toThrow(
        dialogs === 1001
          ? "--dialogs must be at most 1000"
          : "--dialogs must be a positive integer"
      );
    }
  });

  it("maps cleanup tools to cleanup commands", () => {
    expect(buildToolCommandArgs("tags.clear", { peer: "@alice" })).toEqual([
      "tags",
      "clear",
      "@alice",
    ]);
    expect(buildToolCommandArgs("tags.set", { peer: "@alice", tags: [] })).toEqual([
      "tags",
      "clear",
      "@alice",
    ]);
    expect(buildToolCommandArgs("company.unlink", { peer: "@alice" })).toEqual([
      "company",
      "unlink",
      "@alice",
    ]);
    expect(buildToolCommandArgs("rules.disable", { ruleId: 12 })).toEqual([
      "rules",
      "disable",
      "12",
    ]);
    expect(buildToolCommandArgs("rules.delete", { ruleId: 12 })).toEqual([
      "rules",
      "delete",
      "12",
    ]);
    expect(buildToolCommandArgs("rules.disable", { ruleId: "12" })).toEqual([
      "rules",
      "disable",
      "12",
    ]);
    expect(buildToolCommandArgs("rules.delete", { ruleId: "12" })).toEqual([
      "rules",
      "delete",
      "12",
    ]);
  });

  it("rejects non-integer cleanup rule ids", () => {
    for (const ruleId of [
      true,
      "1.0",
      "01",
      "12abc",
      1.5,
      0,
      -1,
      Number.MAX_SAFE_INTEGER + 1,
      String(Number.MAX_SAFE_INTEGER + 1),
    ]) {
      expect(() => buildToolCommandArgs("rules.disable", { ruleId })).toThrow(
        "ruleId must be a positive integer"
      );
      expect(() => buildToolCommandArgs("rules.delete", { ruleId })).toThrow(
        "ruleId must be a positive integer"
      );
    }
  });

  it("accepts accountId inputs that match the configured local account label", () => {
    process.env.TELEGRAM_ACCOUNT_LABEL = "work";
    expect(buildToolCommandArgs("dialogs.list", { accountId: "work", pageSize: 2 })).toEqual([
      "inbox",
      "--location",
      "all",
      "--page-size",
      "2",
    ]);
  });

  it("accepts the default accountId when TELEGRAM_ACCOUNT_LABEL is unset", () => {
    delete process.env.TELEGRAM_ACCOUNT_LABEL;
    expect(buildToolCommandArgs("folders.list", { accountId: "default" })).toEqual([
      "folders",
      "list",
    ]);
  });

  it("rejects accountId inputs that do not match the configured local account label", () => {
    process.env.TELEGRAM_ACCOUNT_LABEL = "default";
    expect(() =>
      buildToolCommandArgs("dialogs.list", {
        accountId: "other-account",
      })
    ).toThrow('accountId "other-account" does not match configured local account "default"');
  });
});
