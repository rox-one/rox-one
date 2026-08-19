/**
 * OmpAgent lifecycle hardening suite — adversarial regression tests for the
 * startup/teardown guarantees that omp-startup-lifecycle.test.ts does not
 * cover:
 *
 *   A1  concurrent chat() during startup must share ONE spawn — no
 *       double-spawn, no cross-settled handshake, no hanging loser.
 *   A2  a ready-timeout against a SIGTERM-immune child must escalate to
 *       SIGKILL and clear subprocess state so a retry spawns fresh.
 *   A4  a stderr flood must not wash the classifying signature out of the
 *       bounded ring buffer before exit-time classification runs.
 *   A6  a mid-turn subprocess crash must end the stream with a terminal
 *       `complete` event and report the failure exactly once.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentEvent } from '@craft-agent/core/types';
import { OmpAgent } from '../omp-agent.ts';
import {
  createFakeOmp,
  useFakeOmpEnv,
  makeOmpConfig,
  chatEvents,
  type FakeOmp,
} from './omp-fake-cli.ts';

const agents: OmpAgent[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const agent of agents.splice(0)) {
    try { agent.destroy(); } catch {}
  }
  for (const c of cleanups.splice(0)) {
    try { c(); } catch {}
  }
});

function track(agent: OmpAgent): OmpAgent {
  agents.push(agent);
  return agent;
}

/** Build a custom fake omp binary (shell wrapper around a script body). */
function makeCustomFakeOmp(scriptBody: string): { dir: string; binPath: string; workspaceRoot: string; spawnLog: string } {
  const dir = mkdtempSync(join(tmpdir(), 'omp-hardening-'));
  const workspaceRoot = join(dir, 'workspace');
  mkdirSync(workspaceRoot, { recursive: true });
  const spawnLog = join(dir, 'spawns.log');
  const scriptPath = join(dir, 'fake.js');
  writeFileSync(scriptPath, scriptBody);
  const binPath = join(dir, 'fake-omp');
  writeFileSync(binPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  chmodSync(binPath, 0o755);
  cleanups.push(() => {
    // Kill any wedged survivors (SIGTERM-immune scenarios) by script path.
    try { execSync(`pkill -9 -f "${scriptPath}" 2>/dev/null || true`); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  return { dir, binPath, workspaceRoot, spawnLog };
}

/** Point OMP_CLI_PATH (+ extra env) at a custom binary; auto-restored. */
function envFor(binPath: string, extra: Record<string, string> = {}): void {
  const saved = new Map<string, string | undefined>();
  saved.set('OMP_CLI_PATH', process.env.OMP_CLI_PATH);
  for (const k of Object.keys(extra)) saved.set(k, process.env[k]);
  process.env.OMP_CLI_PATH = binPath;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  cleanups.push(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function configFor(fake: { workspaceRoot: string }) {
  return {
    provider: 'omp',
    workspace: { id: 'ws-hardening', name: 'Hardening', rootPath: fake.workspaceRoot },
    session: { id: 'session-hardening', workspaceRootPath: fake.workspaceRoot, createdAt: Date.now(), lastUsedAt: Date.now() },
    isHeadless: true,
  } as any;
}

function spawnCount(log: string): number {
  if (!existsSync(log)) return 0;
  return readFileSync(log, 'utf8').split('\n').filter((l) => l.trim()).length;
}

function spawnPids(log: string): number[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter((l) => l.trim()).map((l) => Number(l));
}

function types(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Shrink ONLY the 20s ready-timeout; auto-restored. */
function shrinkReadyTimeout(ms: number): void {
  const original = globalThis.setTimeout;
  (globalThis as any).setTimeout = ((fn: (...a: unknown[]) => void, t?: number, ...rest: unknown[]) =>
    original(fn, t === 20_000 ? ms : t, ...rest)) as typeof setTimeout;
  cleanups.push(() => { (globalThis as any).setTimeout = original; });
}

// ---------------------------------------------------------------------------

describe('A1: concurrent chat() during startup shares one spawn', () => {
  it('single spawn, both chats bounded, exactly one turn stream', async () => {
    const fake: FakeOmp = createFakeOmp('slow-ready'); // ready at +1500ms
    const restore = useFakeOmpEnv(fake);
    cleanups.push(restore, () => fake.cleanup());
    cleanups.push(() => { try { execSync(`pkill -9 -f "${join(fake.dir, 'fake-omp.js')}" 2>/dev/null || true`); } catch {} });
    const agent = track(new OmpAgent(makeOmpConfig(fake)));
    shrinkReadyTimeout(3_000); // a cross-settled loser timeout would fail the winner at ~3s

    const p1 = chatEvents(agent, 'one', 10_000).then((ev) => ({ ok: true as const, ev })).catch((e) => ({ ok: false as const, err: String(e) }));
    const p2 = chatEvents(agent, 'two', 10_000).then((ev) => ({ ok: true as const, ev })).catch((e) => ({ ok: false as const, err: String(e) }));
    const [r1, r2] = await Promise.all([p1, p2]);

    // One subprocess, both chats settle.
    expect(fake.readArgvLog().length).toBe(1);
    expect(r1.ok && r2.ok).toBe(true);

    // BaseAgent does not serialize concurrent chat(): the first entrant owns
    // the turn, the concurrent entrant gets a bounded busy error instead of
    // interleaving into the shared event queue.
    const streams = [r1, r2].map((r) => (r.ok ? types(r.ev) : []));
    const winners = streams.filter((t) => t.includes('text_complete'));
    const losers = streams.filter((t) => !t.includes('text_complete'));
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0]!;
    expect(loser).toContain('error');
    expect(loser.at(-1)).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  }, 15_000);
});

describe('A2: ready-timeout with a SIGTERM-immune child', () => {
  it('escalates to SIGKILL and the retry spawns fresh', async () => {
    const fake = makeCustomFakeOmp(`
const fs = require('node:fs');
fs.appendFileSync(process.env.SPAWN_LOG, process.pid + '\\n');
process.on('SIGTERM', () => {}); // SIGTERM-immune
setInterval(() => {}, 60000); // never ready, never exits on its own
`);
    envFor(fake.binPath, { SPAWN_LOG: fake.spawnLog });
    const agent = track(new OmpAgent(configFor(fake)));
    shrinkReadyTimeout(80);

    const first = await chatEvents(agent, 'hi', 8_000);
    const firstTyped = first.find((e) => e.type === 'typed_error') as any;
    expect(String(firstTyped?.error?.code)).toBe('OMP_READY_TIMEOUT');
    expect(first.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);

    await new Promise((r) => setTimeout(r, 400)); // SIGTERM ignored; child still wedged

    // The retry must NOT re-await the dead handshake — it spawns a fresh child.
    const second = await chatEvents(agent, 'retry', 8_000);
    const secondTyped = second.find((e) => e.type === 'typed_error') as any;
    expect(String(secondTyped?.error?.code)).toBe('OMP_READY_TIMEOUT');
    expect(spawnCount(fake.spawnLog)).toBe(2);

    // SIGTERM → SIGKILL escalation: the wedged first child must be reaped.
    const wedgedPid = spawnPids(fake.spawnLog)[0];
    expect(wedgedPid).toBeDefined();
    const deadline = Date.now() + 4_000;
    let reaped = false;
    while (Date.now() < deadline) {
      try {
        process.kill(wedgedPid!, 0); // alive
      } catch {
        reaped = true; // ESRCH — gone
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(reaped).toBe(true);
  }, 20_000);
});

describe('A4: stderr flood must not evict the classifying signature', () => {
  it('"No models available" + ~80KB junk still classifies as OMP_NO_MODELS', async () => {
    const fake = makeCustomFakeOmp(`
const fs = require('node:fs');
fs.writeSync(2, 'No models available. Use /login or set an API key environment variable.\\n');
fs.writeSync(2, 'stack-frame-padding\\n'.repeat(4000)); // ~80KB, evicts the keyword from the tail ring
process.exit(1);
`);
    envFor(fake.binPath);
    const agent = track(new OmpAgent(configFor(fake)));

    const events = await chatEvents(agent, 'hi', 8_000);
    const typed = events.find((e) => e.type === 'typed_error') as any;
    expect(String(typed?.error?.code)).toBe('OMP_NO_MODELS');
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  });
});

describe('A6: ready-then-immediate-exit (mid-turn crash)', () => {
  it('reports the crash once and ends the stream with a terminal complete', async () => {
    const fake = makeCustomFakeOmp(`
process.stdout.write(JSON.stringify({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1] }) + '\\n');
setTimeout(() => process.exit(1), 60);
`);
    envFor(fake.binPath);
    const agent = track(new OmpAgent(configFor(fake)));

    const events = await chatEvents(agent, 'hi', 8_000);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    // No double report (crash + rejected prompt RPC used to enqueue two errors).
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  });
});
