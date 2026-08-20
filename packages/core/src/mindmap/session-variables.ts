export type SessionVariable = {
  name: string;
  value?: string;
  sourceMessageId: string;
};

const BRACE = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;
const DOLLAR = /\$([A-Za-z_][\w]*)/g;
const ASSIGN = /\b([A-Z][A-Z0-9_]{1,})\s*[:=]\s*([^\s,;]+)/g;

export function extractSessionVariables(
  messages: ReadonlyArray<{ id: string; content: string }>,
): SessionVariable[] {
  const seen = new Map<string, SessionVariable>();
  for (const msg of messages) {
    const text = msg.content ?? '';
    for (const re of [BRACE, DOLLAR]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const name = m[1]!;
        if (!seen.has(name)) seen.set(name, { name, sourceMessageId: msg.id });
      }
    }
    ASSIGN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ASSIGN.exec(text))) {
      const name = m[1]!;
      const value = m[2]!.trim();
      const prev = seen.get(name);
      if (!prev) seen.set(name, { name, value, sourceMessageId: msg.id });
      else if (!prev.value) prev.value = value;
    }
  }
  return [...seen.values()];
}