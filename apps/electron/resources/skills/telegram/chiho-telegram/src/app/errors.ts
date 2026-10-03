export class CliError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

export function normalizeCliError(
  error: unknown
): { code?: string; message: string } {
  if (error instanceof CliError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_DLOPEN_FAILED"
  ) {
    return {
      code: "TELEGRAM_SESSION_STORAGE_NATIVE_LOAD_FAILED",
      message:
        "Telegram session storage native module failed to load. Reinstall dependencies or rebuild better-sqlite3 for this machine.",
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "SQLITE_CANTOPEN"
  ) {
    return {
      code: "TELEGRAM_SESSION_STORAGE_OPEN_FAILED",
      message:
        "Telegram session storage could not be opened. Check TELEGRAM_SESSION_PATH and local filesystem permissions.",
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  ) {
    return {
      code: "DATABASE_MIGRATIONS_MISSING",
      message: "Database schema is not initialized. Run `tgchats db migrate`.",
    };
  }

  if (
    error instanceof Error &&
    /relation .* does not exist/i.test(error.message)
  ) {
    return {
      code: "DATABASE_MIGRATIONS_MISSING",
      message: "Database schema is not initialized. Run `tgchats db migrate`.",
    };
  }

  if (
    error instanceof Error &&
    /(AUTH_KEY_UNREGISTERED|SESSION_REVOKED|requires re-?auth|logged out)/i.test(
      error.message
    )
  ) {
    return {
      code: "TELEGRAM_AUTH_FAILED",
      message:
        "Telegram session is no longer valid. Re-authenticate with `tgchats auth`.",
    };
  }

  if (
    error instanceof Error &&
    /(invalid marked peer id|PEER_ID_INVALID|USERNAME_NOT_OCCUPIED|could not find peer|peer .*not found)/i.test(
      error.message
    )
  ) {
    return {
      code: "TELEGRAM_PEER_INVALID",
      message: "Telegram peer could not be resolved. Check the peer id or username.",
    };
  }

  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : typeof error === "string" && error.trim()
        ? error
        : "Unknown error.";

  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string | number }).code)
      : undefined;

  return { code, message };
}
