import { describe, expect, it } from "vitest";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  getPortableMcpToolName,
  getPublicMcpToolContractDefinitions,
  PORTABLE_MCP_TOOL_NAME_PATTERN,
  TOOL_CONTRACT_DEFINITIONS,
} from "./tool-contracts.js";
import exportedToolContracts from "../../docs/tool-contracts.json" with { type: "json" };
import exportedPublicToolContracts from "../../docs/public-mcp-tool-contracts.json" with { type: "json" };

describe("TOOL_CONTRACT_DEFINITIONS", () => {
  it("uses unique tool names", () => {
    const names = TOOL_CONTRACT_DEFINITIONS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("publishes unique portable names accepted by Claude and Codex clients", () => {
    const publicTools = getPublicMcpToolContractDefinitions();
    const publicNames = publicTools.map((tool) => tool.name);

    expect(publicTools).toHaveLength(TOOL_CONTRACT_DEFINITIONS.length);
    expect(new Set(publicNames).size).toBe(publicNames.length);
    expect(
      publicNames.every((name) => PORTABLE_MCP_TOOL_NAME_PATTERN.test(name)),
    ).toBe(true);
    expect(publicNames.every((name) => name === name.toLowerCase())).toBe(true);
    expect(publicNames).toContain("account_whoami");
    expect(publicNames).toContain("message_send_draft");
    expect(publicNames.some((name) => name.includes("."))).toBe(false);
    expect(() => ListToolsResultSchema.parse({ tools: publicTools })).not.toThrow();
  });

  it("fails closed for invalid portable names", () => {
    expect(() => getPortableMcpToolName("x".repeat(65))).toThrow(
      /cannot be represented/,
    );
  });

  it("matches the exported machine-readable contract artifact", () => {
    expect(exportedToolContracts).toEqual(TOOL_CONTRACT_DEFINITIONS);
    expect(exportedPublicToolContracts).toEqual(
      getPublicMcpToolContractDefinitions(),
    );
  });

  it("accepts numeric and canonical string rule ids for cleanup tools", () => {
    for (const name of ["rules.disable", "rules.delete"]) {
      const tool = TOOL_CONTRACT_DEFINITIONS.find(
        (candidate) => candidate.name === name,
      );
      expect(tool?.inputSchema).toMatchObject({
        properties: {
          ruleId: {
            oneOf: [
              { type: "integer", minimum: 1 },
              { type: "string", pattern: "^[1-9]\\d*$" },
            ],
          },
        },
      });
    }
  });

  it("allows bounded dialog limits for rule execution tools", () => {
    for (const name of ["rules.run", "rules.dryRun"]) {
      const tool = TOOL_CONTRACT_DEFINITIONS.find(
        (candidate) => candidate.name === name,
      );
      expect(tool?.inputSchema).toMatchObject({
        properties: {
          dialogs: { type: "integer", minimum: 1, maximum: 1000 },
        },
      });
    }
  });

  it("requires title and peer for folders.update create", () => {
    const tool = TOOL_CONTRACT_DEFINITIONS.find(
      (candidate) => candidate.name === "folders.update",
    );
    expect(tool?.inputSchema).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          required: ["action", "title", "peer"],
          properties: { action: { enum: ["create"] } },
        }),
      ]),
    });
  });

  it("advertises accountId except on immutable preview approvals", () => {
    for (const tool of TOOL_CONTRACT_DEFINITIONS) {
      if (
        tool.name === "message.actionApproved" ||
        tool.name === "media.sendApproved"
      ) {
        expect(tool.inputSchema).not.toMatchObject({
          properties: { accountId: expect.anything() },
        });
        continue;
      }
      expect(tool.inputSchema).toMatchObject({
        properties: {
          accountId: { type: "string" },
        },
      });
    }
  });

  it("advertises complete client metadata for every local MCP tool", () => {
    for (const tool of TOOL_CONTRACT_DEFINITIONS) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations).toEqual({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        required: expect.arrayContaining(["ok"]),
        properties: {
          ok: { type: "boolean", const: true },
        },
      });
    }
  });

  it("locks exact annotations for every local MCP tool", () => {
    const expected: Record<string, [boolean, boolean, boolean, boolean]> = {
      "auth.status": [true, false, true, false],
      "account.whoami": [true, false, true, true],
      "inventory.summary": [true, false, true, true],
      "dialogs.list": [true, false, true, true],
      "crm.dialogs.list": [true, false, true, false],
      "contacts.count": [true, false, true, true],
      "contacts.list": [true, false, true, true],
      "chat.read": [true, false, true, true],
      "message.get": [true, false, true, false],
      "thread.read": [true, false, true, false],
      "scheduled.list": [true, false, true, false],
      "media.info": [true, false, true, false],
      "media.download": [true, false, true, false],
      "members.list": [true, false, true, false],
      "member.get": [true, false, true, false],
      "chat.capabilitiesGet": [true, false, true, false],
      "attention.list": [true, false, true, false],
      "drafts.list": [true, false, true, false],
      "draft.save": [false, true, false, true],
      "forumTopics.list": [true, false, true, false],
      "joinRequests.list": [true, false, true, false],
      "inviteLinks.list": [true, false, true, false],
      "inviteLinkMembers.list": [true, false, true, false],
      "chat.adminLog": [true, false, true, false],
      "person.contextGet": [true, false, true, false],
      "updates.poll": [true, false, true, false],
      "message.actionPreview": [false, false, false, false],
      "message.actionApproved": [false, true, true, true],
      "media.sendPreview": [false, false, false, false],
      "media.sendApproved": [false, true, true, true],
      "search.messages": [true, false, true, true],
      "folders.list": [true, false, true, true],
      "folders.update": [false, true, false, true],
      "folders.create": [false, false, false, true],
      "folders.addDialog": [false, false, false, true],
      "folders.removeDialog": [false, true, false, true],
      "outbox.preview": [false, false, false, true],
      "outbox.sendApproved": [false, true, true, true],
      "message.sendDraft": [false, true, false, true],
      "members.invitePreview": [false, false, false, true],
      "members.inviteApproved": [false, true, true, true],
      "groups.leavePreview": [false, false, false, true],
      "groups.leaveApproved": [false, true, true, true],
      "tags.get": [true, false, true, false],
      "tags.set": [false, true, false, false],
      "tags.clear": [false, true, false, false],
      "tags.suggest": [false, true, false, true],
      "company.get": [true, false, true, false],
      "company.link": [false, true, false, false],
      "company.unlink": [false, true, false, false],
      "company.suggest": [false, true, false, true],
      "tasks.today": [true, false, true, false],
      "tasks.add": [false, false, false, false],
      "tasks.done": [false, true, false, false],
      "tasks.suggest": [false, false, false, true],
      "summary.show": [true, false, true, false],
      "summary.refresh": [false, true, false, true],
      "nudge.generate": [false, false, false, true],
      "rules.list": [true, false, true, false],
      "rules.add": [false, false, false, false],
      "rules.disable": [false, true, false, false],
      "rules.delete": [false, true, false, false],
      "rules.run": [false, true, false, true],
      "rules.dryRun": [false, false, false, true],
      "rules.log": [true, false, true, false],
      "sync.backfill": [false, true, false, true],
      "sync.once": [false, true, true, true],
      "sync.status": [true, false, true, false],
      "session.logout": [false, true, false, true],
    };

    expect(Object.keys(expected).sort()).toEqual(
      TOOL_CONTRACT_DEFINITIONS.map((tool) => tool.name).sort(),
    );
    for (const tool of TOOL_CONTRACT_DEFINITIONS) {
      expect([
        tool.annotations.readOnlyHint,
        tool.annotations.destructiveHint,
        tool.annotations.idempotentHint,
        tool.annotations.openWorldHint,
      ]).toEqual(expected[tool.name]);
    }
  });

  it("hard-cuts ambiguous inventory and sync inputs", () => {
    const dialogs = TOOL_CONTRACT_DEFINITIONS.find(
      (tool) => tool.name === "dialogs.list",
    );
    const sync = TOOL_CONTRACT_DEFINITIONS.find(
      (tool) => tool.name === "sync.once",
    );

    expect(dialogs?.inputSchema).toMatchObject({
      properties: {
        location: { enum: ["active", "archived", "all"] },
        pageSize: { maximum: 100 },
        cursor: { type: "string" },
      },
    });
    expect((dialogs?.inputSchema as any).properties).not.toHaveProperty("limit");
    expect((dialogs?.inputSchema as any).properties).not.toHaveProperty("all");
    expect(sync?.inputSchema).toMatchObject({
      properties: {
        mode: { enum: ["recent", "full"] },
        includeArchived: { type: "boolean" },
      },
    });
    expect((sync?.inputSchema as any).properties).not.toHaveProperty("dialogs");
  });

  it("publishes exact privacy-tight output schemas for new inventory tools", () => {
    for (const name of [
      "inventory.summary",
      "dialogs.list",
      "crm.dialogs.list",
      "contacts.count",
      "contacts.list",
      "sync.once",
      "sync.status",
    ]) {
      const tool = TOOL_CONTRACT_DEFINITIONS.find((candidate) => candidate.name === name);
      expect(tool?.outputSchema).toMatchObject({ additionalProperties: false });
    }
    const serialized = JSON.stringify(
      TOOL_CONTRACT_DEFINITIONS.filter((tool) => tool.name.startsWith("contacts.")),
    );
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("accessHash");
  });

  it("publishes the Telegram client tool family with closed schemas", () => {
    const names = [
      "message.get",
      "thread.read",
      "scheduled.list",
      "media.info",
      "media.download",
      "members.list",
      "updates.poll",
      "message.actionPreview",
      "message.actionApproved",
      "media.sendPreview",
      "media.sendApproved",
    ];
    for (const name of names) {
      const tool = TOOL_CONTRACT_DEFINITIONS.find((candidate) => candidate.name === name);
      expect(tool?.transport).toBe("shared");
      expect(tool?.inputSchema).toMatchObject({ additionalProperties: false });
      expect(tool?.outputSchema).toMatchObject({ additionalProperties: false });
    }
  });

  it("uses an explicit action union and excludes remote media URLs", () => {
    const action = TOOL_CONTRACT_DEFINITIONS.find(
      (candidate) => candidate.name === "message.actionPreview",
    );
    expect(action?.inputSchema).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({ properties: { action: { const: "edit" } } }),
        expect.objectContaining({ properties: { action: { const: "delete" } } }),
        expect.objectContaining({ properties: { action: { const: "forward" } } }),
        expect.objectContaining({ properties: { action: { const: "reaction" } } }),
      ]),
    });
    const mediaSend = TOOL_CONTRACT_DEFINITIONS.find(
      (candidate) => candidate.name === "media.sendPreview",
    );
    expect((mediaSend?.inputSchema as any).properties).toHaveProperty("uploadRef");
    expect((mediaSend?.inputSchema as any).properties).not.toHaveProperty("url");
    expect((mediaSend?.inputSchema as any).properties).not.toHaveProperty("remoteUrl");
  });
});
