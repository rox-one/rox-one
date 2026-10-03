import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRuleId, parseRulesRunArgs, runRules } from "./rules.js";
import type { AppContext } from "../app/context.js";

describe("parseRuleId", () => {
  it("accepts exact positive integer ids", () => {
    expect(parseRuleId("1")).toBe(1);
    expect(parseRuleId("42")).toBe(42);
  });

  it("rejects partial numeric parses", () => {
    expect(() => parseRuleId("12abc")).toThrow("positive integer");
    expect(() => parseRuleId("12.9")).toThrow("positive integer");
    expect(() => parseRuleId("12-old")).toThrow("positive integer");
    expect(() => parseRuleId("0")).toThrow("positive integer");
    expect(() => parseRuleId(String(Number.MAX_SAFE_INTEGER + 1))).toThrow(
      "positive integer"
    );
  });
});

describe("parseRulesRunArgs", () => {
  it("defaults to non-dry-run over 200 dialogs", () => {
    expect(parseRulesRunArgs([])).toEqual({
      dryRun: false,
      dialogsLimit: 200,
    });
  });

  it("accepts dry-run and a bounded dialog limit", () => {
    expect(parseRulesRunArgs(["--dry-run", "--dialogs", "3"])).toEqual({
      dryRun: true,
      dialogsLimit: 3,
    });
  });

  it("rejects invalid dialog limits", () => {
    for (const value of ["0", "1001", "3abc", "3.7"]) {
      expect(() => parseRulesRunArgs(["--dialogs", value])).toThrow(
        value === "1001"
          ? "--dialogs must be at most 1000"
          : "--dialogs must be a positive integer"
      );
    }
  });
});

describe("runRules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes dryRun in the no-enabled-rules JSON response", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: string) => {
      logs.push(value);
    });

    const ctx = {
      config: {
        accountLabel: "default",
        sessionPath: "/tmp/test.session",
        jsonOutput: true,
      },
      db: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("INSERT INTO accounts")) {
            return { rows: [{ id: "1" }], rowCount: 1 };
          }
          if (sql.includes("FROM automation_rules")) {
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected query: ${sql}`);
        }),
      },
      telegram: {
        start: vi.fn(async () => undefined),
      },
      ai: {},
    } as unknown as AppContext;

    await runRules(ctx, ["run", "--dry-run"]);

    expect(JSON.parse(logs.at(-1) ?? "")).toEqual({
      ok: true,
      dryRun: true,
      matches: 0,
      actions: 0,
      events: [],
    });
  });

  it("uses a stable error code when AI is not configured for rule execution", async () => {
    const ctx = {
      config: {
        accountLabel: "default",
        sessionPath: "/tmp/test.session",
        jsonOutput: true,
      },
      db: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("INSERT INTO accounts")) {
            return { rows: [{ id: "1" }], rowCount: 1 };
          }
          throw new Error(`Unexpected query: ${sql}`);
        }),
      },
    } as unknown as AppContext;

    await expect(runRules(ctx, ["run"])).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
    });
  });

  it("does not write peer metadata during active dry-runs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO accounts")) {
        return { rows: [{ id: "1" }], rowCount: 1 };
      }
      if (sql.includes("FROM automation_rules")) {
        return {
          rows: [
            {
              ruleId: 1,
              name: "Pricing",
              containsText: "pricing",
              setTag: "Lead",
              followupDays: null,
              enabled: true,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected write/query during dry-run: ${sql}`);
    });
    const peer = {
      id: 123,
      type: "user",
      displayName: "Test Peer",
      username: null,
    };
    const message = {
      id: 10,
      date: new Date("2026-06-10T00:00:00.000Z"),
      sender: peer,
      text: "pricing?",
      isService: false,
      media: null,
    };

    const ctx = {
      config: {
        accountLabel: "default",
        sessionPath: "/tmp/test.session",
        jsonOutput: true,
      },
      db: {
        query,
      },
      telegram: {
        start: vi.fn(async () => undefined),
        iterDialogs: vi.fn(async function* () {
          yield { peer, lastMessage: message };
        }),
        iterHistory: vi.fn(async function* () {
          yield message;
        }),
      },
      ai: {
        evaluateRule: vi.fn(async () => ({
          matched: true,
          reason: "Asked about pricing",
          setTag: "Lead",
          shouldCreateTask: false,
          dueInDays: null,
          priority: "med",
          why: null,
        })),
      },
    } as unknown as AppContext;

    await runRules(ctx, ["run", "--dry-run", "--dialogs", "1"]);

    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO peers"),
      expect.anything()
    );
  });
});
