/**
 * Session state management for multi-turn design iteration.
 * Session files are private JSON in the platform temporary directory.
 */

import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { atomicWriteSync } from "../../lib/fs-atomic";
import { readBoundedStable } from "../../lib/cso/bounded-file";

export interface DesignSession {
  id: string;
  lastResponseId: string;
  originalBrief: string;
  feedbackHistory: string[];
  outputPaths: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Generate an unpredictable session ID; legacy PID-timestamp IDs remain readable.
 */
export function createSessionId(): string {
  return randomUUID();
}

/**
 * Get the file path for a session.
 */
export function sessionPath(sessionId: string): string {
  if (!/^(?:[0-9]+-[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(sessionId)) throw new Error("Invalid design session ID");
  return path.join(tmpdir(), `design-session-${sessionId}.json`);
}

/**
 * Create a new session after initial generation.
 */
export function createSession(
  responseId: string,
  brief: string,
  outputPath: string,
): DesignSession {
  const id = createSessionId();
  const session: DesignSession = {
    id,
    lastResponseId: responseId,
    originalBrief: brief,
    feedbackHistory: [],
    outputPaths: [outputPath],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  atomicWriteSync(sessionPath(id), JSON.stringify(session, null, 2), { mode: 0o600, noReplace: true });
  return session;
}

/**
 * Read an existing session from disk.
 */
export function readSession(sessionFilePath: string): DesignSession {
  const content = readBoundedStable(sessionFilePath, 16 * 1024 * 1024, "design session").toString("utf8");
  return JSON.parse(content);
}

/**
 * Update a session with new iteration data.
 */
export function updateSession(
  session: DesignSession,
  responseId: string,
  feedback: string,
  outputPath: string,
): void {
  session.lastResponseId = responseId;
  session.feedbackHistory.push(feedback);
  session.outputPaths.push(outputPath);
  session.updatedAt = new Date().toISOString();

  atomicWriteSync(sessionPath(session.id), JSON.stringify(session, null, 2), { mode: 0o600 });
}
