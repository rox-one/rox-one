/**
 * Status Validation
 *
 * Runtime validation for session status IDs.
 * Ensures sessions always have valid status references.
 */

import { isValidStatusId, loadStatusConfig } from './storage.ts';

/**
 * Validate and normalize a session's status
 * If invalid or undefined, returns 'todo' as fallback
 *
 * @param workspaceRootPath - Workspace root path
 * @param sessionStatus - Status ID to validate
 * @returns Valid status ID (or 'todo' fallback)
 */
export function validateSessionStatus(
  workspaceRootPath: string,
  sessionStatus: string | undefined
): string {
  // Default to 'todo' if undefined
  if (!sessionStatus) {
    return 'todo';
  }

  // Check if status exists in workspace config
  if (isValidStatusId(workspaceRootPath, sessionStatus)) {
    return sessionStatus;
  }

  // Invalid status - log warning and fallback to 'todo'
  console.warn(
    `[validateSessionStatus] Invalid status '${sessionStatus}' for workspace, ` +
    `falling back to 'todo'. The status may have been deleted.`
  );

  return 'todo';
}

/**
 * Batch form of validateSessionStatus for list scans: the workspace status
 * config (and its icon self-heal) is read once, on the first status that
 * needs checking, instead of once per session. Same results and warnings.
 */
export function createSessionStatusValidator(
  workspaceRootPath: string
): (sessionStatus: string | undefined) => string {
  let validIds: Set<string> | null = null;
  return (sessionStatus) => {
    if (!sessionStatus) return 'todo';
    validIds ??= new Set(loadStatusConfig(workspaceRootPath).statuses.map(s => s.id));
    if (validIds.has(sessionStatus)) return sessionStatus;
    console.warn(
      `[validateSessionStatus] Invalid status '${sessionStatus}' for workspace, ` +
      `falling back to 'todo'. The status may have been deleted.`
    );
    return 'todo';
  };
}
