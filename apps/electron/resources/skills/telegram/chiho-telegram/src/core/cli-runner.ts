import { createContext, destroyContext } from "../app/context.js";
import { normalizeCliError } from "../app/errors.js";
import { runArchive, runUnarchive } from "../commands/archive.js";
import { runGroups, runMembers, runMessage, runOutbox } from "../commands/agentWrites.js";
import {
  runChatCapabilitiesGet,
  runMedia,
  runMemberGet,
  runMembersList,
  runMessageClientTools,
  runScheduled,
  runThread,
  runUpdatesPoll,
} from "../commands/clientTools.js";
import { runAuth } from "../commands/auth.js";
import { runCommunityTool } from "../commands/communityTools.js";
import { runChat } from "../commands/chat.js";
import { runContacts } from "../commands/contacts.js";
import { runCompany } from "../commands/company.js";
import { runCrm } from "../commands/crm.js";
import { runDb } from "../commands/db.js";
import { runExport } from "../commands/export.js";
import { runFolders } from "../commands/folders.js";
import { runImport } from "../commands/import.js";
import { runInbox } from "../commands/inbox.js";
import { runInventory } from "../commands/inventory.js";
import { runLogout } from "../commands/logout.js";
import { runNudge } from "../commands/nudge.js";
import { runOpen } from "../commands/open.js";
import { runRules } from "../commands/rules.js";
import { runSearch } from "../commands/search.js";
import { runSummary } from "../commands/summary.js";
import { runSync } from "../commands/sync.js";
import { runTags } from "../commands/tags.js";
import { runTasks } from "../commands/tasks.js";
import { runWhoami } from "../commands/whoami.js";
import { errorPayload, isJsonModeArgv, printJson } from "../output.js";

export const HELP = `Usage:
  tgchats inbox [--limit <number>] [--all]
  tgchats inventory summary
  tgchats contacts <count|list> [--page-size N] [--cursor value]
  tgchats crm dialogs list [--page-size N] [--cursor value]
  tgchats auth [status]
  tgchats whoami
  tgchats logout
  tgchats chat <peer> [--limit N] [--since messageId]
  tgchats open <peer>
  tgchats search "<query>" [--chat <peer>] [--tag <tag>] [--company <name>] [--limit N]
  tgchats folders <list|create|rename|delete|order|add|remove> ...
  tgchats outbox <preview|send-approved> ...
  tgchats message <get|action-preview|action-approved|send-draft> ...
  tgchats thread read ...
  tgchats scheduled list ...
  tgchats media <stage|info|download|redeem|send-preview|send-approved> ...
  tgchats members <list|invite-preview|invite-approved> ...
  tgchats updates poll ...
  tgchats groups <leave-preview|leave-approved> ...
  tgchats archive <peer...>
  tgchats unarchive <peer...>
  tgchats tags <set|clear|ls|suggest> ...
  tgchats company <link|unlink|show|suggest> ...
  tgchats tasks <add|done|today|suggest> ...
  tgchats summary <show|refresh> ...
  tgchats nudge <peer> [--style concise|friendly]
  tgchats rules <list|add|disable|delete|run|log> ...
  tgchats sync <backfill|once|status|tail> ...
  tgchats export --format <json|jsonl|csv|md> --out <path>
  tgchats import --from <path>
  tgchats db migrate

Environment:
  TELEGRAM_API_ID           Required Telegram app API ID
  TELEGRAM_API_HASH         Required Telegram app API hash
  TELEGRAM_SESSION_PATH     Optional session SQLite path
  TELEGRAM_PROXY_URL        Optional proxy URL:
                            http://host:port
                            https://host:port
                            socks4://host:port
                            socks5://host:port
  TELEGRAM_ACCOUNT_LABEL    Optional account label (default: "default")
  DATABASE_URL              Optional Postgres URL for app/CRM data
  AI_MODE                   Optional AI backend: gemini | openclaw
  GEMINI_API_KEY            Required when AI_MODE=gemini
  GEMINI_MODEL              Optional Gemini model (default: gemini-2.0-flash)
  OPENCLAW_BASE_URL         Required when AI_MODE=openclaw
  OPENCLAW_API_KEY          Optional bearer token for OpenClaw
  OPENCLAW_MODEL            Optional OpenClaw model (default: openclaw)
  AI_TIMEOUT_MS             Optional AI request timeout in milliseconds (default: 30000)

Flags:
  -n, --limit <number>      Number of chats to list (default: 5)
  -a, --all                 List all chats
  --json                    Machine-readable JSON output for supported commands
`;

