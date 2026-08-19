import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

/**
 * Resolve host-tool Bash cwd and optionally jail it inside workspaceRoot.
 * Follows symlinks so `workspace/../outside` cannot escape.
 */
export function resolveHostBashCwd(
  cwd: string,
  workspaceRoot?: string,
): { cwd: string } | { error: string } {
  if (!cwd) {
    return { error: 'bash requires a workspace working directory.' };
  }
  if (!existsSync(cwd)) {
    return { error: `bash working directory does not exist: ${cwd}` };
  }
  try {
    if (!statSync(cwd).isDirectory()) {
      return { error: `bash working directory does not exist: ${cwd}` };
    }
  } catch {
    return { error: `bash working directory does not exist: ${cwd}` };
  }

  let resolved: string;
  try {
    resolved = realpathSync(cwd);
  } catch {
    return { error: `bash working directory is not accessible: ${cwd}` };
  }

  const root = workspaceRoot?.trim();
  if (!root) {
    return { cwd: resolved };
  }
  if (!existsSync(root)) {
    return { error: `bash workspace root does not exist: ${root}` };
  }
  let resolvedRoot: string;
  try {
    resolvedRoot = realpathSync(root);
  } catch {
    return { error: `bash workspace root is not accessible: ${root}` };
  }

  const rel = relative(resolvedRoot, resolved);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return { cwd: resolved };
  }
  return { error: 'bash working directory is outside the workspace.' };
}
