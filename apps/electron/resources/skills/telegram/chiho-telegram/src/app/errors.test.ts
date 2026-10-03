import { describe, expect, it } from "vitest";
import { CliError, normalizeCliError } from "./errors.js";

describe("normalizeCliError", () => {
  it("preserves explicit CLI errors", () => {
    expect(normalizeCliError(new CliError("boom", "BANG"))).toEqual({
      code: "BANG",
      message: "boom",
    });
  });

  it("maps SQLite open failures to a stable session-storage error", () => {
    const error = Object.assign(new Error("unable to open database file"), {
      code: "SQLITE_CANTOPEN",
    });

    expect(normalizeCliError(error)).toEqual({
      code: "TELEGRAM_SESSION_STORAGE_OPEN_FAILED",
      message:
        "Telegram session storage could not be opened. Check TELEGRAM_SESSION_PATH and local filesystem permissions.",
    });
  });

  it("maps native module load failures to a rebuild hint", () => {
    const error = Object.assign(new Error("library load denied by system policy"), {
      code: "ERR_DLOPEN_FAILED",
    });

    expect(normalizeCliError(error)).toEqual({
      code: "TELEGRAM_SESSION_STORAGE_NATIVE_LOAD_FAILED",
      message:
        "Telegram session storage native module failed to load. Reinstall dependencies or rebuild better-sqlite3 for this machine.",
    });
  });

  it("maps missing Postgres relations to a migrate hint", () => {
    const error = Object.assign(new Error('relation "tasks" does not exist'), {
      code: "42P01",
    });

    expect(normalizeCliError(error)).toEqual({
      code: "DATABASE_MIGRATIONS_MISSING",
      message: "Database schema is not initialized. Run `tgchats db migrate`.",
    });
  });

  it("maps Telegram peer resolution failures to a stable code", () => {
    expect(normalizeCliError(new Error("Invalid marked peer id: 0"))).toEqual({
      code: "TELEGRAM_PEER_INVALID",
      message: "Telegram peer could not be resolved. Check the peer id or username.",
    });
  });
});
