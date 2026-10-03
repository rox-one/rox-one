import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function buildCandidate({ release, environment, output, backendManifest }) {
  if (!["v2", "v3", "v4", "v5", "v6", "v8"].includes(release)) throw new Error("Choose a registered release from v2 through v6, or v8.");
  if (!["staging", "production"].includes(environment)) throw new Error("Choose staging or production explicitly.");
  const destination = path.resolve(output);
  if (destination === root || destination.startsWith(`${root}${path.sep}`)) throw new Error("Candidate output must be outside this repository so published packages cannot be overwritten.");
  const manifest = JSON.parse(await fs.readFile(backendManifest, "utf8"));
  if (manifest.formatVersion !== 1 || manifest.release !== release || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^[a-f0-9]{64}$/.test(manifest.contractSha256)) throw new Error("Supply the matching immutable backend image manifest.");
  await fs.mkdir(destination); // Refuse to replace an earlier candidate.
  await fs.cp(path.join(root, "plugins/chiho-telegram"), destination, { recursive: true });
  const origin = environment === "staging" ? "https://stagingapi.chiho.ai" : "https://api.chiho.ai";
  const site = environment === "staging" ? "https://stagingchihonewpreview.chiho.ai" : "https://chiho.ai";
  const resourceUrl = `${origin}/mcp/${release}`;
  const companionCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const version = `1.1.0-${release}.${manifest.sourceCommit.slice(0, 8)}`;
  for (const filename of [".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".mcp.json"]) {
    const data = JSON.parse(await fs.readFile(path.join(destination, filename), "utf8"));
    if (filename.endsWith("plugin.json")) {
      data.name = `chiho-telegram-preview-${release}`;
      data.version = version;
      data.description = `Qualification build of Chiho CRM ${release} with shared team work. Requires explicit OAuth consent.`;
      if (data.interface) data.interface.displayName = `Chiho Telegram Preview ${release}`;
    }
    if (data.mcpServers && typeof data.mcpServers === "object") data.mcpServers["chiho-cloud"].url = resourceUrl;
    await fs.writeFile(path.join(destination, filename), `${JSON.stringify(data, null, 2)}\n`);
  }
  const instructions = `---
name: chiho-telegram
description: Use the explicitly installed Chiho CRM ${release} qualification connection for authorized personal or shared team Telegram work.
---

# Chiho CRM ${release} qualification

Connect only to \`${resourceUrl}\` using browser OAuth. This is a dedicated test installation of the first Chiho CRM plugin. The published package and the separate Unofficial Telegram MCP are unchanged. Never copy a bearer token, change a resource URL, or use a personal connection to bypass team policy.

1. Call auth_status and account_whoami. Read the actual consent and available tools; permissions are not automatically granted.
${release === "v8" ? "2. This is a personal connection. Use teams_list to discover current Chiho team IDs, then pass an authorized teamId to every team tool. Discover shared peers with team_dialogs_list and its accountId. A teamId argument cannot grant access to another team.\n" : "2. On a team connection, use teams_list for the bound team, member IDs, account IDs and capabilities. Discover shared peers with crm_dialogs_list. A team ID argument cannot switch or widen a grant. Reconnect to choose another team.\n"}
3. Personal connections may use dialogs_list and sync_peer. Sharing additional personal conversations and repairing Telegram sessions require the account owner's Chiho browser flow at ${site}; never borrow another member's private session.
4. Use team_conversation_get before changing ownership or task assignments. Preserve accountId as part of conversation identity. Read again on revision conflicts. Use team_tasks_list for my, unassigned and overdue work, and continue cursors even on empty filtered pages.
5. Team administrators can rename, invite, remove members and set review policy with the corresponding team tools. Confirm the exact email before inviting and the exact target before destructive actions. ${release === "v8" ? "Accepting an invitation does not itself authorize this connection for the new team; confirm access with teams_list before using that teamId." : "Invitation acceptance uses a personal account-management connection; separately reconnect to the team afterward."} Never confuse Chiho membership invitations with Telegram group invitations.
6. Use team_activity_list for recorded team history. Do not infer unrecorded historical actions. Explain unavailable plan capabilities neutrally; do not insert subscription advertisements or checkout links.
7. Preview sends with outbox_preview, review the exact recipients/content/schedule, ask the user to complete any returned approvalUrl in Chiho, and then call outbox_send_approved. A queued result is not a sent message. message_send_draft is only for an explicitly approved single send and still obeys server review policy.
8. For mandatory team review, an administrator reads team_queue_list and obtains explicit approval of the exact saved content, account, recipient and schedule before team_queue_approve with its reviewId/contentHash. The initiating member's approval never substitutes for administrator approval. Use team_queue_cancel before execution. Preserve idempotency keys across retries. Check Telegram before resubmitting an unknown delivery outcome, and honor returned retry times.
9. Deterministic stored CRM reads, assignments, tasks and team administration consume no Chiho AI credits. Tools that explicitly ask Chiho to run AI processing retain their existing credit behavior.
10. C1 tools message_get, thread_read, scheduled_list and members_list use the authorized conversation scope. This release never exposes updates_poll.
${release !== "v2" ? "11. Media tools require explicit telegram.media.read consent on this exact resource. Download references are short-lived, single-use and connection-bound; do not expose bearer credentials or reuse a reference across users.\n" : ""}${["v4", "v5", "v6", "v8"].includes(release) ? "12. message_action_preview supports only reaction, markRead, edit, delete and cancelScheduled. Show its exact details and call message_action_approved separately only after user approval. Preserve the same connection and release. Forward, pin and unpin are unavailable. Members requiring administrator review must ask an administrator to preview and approve edits from that administrator's connection.\n" : ""}${["v5", "v6", "v8"].includes(release) ? "13. Use members_list with filters or search, member_get for a known user, and chat_capabilities_get for observed rights. A reported participant count is not a complete export; honor visibility, completeness, and continuation fields.\n" : ""}${["v6", "v8"].includes(release) ? "14. attention_list and drafts_list read only explicitly selected authorized chats. draft_save writes a native Telegram draft without sending and requires telegram.drafts.write consent; message_send_draft sends a message. Use invite_links_list and invite_link_members_list only for visible links, and person_context_get only for the authorized CRM relationship context.\n" : ""}

Local validation is not proof of live client support. Record the client, installed version, backend artifact, consent, tool calls and results during qualification. Do not publish this package or change a listing target as part of a test.
`;
  await fs.writeFile(path.join(destination, "skills/chiho-telegram/SKILL.md"), instructions);
  // Documentation shipped with a test installation must not route back to /mcp.
  for (const filename of ["README.md", "SETUP.md", "skills/chiho-telegram/agents/openai.yaml"]) {
    const file = path.join(destination, filename);
    const text = await fs.readFile(file, "utf8");
    await fs.writeFile(file, text.replace(/https:\/\/api\.chiho\.ai\/mcp(?:\/v[0-9]+)?/g, resourceUrl));
  }
  const record = { formatVersion: 1, release, environment, resourceUrl, version, companionCommit, backend: manifest, qualification: "pending", review: "not-submitted" };
  await fs.writeFile(path.join(destination, "candidate-release.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) {
    throw new Error("Commit candidate package changes before recording its companion source SHA.");
  }
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => { const [name, ...value] = arg.replace(/^--/, "").split("="); return [name, value.join("=")]; }));
  const record = await buildCandidate({ release: options.release, environment: options.environment, output: options.output, backendManifest: options["backend-manifest"] });
  console.log(JSON.stringify(record, null, 2));
}
