/**
 * Optional native dual-write hook for session JSONL.
 *
 * Shared stays the control-plane writer (session.jsonl). Server-core may
 * install a shadow that copies the same lines into craft-native. Default is
 * a no-op so tests and headless without the sidecar are unchanged.
 */
export interface SessionJournalShadowArgs {
  sessionDir: string;
  lines: string[];
}

export type SessionJournalShadow = (args: SessionJournalShadowArgs) => void;

let shadow: SessionJournalShadow | null = null;

export function setSessionJournalShadow(next: SessionJournalShadow | null): void {
  shadow = next;
}

export function notifySessionJournalShadow(sessionDir: string, lines: string[]): void {
  if (!shadow) return;
  try {
    shadow({ sessionDir, lines });
  } catch (error) {
    console.warn('[session-journal-shadow] notify failed', error);
  }
}
