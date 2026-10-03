export function isJsonModeArgv(argv: string[]): boolean {
  return argv.includes('--json');
}

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function errorPayload(
  message: string,
  code?: string
): { ok: false; error: string; code?: string } {
  return code ? { ok: false, error: message, code } : { ok: false, error: message };
}
