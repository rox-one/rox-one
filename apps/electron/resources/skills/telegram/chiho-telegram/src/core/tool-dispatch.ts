import { getToolContractDefinitions } from "../contracts/tool-contracts.js";
import { executeCliJson } from "./cli-runner.js";

function integerFlag(value: unknown, flag: string) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) {
      return [flag, value.trim()];
    }
  }

  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return [flag, String(value)];
  }

  throw new Error(`${flag} must be a positive integer.`);
}

function boundedIntegerFlag(value: unknown, flag: string, max: number) {
  const result = integerFlag(value, flag);
  if (result.length === 0) {
    return result;
  }

  const parsed = Number(result[1]);
  if (parsed > max) {
    throw new Error(`${flag} must be at most ${max}.`);
  }

  return result;
}

function stringFlag(value: unknown, flag: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return [flag, value.trim()];
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function requireStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} is required.`);
  }

  const values = value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (typeof item === "number" && Number.isFinite(item)) {
        return String(item);
      }
      return "";
    })
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return values;
}

function requirePositiveInteger(value: unknown, label: string) {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) {
      return value.trim();
    }
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return String(value);
}

function optionalEnum(
  value: unknown,
  label: string,
  allowed: readonly string[],
  fallback: string,
) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function optionalBoolean(value: unknown, label: string, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function inputWithoutAccountId(input: Record<string, unknown>) {
  const { accountId: _accountId, ...rest } = input;
  return rest;
}

function payloadArg(input: Record<string, unknown>) {
  return ["--payload", JSON.stringify(inputWithoutAccountId(input))];
}

function validateLocalAccountId(input: Record<string, unknown>) {
  if (
    !Object.prototype.hasOwnProperty.call(input, "accountId") ||
    input.accountId === undefined ||
    input.accountId === null ||
    input.accountId === ""
  ) {
    return;
  }

  if (typeof input.accountId !== "string" || input.accountId.trim().length === 0) {
    throw new Error("accountId must be a non-empty string.");
  }

  const requestedAccountId = input.accountId.trim();
  const configuredAccountId = process.env.TELEGRAM_ACCOUNT_LABEL?.trim() || "default";
  if (requestedAccountId !== configuredAccountId) {
    throw new Error(
      `accountId "${requestedAccountId}" does not match configured local account "${configuredAccountId}". Set TELEGRAM_ACCOUNT_LABEL before starting tgchats-mcp to select a different local account.`
    );
  }
}

export function buildToolCommandArgs(
  toolName: string,
  input: Record<string, unknown> = {}
) {
  validateLocalAccountId(input);

  if (toolName === "auth.status") {
    return ["auth", "status"];
  }

  if (toolName === "account.whoami") {
    return ["whoami"];
  }

  if (toolName === "inventory.summary") {
    return ["inventory", "summary"];
  }

  if (toolName === "dialogs.list") {
    const location = optionalEnum(
      input.location,
      "location",
      ["active", "archived", "all"],
      "all",
    );
    return [
      "inbox",
      "--location",
      location,
      ...boundedIntegerFlag(input.pageSize ?? 100, "--page-size", 100),
      ...stringFlag(input.cursor, "--cursor"),
    ];
  }

  if (toolName === "crm.dialogs.list") {
    return [
      "crm",
      "dialogs",
      "list",
      ...boundedIntegerFlag(input.pageSize ?? 100, "--page-size", 100),
      ...stringFlag(input.cursor, "--cursor"),
    ];
  }

  if (toolName === "contacts.count") {
    return ["contacts", "count"];
  }

  if (toolName === "contacts.list") {
    return [
      "contacts",
      "list",
      ...boundedIntegerFlag(input.pageSize ?? 100, "--page-size", 100),
      ...stringFlag(input.cursor, "--cursor"),
    ];
  }

  if (toolName === "chat.read") {
    return [
      "chat",
      requireString(input.peer, "peer"),
      ...integerFlag(input.limit, "--limit"),
      ...boundedIntegerFlag(input.sinceMessageId, "--since", 2_147_483_647),
      ...boundedIntegerFlag(input.offsetDate, "--offset-date", 2_147_483_647),
      ...boundedIntegerFlag(
        input.offsetMessageId,
        "--offset-message-id",
        2_147_483_647,
      ),
    ];
  }

  if (toolName === "message.get") {
    return ["message", "get", ...payloadArg(input)];
  }

  if (toolName === "thread.read") {
    return ["thread", "read", ...payloadArg(input)];
  }

  if (toolName === "scheduled.list") {
    return ["scheduled", "list", ...payloadArg(input)];
  }

  if (toolName === "media.info") {
    return ["media", "info", ...payloadArg(input)];
  }

  if (toolName === "media.download") {
    return ["media", "download", ...payloadArg(input)];
  }

  if (toolName === "members.list") {
    return ["members", "list", ...payloadArg(input)];
  }
  if (toolName === "member.get") {
    return ["members", "get", ...payloadArg(input)];
  }
  if (toolName === "chat.capabilitiesGet") {
    return ["chat-capabilities", "get", ...payloadArg(input)];
  }

  const communityCommands: Record<string, [string, string]> = {
    "attention.list": ["attention", "list"], "drafts.list": ["drafts", "list"],
    "draft.save": ["draft", "save"], "forumTopics.list": ["forum-topics", "list"],
    "joinRequests.list": ["join-requests", "list"], "inviteLinks.list": ["invite-links", "list"],
    "inviteLinkMembers.list": ["invite-link-members", "list"], "chat.adminLog": ["chat-admin-log", "list"],
    "person.contextGet": ["person-context", "get"],
  };
  if (communityCommands[toolName]) return [...communityCommands[toolName], ...payloadArg(input)];
  if (toolName === "updates.poll") {
    return ["updates", "poll", ...payloadArg(input)];
  }

  if (toolName === "message.actionPreview") {
    return ["message", "action-preview", ...payloadArg(input)];
  }

  if (toolName === "message.actionApproved") {
    return [
      "message",
      "action-approved",
      requireString(input.previewId, "previewId"),
      "--idempotency-key",
      requireString(input.idempotencyKey, "idempotencyKey"),
    ];
  }

  if (toolName === "media.sendPreview") {
    return ["media", "send-preview", ...payloadArg(input)];
  }

  if (toolName === "media.sendApproved") {
    return [
      "media",
      "send-approved",
      requireString(input.previewId, "previewId"),
      "--idempotency-key",
      requireString(input.idempotencyKey, "idempotencyKey"),
    ];
  }

  if (toolName === "search.messages") {
    return [
      "search",
      requireString(input.query, "query"),
      ...stringFlag(input.chat, "--chat"),
      ...stringFlag(input.tag, "--tag"),
      ...stringFlag(input.company, "--company"),
      ...integerFlag(input.limit, "--limit"),
      ...(input.local ? ["--local"] : []),
    ];
  }

  if (toolName === "folders.list") {
    return ["folders", "list"];
  }

  if (toolName === "folders.update") {
    const action = requireString(input.action, "action");
    if (action === "create") {
      return [
        "folders",
        "create",
        "--title",
        requireString(input.title, "title"),
        "--peer",
        requireString(input.peer, "peer"),
      ];
    }
    if (action === "rename") {
      return [
        "folders",
        "rename",
        requireString(input.folder, "folder"),
        "--title",
        requireString(input.title, "title"),
      ];
    }
    if (action === "delete") {
      return ["folders", "delete", requireString(input.folder, "folder")];
    }
    if (action === "order") {
      return [
        "folders",
        "order",
        ...requireStringArray(input.folderIds, "folderIds"),
      ];
    }
    if (action === "add" || action === "remove") {
      return [
        "folders",
        action,
        requireString(input.folder, "folder"),
        ...requireStringArray(input.peers, "peers"),
      ];
    }
    throw new Error("Unsupported folders.update action.");
  }

  if (toolName === "folders.create") {
    return [
      "folders",
      "create",
      "--title",
      requireString(input.title, "title"),
      "--peer",
      requireString(input.peer, "peer"),
      ...stringFlag(input.idempotencyKey, "--idempotency-key"),
    ];
  }

  if (toolName === "folders.addDialog") {
    return [
      "folders",
      "add",
      requireString(input.folderId, "folderId"),
      requireString(input.peer, "peer"),
    ];
  }

  if (toolName === "folders.removeDialog") {
    return [
      "folders",
      "remove",
      requireString(input.folderId, "folderId"),
      requireString(input.peer, "peer"),
    ];
  }

  if (toolName === "outbox.preview") {
    return ["outbox", "preview", ...payloadArg(input)];
  }

  if (toolName === "outbox.sendApproved") {
    return [
      "outbox",
      "send-approved",
      requireString(input.previewId, "previewId"),
      ...stringFlag(input.idempotencyKey, "--idempotency-key"),
    ];
  }

  if (toolName === "message.sendDraft") {
    return ["message", "send-draft", ...payloadArg(input)];
  }

  if (toolName === "members.invitePreview") {
    return ["members", "invite-preview", ...payloadArg(input)];
  }

  if (toolName === "members.inviteApproved") {
    return [
      "members",
      "invite-approved",
      requireString(input.previewId, "previewId"),
      ...stringFlag(input.idempotencyKey, "--idempotency-key"),
    ];
  }

  if (toolName === "groups.leavePreview") {
    return ["groups", "leave-preview", ...payloadArg(input)];
  }

  if (toolName === "groups.leaveApproved") {
    return [
      "groups",
      "leave-approved",
      requireString(input.previewId, "previewId"),
      ...stringFlag(input.idempotencyKey, "--idempotency-key"),
    ];
  }

  if (toolName === "tags.get") {
    return ["tags", "ls", ...stringFlag(input.peer, "--peer")];
  }

  if (toolName === "tags.set") {
    if (Array.isArray(input.tags) && input.tags.length === 0) {
      return ["tags", "clear", requireString(input.peer, "peer")];
    }

    return [
      "tags",
      "set",
      requireString(input.peer, "peer"),
      ...requireStringArray(input.tags, "tags"),
    ];
  }

  if (toolName === "tags.clear") {
    return ["tags", "clear", requireString(input.peer, "peer")];
  }

  if (toolName === "tags.suggest") {
    return [
      "tags",
      "suggest",
      requireString(input.peer, "peer"),
      ...integerFlag(input.limit, "--limit"),
      ...(input.apply ? ["--apply"] : []),
    ];
  }

  if (toolName === "company.get") {
    return ["company", "show", requireString(input.peer, "peer")];
  }

  if (toolName === "company.link") {
    return [
      "company",
      "link",
      requireString(input.peer, "peer"),
      "--company",
      requireString(input.company, "company"),
      ...stringFlag(input.role, "--role"),
    ];
  }

  if (toolName === "company.unlink") {
    return ["company", "unlink", requireString(input.peer, "peer")];
  }

  if (toolName === "company.suggest") {
    return [
      "company",
      "suggest",
      requireString(input.peer, "peer"),
      ...integerFlag(input.limit, "--limit"),
      ...(input.apply ? ["--apply"] : []),
    ];
  }

  if (toolName === "tasks.today") {
    return ["tasks", "today"];
  }

  if (toolName === "tasks.add") {
    return [
      "tasks",
      "add",
      requireString(input.peer, "peer"),
      "--due",
      requireString(input.due, "due"),
      "--why",
      requireString(input.why, "why"),
      ...stringFlag(input.priority, "--priority"),
    ];
  }

  if (toolName === "tasks.done") {
    return ["tasks", "done", ...integerFlag(input.taskId, "--task-id").slice(1)];
  }

  if (toolName === "tasks.suggest") {
    return [
      "tasks",
      "suggest",
      requireString(input.peer, "peer"),
      ...integerFlag(input.limit, "--limit"),
      ...(input.apply ? ["--apply"] : []),
    ];
  }

  if (toolName === "summary.show") {
    return [
      "summary",
      "show",
      requireString(input.peer, "peer"),
      ...stringFlag(input.kind, "--kind"),
    ];
  }

  if (toolName === "summary.refresh") {
    if (input.all) {
      return [
        "summary",
        "refresh",
        "--all",
        ...integerFlag(input.limit, "--limit"),
      ];
    }

    return [
      "summary",
      "refresh",
      requireString(input.peer, "peer"),
      ...integerFlag(input.limit, "--limit"),
    ];
  }

  if (toolName === "nudge.generate") {
    return [
      "nudge",
      requireString(input.peer, "peer"),
      ...stringFlag(input.style, "--style"),
    ];
  }

  if (toolName === "rules.list") {
    return ["rules", "list"];
  }

  if (toolName === "rules.add") {
    return [
      "rules",
      "add",
      "--name",
      requireString(input.name, "name"),
      "--instruction",
      requireString(input.instruction, "instruction"),
      ...stringFlag(input.tag, "--tag"),
      ...integerFlag(input.followupDays, "--followup-days"),
    ];
  }

  if (toolName === "rules.disable") {
    return ["rules", "disable", requirePositiveInteger(input.ruleId, "ruleId")];
  }

  if (toolName === "rules.delete") {
    return ["rules", "delete", requirePositiveInteger(input.ruleId, "ruleId")];
  }

  if (toolName === "rules.run") {
    return [
      "rules",
      "run",
      ...boundedIntegerFlag(input.dialogs, "--dialogs", 1000),
    ];
  }

  if (toolName === "rules.dryRun") {
    return [
      "rules",
      "run",
      "--dry-run",
      ...boundedIntegerFlag(input.dialogs, "--dialogs", 1000),
    ];
  }

  if (toolName === "rules.log") {
    return ["rules", "log", ...integerFlag(input.limit, "--limit")];
  }

  if (toolName === "sync.backfill") {
    return [
      "sync",
      "backfill",
      ...integerFlag(input.perChatLimit, "--per-chat-limit"),
      ...integerFlag(input.dialogs, "--dialogs"),
    ];
  }

  if (toolName === "sync.once") {
    const mode = optionalEnum(input.mode, "mode", ["recent", "full"], "recent");
    const includeArchived = optionalBoolean(
      input.includeArchived,
      "includeArchived",
      true,
    );
    return [
      "sync",
      "once",
      "--mode",
      mode,
      includeArchived ? "--include-archived" : "--exclude-archived",
    ];
  }

  if (toolName === "sync.status") {
    return ["sync", "status", ...stringFlag(input.runId, "--run-id")];
  }

  if (toolName === "session.logout") {
    return ["logout"];
  }

  throw new Error(`Unsupported tool: ${toolName}`);
}

export async function executeLocalToolCall(
  toolName: string,
  input: Record<string, unknown> = {}
) {
  const supported = new Set(getToolContractDefinitions().map((tool) => tool.name));
  if (!supported.has(toolName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return executeCliJson(buildToolCommandArgs(toolName, input));
}