export async function executeCli(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const [maybeCmd, ...rest] = argv;
  const command = maybeCmd && !maybeCmd.startsWith("-") ? maybeCmd : "inbox";
  const args = command === "inbox" ? argv : rest;
  const ctx = createContext(args);

  try {
    if (command === "db") return await runDb(ctx, rest);
    if (command === "inbox") return await runInbox(ctx, args);
    if (command === "inventory") return await runInventory(ctx, rest);
    if (command === "contacts") return await runContacts(ctx, rest);
    if (command === "crm") return await runCrm(ctx, rest);
    if (command === "auth") return await runAuth(ctx, rest);
    if (command === "whoami") return await runWhoami(ctx);
    if (command === "logout") return await runLogout(ctx);
    if (command === "chat") return await runChat(ctx, rest);
    if (command === "open") return await runOpen(ctx, rest);
    if (command === "search") return await runSearch(ctx, rest);
    if (command === "folders") return await runFolders(ctx, rest);
    if (command === "outbox") return await runOutbox(ctx, rest);
    if (command === "message") {
      return rest[0] === "send-draft"
        ? await runMessage(ctx, rest)
        : await runMessageClientTools(ctx, rest);
    }
    if (command === "thread") {
      if (rest[0] !== "read") throw new Error("Usage: tgchats thread read --payload JSON");
      return await runThread(ctx, rest.slice(1));
    }
    if (command === "scheduled") {
      if (rest[0] !== "list") throw new Error("Usage: tgchats scheduled list --payload JSON");
      return await runScheduled(ctx, rest.slice(1));
    }
    if (command === "media") return await runMedia(ctx, rest);
    if (command === "members") {
      return rest[0] === "list"
        ? await runMembersList(ctx, rest.slice(1))
        : rest[0] === "get"
        ? await runMemberGet(ctx, rest.slice(1))
        : await runMembers(ctx, rest);
    }
    if (command === "chat-capabilities") {
      if (rest[0] !== "get") throw new Error("Usage: tgchats chat-capabilities get --payload JSON");
      return await runChatCapabilitiesGet(ctx, rest.slice(1));
    }
    if (["attention", "drafts", "draft", "forum-topics", "join-requests", "invite-links", "invite-link-members", "chat-admin-log", "person-context"].includes(command)) {
      const names: Record<string, string> = { attention: "attention.list", drafts: "drafts.list", draft: "draft.save", "forum-topics": "forumTopics.list", "join-requests": "joinRequests.list", "invite-links": "inviteLinks.list", "invite-link-members": "inviteLinkMembers.list", "chat-admin-log": "chat.adminLog", "person-context": "person.contextGet" };
      const expected = command === "draft" ? "save" : command === "person-context" ? "get" : "list";
      if (rest[0] !== expected) throw new Error(`Usage: tgchats ${command} ${expected} --payload JSON`);
      return await runCommunityTool(ctx, names[command], rest.slice(1));
    }
    if (command === "updates") {
      if (rest[0] !== "poll") throw new Error("Usage: tgchats updates poll --payload JSON");
      return await runUpdatesPoll(ctx, rest.slice(1));
    }
    if (command === "groups") return await runGroups(ctx, rest);
    if (command === "archive") return await runArchive(ctx, rest);
    if (command === "unarchive") return await runUnarchive(ctx, rest);
    if (command === "tags") return await runTags(ctx, rest);
    if (command === "company") return await runCompany(ctx, rest);
    if (command === "tasks") return await runTasks(ctx, rest);
    if (command === "summary") return await runSummary(ctx, rest);
    if (command === "nudge") return await runNudge(ctx, rest);
    if (command === "rules") return await runRules(ctx, rest);
    if (command === "sync") return await runSync(ctx, rest);
    if (command === "export") return await runExport(ctx, rest);
    if (command === "import") return await runImport(ctx, rest);
    throw new Error(`Unknown command: ${command}`);
  } finally {
    await destroyContext(ctx);
  }
}

function stringifyConsoleArgs(args: unknown[]) {
  return args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
}

let cliJsonExecutionQueue: Promise<void> = Promise.resolve();

async function executeCliJsonExclusive(argv: string[]): Promise<unknown> {
  const jsonArgv = argv.includes("--json") ? argv : [...argv, "--json"];
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    capturedLogs.push(stringifyConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    capturedLogs.push(stringifyConsoleArgs(args));
  };

  try {
    await executeCli(jsonArgv);
  } catch (error) {
    const normalized = normalizeCliError(error);
    return errorPayload(normalized.message, normalized.code);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const payload = capturedLogs.at(-1);
  if (!payload) {
    throw new Error("No JSON payload was produced by the command.");
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Expected JSON output from command, received: ${payload}`
    );
  }
}

export function executeCliJson(argv: string[]): Promise<unknown> {
  const result = cliJsonExecutionQueue.then(() => executeCliJsonExclusive(argv));
  cliJsonExecutionQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function runCliMain(argv: string[]): Promise<void> {
  try {
    await executeCli(argv);
  } catch (error) {
    const normalized = normalizeCliError(error);
    if (isJsonModeArgv(argv)) {
      printJson(errorPayload(normalized.message, normalized.code));
    } else {
      console.error(`Error: ${normalized.message}`);
    }
    process.exitCode = 1;
  }
}
