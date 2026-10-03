import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveTgchatsMcpLaunch } from "../plugins/tgchats-local/scripts/resolve-launch.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function marketplaceSourceErrors(marketplace, kind) {
  const errors = [];
  for (const entry of marketplace.plugins || []) {
    const sourcePath =
      kind === "codex" ? entry?.source?.path : entry?.source;
    const expectedPath = `./plugins/${entry?.name}`;
    if (sourcePath !== expectedPath) {
      errors.push(
        `${kind} marketplace source for ${entry?.name || "<unnamed>"} must be ${expectedPath}`,
      );
      continue;
    }
    const resolvedSource = path.resolve(projectRoot, sourcePath);
    const expectedSource = path.join(projectRoot, "plugins", entry.name);
    if (resolvedSource !== expectedSource) {
      errors.push(
        `${kind} marketplace source for ${entry.name} resolves outside its package root`,
      );
    }
  }
  return errors;
}

function runNodeCommand(args) {
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

function runNode(args) {
  const result = runNodeCommand(args);

  if (result.status !== 0) {
    throw new Error(
      `Command failed: node ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }

  return result.stdout;
}

async function createMcpClient(
  command,
  args,
  { cwd = projectRoot, envOverrides = {} } = {},
) {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...envOverrides }).filter(
      (entry) => typeof entry[1] === "string",
    ),
  );
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env,
    stderr: "inherit",
  });
  const client = new Client({
    name: "tgchats-local-install-check",
    version: "1.0.0",
  });
  await client.connect(transport, { timeout: 5_000 });
  return {
    client,
    close: () => client.close(),
    serverInfo: client.getServerVersion(),
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const cliPath = path.join(projectRoot, "dist", "cli.js");
const mcpPath = path.join(projectRoot, "dist", "mcp", "stdio.js");
const contractsPath = path.join(projectRoot, "docs", "tool-contracts.json");
const publicContractsPath = path.join(
  projectRoot,
  "docs",
  "public-mcp-tool-contracts.json",
);
const packageManifestPath = path.join(projectRoot, "package.json");
const hostedPluginRoot = path.join(projectRoot, "plugins", "chiho-telegram");
const localPluginRoot = path.join(projectRoot, "plugins", "tgchats-local");
const codexMarketplacePath = path.join(
  projectRoot,
  ".agents",
  "plugins",
  "marketplace.json",
);
const claudeMarketplacePath = path.join(
  projectRoot,
  ".claude-plugin",
  "marketplace.json",
);
const hostedCodexManifestPath = path.join(
  hostedPluginRoot,
  ".codex-plugin",
  "plugin.json",
);
const hostedCodexMcpPath = path.join(hostedPluginRoot, ".mcp.json");
const hostedClaudeManifestPath = path.join(
  hostedPluginRoot,
  ".claude-plugin",
  "plugin.json",
);
const hostedLegacyClaudeMcpPath = path.join(
  hostedPluginRoot,
  "claude-mcp.json",
);
const hostedReadmePath = path.join(hostedPluginRoot, "README.md");
const hostedSetupPath = path.join(hostedPluginRoot, "SETUP.md");
const hostedLicensePath = path.join(hostedPluginRoot, "LICENSE");
const hostedSecurityPath = path.join(hostedPluginRoot, "SECURITY.md");
const localCodexManifestPath = path.join(
  localPluginRoot,
  ".codex-plugin",
  "plugin.json",
);
const localCodexMcpPath = path.join(localPluginRoot, ".mcp.json");
const localClaudeManifestPath = path.join(
  localPluginRoot,
  ".claude-plugin",
  "plugin.json",
);
const localClaudeMcpPath = path.join(localPluginRoot, "claude-mcp.json");
const hostedSkillPath = path.join(
  hostedPluginRoot,
  "skills",
  "chiho-telegram",
  "SKILL.md",
);
const localSkillPath = path.join(
  localPluginRoot,
  "skills",
  "tgchats-local",
  "SKILL.md",
);
const pluginMcpLauncherPath = path.join(
  localPluginRoot,
  "scripts",
  "run-tgchats-mcp.mjs",
);
const pluginLaunchResolverPath = path.join(
  localPluginRoot,
  "scripts",
  "resolve-launch.mjs",
);

assert(await fileExists(cliPath), `Missing CLI build output at ${cliPath}`);
assert(await fileExists(mcpPath), `Missing MCP build output at ${mcpPath}`);
assert(
  await fileExists(contractsPath),
  `Missing contract export at ${contractsPath}`,
);
assert(
  await fileExists(publicContractsPath),
  `Missing public contract export at ${publicContractsPath}`,
);
for (const removedLegacyPath of [
  path.join(projectRoot, ".codex-plugin", "plugin.json"),
  path.join(projectRoot, ".claude-plugin", "plugin.json"),
  path.join(projectRoot, ".mcp.json"),
  path.join(projectRoot, "claude-mcp.json"),
]) {
  assert(
    !(await fileExists(removedLegacyPath)),
    `Legacy combined plugin surface must stay removed: ${removedLegacyPath}`,
  );
}
for (const requiredPath of [
  packageManifestPath,
  codexMarketplacePath,
  claudeMarketplacePath,
  hostedCodexManifestPath,
  hostedCodexMcpPath,
  hostedClaudeManifestPath,
  hostedReadmePath,
  hostedSetupPath,
  hostedLicensePath,
  hostedSecurityPath,
  localCodexManifestPath,
  localCodexMcpPath,
  localClaudeManifestPath,
  localClaudeMcpPath,
  hostedSkillPath,
  localSkillPath,
  pluginLaunchResolverPath,
]) {
  assert(
    await fileExists(requiredPath),
    `Missing package file at ${requiredPath}`,
  );
}
assert(
  await fileExists(pluginMcpLauncherPath),
  `Missing local plugin MCP launcher at ${pluginMcpLauncherPath}`,
);
assert(
  !(await fileExists(hostedLegacyClaudeMcpPath)),
  "Hosted package must keep the Claude MCP override inline to avoid Cowork collisions with .mcp.json",
);

const windowsCacheLaunch = resolveTgchatsMcpLaunch({
  pluginRoot: "C:\\codex-cache\\tgchats-local",
  repositoryRoot: "C:\\codex-cache\\missing-repository",
  currentWorkingDirectory: "C:\\codex-cache\\tgchats-local",
  platform: "win32",
  executablePath: "C:\\Program Files\\nodejs\\node.exe",
  commandInterpreter: "C:\\Windows\\System32\\cmd.exe",
  fileExists: () => false,
});
assert(
  windowsCacheLaunch.command === "C:\\Windows\\System32\\cmd.exe" &&
    JSON.stringify(windowsCacheLaunch.args) ===
      JSON.stringify(["/d", "/s", "/c", "tgchats-mcp.cmd"]),
  "Windows cache installs must launch the npm .cmd shim through cmd.exe",
);

const codexMarketplace = JSON.parse(
  await fs.readFile(codexMarketplacePath, "utf8"),
);
const claudeMarketplace = JSON.parse(
  await fs.readFile(claudeMarketplacePath, "utf8"),
);
const packageManifest = JSON.parse(
  await fs.readFile(packageManifestPath, "utf8"),
);
assert(
  packageManifest.scripts?.prepare === "npm run build",
  "Package installs and release packing must build the declared dist binaries",
);
for (const [kind, marketplace] of [
  ["codex", codexMarketplace],
  ["claude", claudeMarketplace],
]) {
  assert(marketplace.name === "chiho", "Marketplace name must be chiho");
  const expectedPackages = kind === "claude"
    ? ["chiho-telegram", "unofficial-telegram-mcp", "tgchats-local"]
    : ["chiho-telegram", "tgchats-local"];
  assert(
    JSON.stringify(marketplace.plugins.map((entry) => entry.name)) ===
      JSON.stringify(expectedPackages),
    `${kind} marketplace must expose its declared hosted and local packages`,
  );
}
for (const [kind, marketplace] of [
  ["codex", codexMarketplace],
  ["claude", claudeMarketplace],
]) {
  const sourceErrors = marketplaceSourceErrors(marketplace, kind);
  assert(sourceErrors.length === 0, sourceErrors.join("\n"));

  const invalidMarketplace = structuredClone(marketplace);
  if (kind === "codex") {
    invalidMarketplace.plugins[0].source.path = "./plugins/does-not-exist";
  } else {
    invalidMarketplace.plugins[0].source = "./plugins/does-not-exist";
  }
  assert(
    marketplaceSourceErrors(invalidMarketplace, kind).length > 0,
    `${kind} marketplace validation must reject a nonexistent package source`,
  );
}

const hostedCodexManifest = JSON.parse(
  await fs.readFile(hostedCodexManifestPath, "utf8"),
);
const hostedCodexMcp = JSON.parse(
  await fs.readFile(hostedCodexMcpPath, "utf8"),
);
const localCodexManifest = JSON.parse(
  await fs.readFile(localCodexManifestPath, "utf8"),
);
const localCodexMcp = JSON.parse(await fs.readFile(localCodexMcpPath, "utf8"));

assert(
  hostedCodexManifest.name === "chiho-telegram",
  "Hosted Codex package name changed",
);
assert(
  localCodexManifest.name === "tgchats-local",
  "Local Codex package name changed",
);
assert(
  hostedCodexManifest.mcpServers === "./.mcp.json",
  "Hosted Codex manifest MCP path changed",
);
assert(
  localCodexManifest.mcpServers === "./.mcp.json",
  "Local Codex manifest MCP path changed",
);

assert(hostedCodexManifest.version === "1.1.0", "Hosted Codex package version must be 1.1.0");
const hostedCodexServer = hostedCodexMcp?.mcpServers?.["chiho-cloud"];
assert(
  hostedCodexServer?.url === "https://api.chiho.ai/mcp/v8",
  "Hosted Codex package must use the canonical MCP URL",
);
assert(
  hostedCodexServer?.auth === "oauth",
  "Hosted Codex package must use OAuth",
);
assert(
  hostedCodexServer?.default_tools_approval_mode === "writes",
  "Hosted Codex package must prompt for non-read-only tools",
);
assert(
  !hostedCodexServer?.command && !hostedCodexServer?.bearer_token_env_var,
  "Hosted Codex package must not configure local commands or bearer tokens",
);
assert(
  !JSON.stringify(hostedCodexMcp).includes("chihocool.chiho.ai"),
  "Hosted Codex package must not use the legacy domain",
);

const localCodexServer = localCodexMcp?.mcpServers?.["tgchats-local"];
assert(
  localCodexServer?.command === "node",
  "Local Codex MCP command must use node",
);
assert(
  Array.isArray(localCodexServer?.args) &&
    localCodexServer.args.length === 1 &&
    localCodexServer.args[0] === "./scripts/run-tgchats-mcp.mjs",
  "Local Codex MCP args must launch scripts/run-tgchats-mcp.mjs",
);
assert(localCodexServer.cwd === ".", "Local Codex MCP cwd must be plugin root");

const hostedClaudeManifest = JSON.parse(
  await fs.readFile(hostedClaudeManifestPath, "utf8"),
);
const personalClaudeRoot = path.join(projectRoot, "plugins", "unofficial-telegram-mcp");
const personalClaudeManifest = JSON.parse(
  await fs.readFile(path.join(personalClaudeRoot, ".claude-plugin", "plugin.json"), "utf8"),
);
const personalClaudeMcp = JSON.parse(
  await fs.readFile(path.join(personalClaudeRoot, ".mcp.json"), "utf8"),
);
const personalClaudeServer = personalClaudeManifest.mcpServers?.["telegram-cloud"];
const personalMcpServer = personalClaudeMcp.mcpServers?.["telegram-cloud"];
assert(
  personalClaudeManifest.name === "unofficial-telegram-mcp" &&
    personalClaudeServer?.type === "http" &&
    personalClaudeServer?.url === "https://telegram-mcp.chiho.ai/mcp/v2" &&
    personalMcpServer?.url === personalClaudeServer.url,
  "Personal Telegram plugin and connector must use the same versioned resource",
);
assert(
  personalMcpServer.auth === "oauth" &&
    personalMcpServer.default_tools_approval_mode === "writes" &&
    !personalClaudeServer.command && !personalClaudeServer.headers,
  "Personal Telegram plugin must use OAuth discovery and write approvals",
);
const hostedReadme = await fs.readFile(hostedReadmePath, "utf8");
const hostedSecurity = await fs.readFile(hostedSecurityPath, "utf8");
const localClaudeManifest = JSON.parse(
  await fs.readFile(localClaudeManifestPath, "utf8"),
);
const localClaudeMcp = JSON.parse(
  await fs.readFile(localClaudeMcpPath, "utf8"),
);

assert(
  hostedClaudeManifest.name === "chiho-telegram",
  "Hosted Claude package name changed",
);
assert(
  hostedClaudeManifest.displayName === "Chiho.ai Telegram CRM",
  "Hosted Claude package display name changed",
);
assert(
  hostedClaudeManifest.version === "1.1.0",
  "Hosted Claude package version must be 1.1.0",
);
assert(
  hostedClaudeManifest.homepage === "https://chiho.ai/telegram-mcp",
  "Hosted Claude package must use the product homepage",
);
assert(
  hostedClaudeManifest.defaultEnabled === false,
  "Hosted Claude package must require explicit opt-in",
);
assert(
  hostedReadme.includes("Claude Code 2.1.154 or later") &&
    hostedReadme.includes("Earlier versions ignore"),
  "Hosted Claude README must document the disabled-by-default version boundary",
);
assert(
  hostedReadme.includes("`message_send_draft` sends or schedules") &&
    hostedReadme.includes("Chiho preview record"),
  "Hosted Claude README must document the direct-send exception",
);
assert(
  (hostedReadme.match(/^> /gm) || []).length >= 3,
  "Hosted Claude README must include at least three working example prompts",
);
assert(
  hostedSecurity.includes("iwant@chiho.ai") &&
    hostedSecurity.includes("Do not open a public issue"),
  "Hosted package must provide private security reporting instructions",
);
assert(
  localClaudeManifest.name === "tgchats-local",
  "Local Claude package name changed",
);
assert(
  hostedClaudeManifest.mcpServers &&
    typeof hostedClaudeManifest.mcpServers === "object" &&
    !Array.isArray(hostedClaudeManifest.mcpServers),
  "Hosted Claude MCP override must stay inline for Cowork compatibility",
);
assert(
  localClaudeManifest.mcpServers === "./claude-mcp.json",
  "Local Claude plugin manifest must point at ./claude-mcp.json",
);

const hostedClaudeServer =
  hostedClaudeManifest.mcpServers?.["chiho-cloud"];
assert(
  hostedClaudeServer?.url === hostedCodexServer.url,
  "Both hosted clients must use the same OAuth resource",
);
assert(
  hostedReadme.includes("Existing users must") && hostedReadme.includes("reconnect"),
  "The v8 release must explain reconnecting an existing installation",
);

assert(
  hostedClaudeServer?.type === "http",
  "Hosted Claude MCP transport must be HTTP",
);
assert(
  hostedClaudeServer?.url === "https://api.chiho.ai/mcp/v8",
  "Hosted Claude package must use the canonical MCP URL",
);
assert(
  !hostedClaudeServer?.headers && !hostedClaudeServer?.command,
  "Hosted Claude package must rely on OAuth discovery",
);
assert(
  !JSON.stringify(hostedClaudeManifest.mcpServers).includes(
    "chihocool.chiho.ai",
  ),
  "Hosted Claude package must not use the legacy domain",
);

const localClaudeServer = localClaudeMcp?.mcpServers?.["tgchats-local"];
assert(
  localClaudeServer?.command === "node",
  "Local Claude MCP command must use node",
);
assert(
  Array.isArray(localClaudeServer?.args) &&
    localClaudeServer.args.length === 1 &&
    localClaudeServer.args[0] ===
      "${CLAUDE_PLUGIN_ROOT}/scripts/run-tgchats-mcp.mjs",
  "Local Claude MCP args must launch through CLAUDE_PLUGIN_ROOT",
);
assert(
  localClaudeServer.cwd === "${CLAUDE_PLUGIN_ROOT}",
  "Local Claude MCP cwd must use CLAUDE_PLUGIN_ROOT",
);
assert(
  !JSON.stringify(localCodexMcp).includes("api.chiho.ai") &&
    !JSON.stringify(localClaudeMcp).includes("api.chiho.ai"),
  "Local packages must not configure the hosted Chiho MCP server",
);

const helpOutput = runNode([cliPath, "--help"]);
assert(
  helpOutput.includes("tgchats"),
  "CLI help output did not mention tgchats",
);

const authStatusOutput = runNode([cliPath, "auth", "status", "--json"]).trim();
const authStatus = JSON.parse(authStatusOutput);
assert(authStatus.ok === true, "auth status JSON did not report ok: true");
assert(
  typeof authStatus.sessionPresent === "boolean",
  "auth status JSON did not include sessionPresent",
);
assert(
  authStatus.sessionPath === undefined,
  "auth status JSON must not disclose the Telegram session path",
);

if (authStatus.sessionPresent) {
  const whoamiResult = runNodeCommand([cliPath, "whoami", "--json"]);
  const whoami = JSON.parse(whoamiResult.stdout.trim());
  const credentialsUnavailable =
    whoamiResult.status !== 0 && whoami.code === "TELEGRAM_NOT_CONFIGURED";
  if (!credentialsUnavailable) {
    assert(whoamiResult.status === 0, "whoami command failed unexpectedly");
    assert(whoami.ok === true, "whoami JSON did not report ok: true");
    assert(
      typeof whoami.account?.id === "number",
      "whoami JSON did not include account id",
    );
    assert(
      whoami.sessionPath === undefined,
      "whoami JSON must not disclose the Telegram session path",
    );
  }

  const smokePeer = credentialsUnavailable
    ? undefined
    : process.env.TGCHATS_SMOKE_PEER?.trim();
  if (smokePeer) {
    const openOutput = runNode([cliPath, "open", smokePeer, "--json"]).trim();
    const openPayload = JSON.parse(openOutput);
    assert(openPayload.ok === true, "open JSON did not report ok: true");
    assert(
      String(openPayload.peer?.id) === smokePeer,
      "open JSON did not target the requested peer",
    );
  }

  if (!credentialsUnavailable && process.env.DATABASE_URL) {
    const tasksOutput = runNode([cliPath, "tasks", "today", "--json"]).trim();
    const tasksPayload = JSON.parse(tasksOutput);
    assert(
      tasksPayload.ok === true,
      "tasks today JSON did not report ok: true",
    );
    assert(
      Array.isArray(tasksPayload.tasks),
      "tasks today JSON did not include tasks array",
    );
  }
}

const contracts = JSON.parse(await fs.readFile(contractsPath, "utf8"));
const publicContracts = JSON.parse(
  await fs.readFile(publicContractsPath, "utf8"),
);
const portableToolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
assert(
  publicContracts.length === contracts.length,
  "Public and internal MCP contract counts must match",
);
for (const contract of publicContracts) {
  assert(
    typeof contract.name === "string" &&
      portableToolNamePattern.test(contract.name) &&
      !contract.name.includes("."),
    `Public contract ${contract.name} must use a portable name`,
  );
}
const publicInstructionPaths = [
  path.join(projectRoot, "SKILL.md"),
  path.join(projectRoot, "skills", "telegram-for-agents", "SKILL.md"),
  hostedSkillPath,
  localSkillPath,
];
for (const instructionPath of publicInstructionPaths) {
  const instructions = await fs.readFile(instructionPath, "utf8");
  for (const contract of contracts) {
    assert(
      !instructions.includes(contract.name),
      `${instructionPath} must not expose internal tool name ${contract.name}`,
    );
  }
}
const hostedSkill = await fs.readFile(hostedSkillPath, "utf8");
for (const requiredTool of [
  "auth_status",
  "account_whoami",
  "dialogs_list",
  "sync_peer",
  "team_dialogs_list",
  "approvalUrl",
  "outbox_send_approved",
  "members_invite_approved",
  "groups_leave_approved",
  "message_send_draft",
]) {
  assert(
    hostedSkill.includes(requiredTool),
    `Hosted skill must document ${requiredTool}`,
  );
}
for (const [relativePath, orderedTools] of [
  [
    "skills/telegram-conditional-replies/references/cloud-mcp.md",
    ["outbox_preview", "write_approve_preview", "outbox_send_approved"],
  ],
  [
    "skills/telegram-bulk-template-message/references/cloud-mcp.md",
    ["outbox_preview", "write_approve_preview", "outbox_send_approved"],
  ],
  [
    "skills/telegram-human-verification-challenge/references/cloud-mcp.md",
    ["outbox_preview", "write_approve_preview", "outbox_send_approved"],
  ],
  [
    "skills/telegram-chat-identity-challenge/references/cloud-mcp.md",
    ["outbox_preview", "write_approve_preview", "outbox_send_approved"],
  ],
  [
    "skills/telegram-add-colleagues-to-group/references/cloud-mcp.md",
    [
      "members_invite_preview",
      "write_approve_preview",
      "members_invite_approved",
    ],
  ],
  [
    "skills/telegram-group-cleanup/references/cloud-mcp.md",
    ["groups_leave_preview", "write_approve_preview", "groups_leave_approved"],
  ],
]) {
  const workflowPath = path.join(projectRoot, relativePath);
  const workflow = await fs.readFile(workflowPath, "utf8");
  const positions = orderedTools.map((toolName) => workflow.indexOf(toolName));
  assert(
    positions.every(
      (position, index) =>
        position >= 0 && (index === 0 || position > positions[index - 1]),
    ),
    `${relativePath} must document ${orderedTools.join(" -> ")} in execution order`,
  );
}
const localSkill = await fs.readFile(localSkillPath, "utf8");
for (const requiredTool of ["auth_status", "account_whoami", "dialogs_list"]) {
  assert(
    localSkill.includes(requiredTool),
    `Local skill must document ${requiredTool}`,
  );
}
const claudeMcpArgs = localClaudeServer.args.map((arg) =>
  arg.replaceAll("${CLAUDE_PLUGIN_ROOT}", localPluginRoot),
);
const claudeMcpCwd = localClaudeServer.cwd.replaceAll(
  "${CLAUDE_PLUGIN_ROOT}",
  localPluginRoot,
);
const connections = [];
const temporaryDirectories = [];

try {
  const packRoot = await fs.mkdtemp(path.join(tmpdir(), "tgchats-pack-"));
  temporaryDirectories.push(packRoot);
  const installPrefix = path.join(packRoot, "install");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const packResult = spawnSync(
    npmCommand,
    ["pack", "--json", "--silent", "--pack-destination", packRoot],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );
  assert(
    packResult.status === 0,
    `npm pack failed\nstdout:\n${packResult.stdout}\nstderr:\n${packResult.stderr}`,
  );
  const packMetadata = JSON.parse(packResult.stdout);
  const packedFiles = new Set(
    packMetadata[0]?.files?.map((entry) => entry.path),
  );
  for (const declaredBin of Object.values(packageManifest.bin || {})) {
    assert(
      packedFiles.has(declaredBin),
      `Packed npm artifact is missing declared binary ${declaredBin}`,
    );
  }

  const tarballPath = path.join(packRoot, packMetadata[0].filename);
  const installResult = spawnSync(
    npmCommand,
    [
      "install",
      "--global",
      "--ignore-scripts",
      "--prefix",
      installPrefix,
      tarballPath,
    ],
    {
      cwd: packRoot,
      encoding: "utf8",
    },
  );
  assert(
    installResult.status === 0,
    `Packed npm artifact failed to install\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`,
  );
  const installedBinRoot =
    process.platform === "win32"
      ? installPrefix
      : path.join(installPrefix, "bin");
  const installedBinSuffix = process.platform === "win32" ? ".cmd" : "";
  for (const binName of Object.keys(packageManifest.bin || {})) {
    assert(
      await fileExists(
        path.join(installedBinRoot, `${binName}${installedBinSuffix}`),
      ),
      `Packed npm artifact did not install ${binName}`,
    );
  }

  const mcpConnection = await createMcpClient(process.execPath, [mcpPath]);
  connections.push(mcpConnection);
  assert(
    mcpConnection.serverInfo?.name === "tgchats-local",
    "initialize response did not return the tgchats local MCP server",
  );

  const toolsList = await mcpConnection.client.listTools(
    {},
    { timeout: 5_000 },
  );
  const toolNames = toolsList.tools.map((tool) => tool.name);
  const contractNames = publicContracts.map((tool) => tool.name);

  assert(
    toolNames.length === contractNames.length,
    "MCP tool count did not match contract count",
  );
  assert(
    JSON.stringify(toolNames) === JSON.stringify(contractNames),
    "MCP tool order or names did not match docs/public-mcp-tool-contracts.json",
  );
  for (const [index, listedTool] of toolsList.tools.entries()) {
    const contract = publicContracts[index];
    for (const field of [
      "name",
      "title",
      "description",
      "inputSchema",
      "outputSchema",
      "annotations",
    ]) {
      assert(
        isDeepStrictEqual(listedTool[field], contract[field]),
        `MCP tool ${listedTool.name} ${field} did not match the exported contract`,
      );
    }
  }

  const authResult = await mcpConnection.client.callTool(
    { name: "auth_status", arguments: {} },
    undefined,
    { timeout: 5_000 },
  );
  assert(authResult.isError !== true, "auth_status returned an MCP error");
  assert(
    authResult.structuredContent?.sessionPath === undefined,
    "auth_status disclosed the Telegram session path",
  );

  const parallelAuthResults = await Promise.all(
    Array.from({ length: 8 }, () =>
      mcpConnection.client.callTool(
        { name: "auth_status", arguments: {} },
        undefined,
        { timeout: 5_000 },
      ),
    ),
  );
  assert(
    parallelAuthResults.every(
      (result) =>
        result.isError !== true &&
        result.structuredContent?.sessionPath === undefined,
    ),
    "parallel MCP tool calls must stay serialized and redact session paths",
  );

  const invalidCall = await mcpConnection.client.callTool(
    { name: "chat_read", arguments: {} },
    undefined,
    { timeout: 5_000 },
  );
  assert(
    invalidCall.isError === true,
    "failed local commands must return an MCP tool error",
  );
  assert(
    invalidCall.structuredContent === undefined,
    "MCP tool errors must not claim success-schema structured content",
  );

  const proxySecret = "proxy-password-sentinel";
  const proxyErrorConnection = await createMcpClient(
    process.execPath,
    [mcpPath],
    {
      envOverrides: {
        TELEGRAM_PROXY_URL: `http://user:${proxySecret}@`,
      },
    },
  );
  connections.push(proxyErrorConnection);
  const proxyErrorResult = await proxyErrorConnection.client.callTool(
    { name: "account_whoami", arguments: {} },
    undefined,
    { timeout: 5_000 },
  );
  assert(
    proxyErrorResult.isError === true,
    "malformed proxy configuration must return an MCP tool error",
  );
  assert(
    !JSON.stringify(proxyErrorResult).includes(proxySecret),
    "MCP tool errors must not disclose proxy credentials",
  );

  const dottedAliasCall = await mcpConnection.client.callTool(
    { name: "auth.status", arguments: {} },
    undefined,
    { timeout: 5_000 },
  );
  assert(
    dottedAliasCall.isError === true,
    "legacy dotted MCP names must be rejected after the portable-name cutover",
  );

  const pluginConnection = await createMcpClient(process.execPath, [
    pluginMcpLauncherPath,
  ]);
  connections.push(pluginConnection);
  assert(
    pluginConnection.serverInfo?.name === "tgchats-local",
    "plugin MCP launcher did not initialize the tgchats local MCP server",
  );
  const pluginToolsList = await pluginConnection.client.listTools(
    {},
    { timeout: 5_000 },
  );
  const pluginToolNames = pluginToolsList.tools.map((tool) => tool.name);
  assert(
    JSON.stringify(pluginToolNames) === JSON.stringify(contractNames),
    "plugin MCP launcher tool order or names did not match docs/public-mcp-tool-contracts.json",
  );

  let installedCacheLaunch = false;
  let cachedPluginConnection;
  if (process.platform !== "win32") {
    const fixtureRoot = await fs.mkdtemp(
      path.join(tmpdir(), "tgchats-installed-plugin-"),
    );
    temporaryDirectories.push(fixtureRoot);
    const cachedPluginRoot = path.join(
      fixtureRoot,
      "client-cache",
      "tgchats-local",
    );
    const linkedPackageRoot = path.join(fixtureRoot, "linked-package");
    const linkedDistRoot = path.join(linkedPackageRoot, "dist");
    const fixtureBinRoot = path.join(fixtureRoot, "bin");
    const fixtureSessionPath = path.join(fixtureRoot, "linked.session");

    await Promise.all([
      fs.cp(localPluginRoot, cachedPluginRoot, { recursive: true }),
      fs.cp(path.join(projectRoot, "dist"), linkedDistRoot, {
        recursive: true,
      }),
      fs.mkdir(fixtureBinRoot, { recursive: true }),
      fs.writeFile(fixtureSessionPath, ""),
    ]);
    await fs.symlink(
      path.join(projectRoot, "node_modules"),
      path.join(linkedPackageRoot, "node_modules"),
      "dir",
    );
    await fs.writeFile(
      path.join(linkedPackageRoot, ".env"),
      `TELEGRAM_SESSION_PATH=${fixtureSessionPath}\n`,
    );
    const linkedMcpPath = path.join(linkedDistRoot, "mcp", "stdio.js");
    const linkedBinaryPath = path.join(fixtureBinRoot, "tgchats-mcp");
    await fs.symlink(linkedMcpPath, linkedBinaryPath);
    await fs.chmod(linkedMcpPath, 0o755);

    const cachedPluginLauncherPath = path.join(
      cachedPluginRoot,
      "scripts",
      "run-tgchats-mcp.mjs",
    );
    cachedPluginConnection = await createMcpClient(
      process.execPath,
      [cachedPluginLauncherPath],
      {
        cwd: cachedPluginRoot,
        envOverrides: {
          PATH: `${fixtureBinRoot}${path.delimiter}${process.env.PATH || ""}`,
          TELEGRAM_SESSION_PATH: undefined,
          TGCHATS_ENV_PATH: undefined,
        },
      },
    );
    connections.push(cachedPluginConnection);
    const cachedPluginAuth = await cachedPluginConnection.client.callTool(
      { name: "auth_status", arguments: {} },
      undefined,
      { timeout: 5_000 },
    );
    assert(
      cachedPluginAuth.isError !== true &&
        cachedPluginAuth.structuredContent?.sessionPresent === true,
      "installed cache launcher must fall back to the linked binary and load its package-root .env",
    );
    installedCacheLaunch = true;
  }

  const claudePluginConnection = await createMcpClient(
    localClaudeServer.command,
    claudeMcpArgs,
    { cwd: claudeMcpCwd },
  );
  connections.push(claudePluginConnection);
  assert(
    claudePluginConnection.serverInfo?.name === "tgchats-local",
    "Claude plugin MCP config did not initialize the tgchats local MCP server",
  );
  const claudePluginToolsList = await claudePluginConnection.client.listTools(
    {},
    { timeout: 5_000 },
  );
  const claudePluginToolNames = claudePluginToolsList.tools.map(
    (tool) => tool.name,
  );
  assert(
    JSON.stringify(claudePluginToolNames) === JSON.stringify(contractNames),
    "Claude plugin MCP config tool order or names did not match docs/public-mcp-tool-contracts.json",
  );

  console.log(
    JSON.stringify(
      {
        checked: {
          authStatus,
          cliHelp: true,
          codexPlugins: [hostedCodexManifest.name, localCodexManifest.name],
          claudePlugins: claudeMarketplace.plugins.map((entry) => entry.name),
          contracts: contractNames.length,
          mcpInitialize: mcpConnection.serverInfo,
          pluginMcpInitialize: pluginConnection.serverInfo,
          cachedPluginMcpInitialize: cachedPluginConnection?.serverInfo,
          claudePluginMcpInitialize: claudePluginConnection.serverInfo,
          mcpTools: toolNames.length,
          pluginMcpTools: pluginToolNames.length,
          claudePluginMcpTools: claudePluginToolNames.length,
          mcpErrors: true,
          proxyCredentialRedaction: true,
          dottedAliasesRejected: true,
          parallelToolCallsSerialized: true,
          packedBins: true,
          installedCacheLaunch,
          sessionPathRedaction: true,
        },
        ok: true,
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.allSettled(
    connections.reverse().map((connection) => connection.close()),
  );
  await Promise.allSettled(
    temporaryDirectories.map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
}
