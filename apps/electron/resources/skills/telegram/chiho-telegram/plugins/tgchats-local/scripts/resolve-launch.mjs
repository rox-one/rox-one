import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveTgchatsMcpLaunch({
  pluginRoot,
  repositoryRoot = join(pluginRoot, "..", ".."),
  currentWorkingDirectory = process.cwd(),
  platform = process.platform,
  executablePath = process.execPath,
  commandInterpreter = process.env.ComSpec || "cmd.exe",
  fileExists = existsSync,
}) {
  const builtServer = join(repositoryRoot, "dist", "mcp", "stdio.js");
  const devServer = join(repositoryRoot, "src", "mcp", "stdio.ts");
  const localTsxCli = join(
    repositoryRoot,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );

  if (fileExists(builtServer)) {
    return {
      command: executablePath,
      args: [builtServer],
      cwd: repositoryRoot,
    };
  }

  if (fileExists(devServer) && fileExists(localTsxCli)) {
    return {
      command: executablePath,
      args: [localTsxCli, devServer],
      cwd: repositoryRoot,
    };
  }

  if (platform === "win32") {
    return {
      command: commandInterpreter,
      args: ["/d", "/s", "/c", "tgchats-mcp.cmd"],
      cwd: currentWorkingDirectory,
    };
  }

  return {
    command: "tgchats-mcp",
    args: [],
    cwd: currentWorkingDirectory,
  };
}
