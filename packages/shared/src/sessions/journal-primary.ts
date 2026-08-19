/**
 * Optional native primary writer for session.jsonl.
 *
 * When installed (CRAFT_FEATURE_NATIVE_JOURNAL_PRIMARY + live sidecar),
 * the persistence queue asks the sidecar to write session.jsonl first.
 * Returning true means the sidecar wrote the file and TS must not overwrite it.
 */
export interface SessionJournalPrimaryArgs {
  sessionDir: string;
  lines: string[];
}

export type SessionJournalPrimary = (args: SessionJournalPrimaryArgs) => Promise<boolean>;

let primary: SessionJournalPrimary | null = null;

export function setSessionJournalPrimary(next: SessionJournalPrimary | null): void {
  primary = next;
}

export async function trySessionJournalPrimary(
  sessionDir: string,
  lines: string[],
): Promise<boolean> {
  if (!primary) return false;
  try {
    return await primary({ sessionDir, lines });
  } catch (error) {
    console.warn('[session-journal-primary] write failed, falling back to TS', error);
    return false;
  }
}
