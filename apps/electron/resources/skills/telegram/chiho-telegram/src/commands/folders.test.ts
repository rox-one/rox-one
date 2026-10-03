import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFolders } from "./folders.js";
import type { AppContext } from "../app/context.js";

const peerA = { _: "inputPeerUser", userId: 1, accessHash: 11 };
const peerB = { _: "inputPeerUser", userId: 2, accessHash: 22 };

function createFolder(includePeers = [peerA]) {
  return {
    _: "dialogFilter",
    id: 7,
    title: { _: "textWithEntities", text: "CodexTest", entities: [] },
    includePeers,
    excludePeers: [],
  };
}

function createContext(tempDir: string, overrides: Record<string, unknown> = {}) {
  const telegram = {
    start: vi.fn(async () => undefined),
    getFolders: vi.fn(async () => ({ filters: [createFolder([peerA, peerB])] })),
    resolvePeer: vi.fn(async (peer: string | number) => {
      if (peer === 1 || peer === "1") return peerA;
      if (peer === 2 || peer === "2") return peerB;
      return { _: "inputPeerUser", userId: peer, accessHash: 33 };
    }),
    editFolder: vi.fn(async () => undefined),
    createFolder: vi.fn(async (input: { title: { text: string } }) => ({
      id: 7,
      title: { text: input.title.text },
    })),
    ...overrides,
  };

  return {
    config: {
      jsonOutput: true,
      sessionPath: join(tempDir, "telegram.session"),
    },
    telegram,
  } as unknown as AppContext;
}

describe("runFolders", () => {
  let tempDir: string;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tgchats-folders-test-"));
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    log.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not treat --json as a peer for add", async () => {
    const ctx = createContext(tempDir);

    await runFolders(ctx, ["add", "CodexTest", "2", "--json"]);

    expect(ctx.telegram.resolvePeer).toHaveBeenCalledTimes(1);
    expect(ctx.telegram.resolvePeer).toHaveBeenCalledWith(2);
    expect(ctx.telegram.editFolder).toHaveBeenCalledWith({
      folder: 7,
      modification: { includePeers: [peerA, peerB] },
    });
  });

  it("does not treat --json as a peer for remove", async () => {
    const ctx = createContext(tempDir);

    await runFolders(ctx, ["remove", "CodexTest", "2", "--json"]);

    expect(ctx.telegram.resolvePeer).toHaveBeenCalledTimes(1);
    expect(ctx.telegram.resolvePeer).toHaveBeenCalledWith(2);
    expect(ctx.telegram.editFolder).toHaveBeenCalledWith({
      folder: 7,
      modification: { includePeers: [peerA] },
    });
  });

  it("does not replay folder create without an explicit idempotency key", async () => {
    const ctx = createContext(tempDir);

    await runFolders(ctx, ["create", "--title", "CodexTest", "--peer", "1", "--json"]);
    await runFolders(ctx, ["create", "--title", "CodexTest", "--peer", "1", "--json"]);

    expect(ctx.telegram.createFolder).toHaveBeenCalledTimes(2);
  });

  it("rejects folder create without an initial peer", async () => {
    const ctx = createContext(tempDir);

    await expect(runFolders(ctx, ["create", "--title", "CodexTest", "--json"])).rejects.toMatchObject({
      code: "FOLDER_PEER_REQUIRED",
    });
    expect(ctx.telegram.start).not.toHaveBeenCalled();
    expect(ctx.telegram.createFolder).not.toHaveBeenCalled();
  });

  it("rejects malformed folder order ids before auth", async () => {
    const ctx = createContext(tempDir, {
      setFoldersOrder: vi.fn(async () => undefined),
    });

    for (const value of ["1abc", "nope", "0"]) {
      await expect(runFolders(ctx, ["order", "1", value, "3", "--json"])).rejects.toThrow(
        "Usage: tgchats folders order <id...>"
      );
    }
    expect(ctx.telegram.start).not.toHaveBeenCalled();
    expect(ctx.telegram.setFoldersOrder).not.toHaveBeenCalled();
  });

  it("does not treat --json as a folder order id", async () => {
    const ctx = createContext(tempDir, {
      setFoldersOrder: vi.fn(async () => undefined),
    });

    await runFolders(ctx, ["order", "1", "2", "--json"]);

    expect(ctx.telegram.setFoldersOrder).toHaveBeenCalledWith([1, 2]);
  });

  it("rejects removing the last included peer from a folder", async () => {
    const ctx = createContext(tempDir, {
      getFolders: vi.fn(async () => ({ filters: [createFolder([peerA])] })),
    });

    await expect(runFolders(ctx, ["remove", "CodexTest", "1", "--json"])).rejects.toMatchObject({
      code: "FOLDER_EMPTY_NOT_ALLOWED",
    });
    expect(ctx.telegram.editFolder).not.toHaveBeenCalled();
  });

  it("replays folder create when an explicit idempotency key is provided", async () => {
    const ctx = createContext(tempDir);
    const args = [
      "create",
      "--title",
      "CodexTest",
      "--peer",
      "1",
      "--idempotency-key",
      "smoke-key",
      "--json",
    ];

    await runFolders(ctx, args);
    await runFolders(ctx, args);

    expect(ctx.telegram.createFolder).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
      ok: true,
      action: "create",
      idempotentReplay: true,
    });
  });
});
