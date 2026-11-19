/**
 * conformanceSuite — executable contract for CloudRunProvider.
 *
 * Same tests run against every provider (PRD G1.4): local always,
 * cloudflare/modal behind env flags in CI. Assertions target
 * observable behavior only — state machine, artifacts, safety, events —
 * never provider internals.
 */
import type { SandboxProvider, SandboxSpec } from './sandbox.ts';
import type { CloudRunProvider, RunSpec, RunStatus } from './types.ts';
import { CloudRunnerError, isActiveRunState, isTerminalRunState } from './types.ts';

type AssertFn = (cond: boolean, msg: string) => void;

export interface ConformanceResult {
  name: string;
  ok: boolean;
  error?: string;
}

export async function conformanceSuite(
  makeProvider: () => CloudRunProvider,
  assert: AssertFn = defaultAssert,
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  const record = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const provider = makeProvider();
  const spec: RunSpec = {
    id: `conformance-${Date.now().toString(36)}`,
    name: 'conformance run',
    subtasks: [
      { id: 't1', title: 'subtask one', prompt: 'Research topic A' },
      { id: 't2', title: 'subtask two', prompt: 'Research topic B' },
    ],
    limits: { maxWallClockSec: 120 },
    metadata: { suite: 'conformance' },
  };

  await record('createRun returns a stable handle and is idempotent', async () => {
    const h1 = await provider.createRun(spec);
    const h2 = await provider.createRun(spec);
    assert(h1.id === spec.id, 'handle id must equal spec.id');
    assert(h2.id === h1.id, 'resubmission must return the same run');
    assert(h1.provider === provider.providerId, 'provider id mismatch');
  });

  await record('run reaches a terminal state', async () => {
    // Marker-polled gateways (10s alarm ticks, real LLM latency) legitimately
    // take minutes for 2 subtasks; blocking execs used to finish in seconds.
    const final = await waitFor(provider, spec.id, (s) => !isActiveRunState(s.state), 300_000);
    assert(final.state === 'done', `expected done, got ${final.state} (${final.failureReason ?? ''})`);
  });

  await record('artifacts exist per subtask and round-trip byte-exact', async () => {
    const artifacts = await provider.listArtifacts(spec.id);
    assert(artifacts.length >= 2, `expected >=2 artifacts, got ${artifacts.length}`);
    const note = artifacts.find((a) => a.path.endsWith('.md'));
    assert(!!note, 'markdown artifact missing');
    const bytes = await provider.fetchArtifact(spec.id, note!.path);
    assert(bytes.byteLength === note!.size, 'size mismatch between list and fetch');
    const text = new TextDecoder().decode(bytes);
    assert(
      text.includes('Research topic A') || text.includes('Research topic B'),
      'artifact content must reflect the subtask prompt',
    );
  });

  // Path traversal belongs in the shared suite: every provider must reject
  // `../` the same way. Crash-reconcile, process-tree kill, and wall-clock
  // budget_exceeded are local-adapter tests in local-provider.test.ts —
  // Cloudflare/Modal have no pid to SIGKILL, so those cases must not land here.
  await record('artifact path traversal is rejected', async () => {
    await expectThrow(() => provider.fetchArtifact(spec.id, '../spec.json'), 'path_traversal');
    await expectThrow(() => provider.fetchArtifact(spec.id, '/etc/passwd'), 'path_traversal');
  });

  await record('subscribeEvents yields a terminal state event', async () => {
    let terminal: RunStatus | null = null;
    for await (const event of provider.subscribeEvents(spec.id)) {
      if (event.type === 'state' && isTerminalRunState(event.status.state)) {
        terminal = event.status;
      }
    }
    assert(terminal !== null, 'no terminal state event observed');
  });

  await record('cancel on finished run is a no-op', async () => {
    await provider.cancel(spec.id);
    const s = await provider.getStatus(spec.id);
    assert(s.state === 'done', `finished run must stay done, got ${s.state}`);
  });

  await record('unknown run id raises not_found', async () => {
    await expectThrow(() => provider.getStatus('no-such-run-zzzz'), 'not_found');
    await expectThrow(() => provider.cancel('no-such-run-zzzz'), 'not_found');
  });

  await record('cancel kills a running run', async () => {
    const slow: RunSpec = {
      id: `${spec.id}-cancel`,
      name: 'cancel target',
      subtasks: [{ id: 't1', prompt: 'p' }],
    };
    await provider.createRun(slow);
    await provider.cancel(slow.id);
    const s = await waitFor(provider, slow.id, (x) => x.state === 'cancelled', 10_000);
    assert(s.failureReason === 'cancelled', `expected cancelled reason, got ${s.failureReason ?? 'none'}`);
  });

  return results;
}

// ============================================================
// Sandbox conformance (vendor-neutral sandbox contract)
// ============================================================

/**
 * Executable contract for `SandboxProvider`.
 *
 * Six observable behaviours, no vendor internals: idempotent create, exec,
 * file round-trip, stop, refusal after stop, destroy. Runs against any
 * adapter, including the in-memory fake in `__tests__/sandbox-contract.test.ts`.
 */
export async function sandboxConformanceSuite(
  makeProvider: () => SandboxProvider,
  assert: AssertFn = defaultAssert,
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  const record = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const provider = makeProvider();
  const spec: SandboxSpec = {
    id: `sandbox-conformance-${Date.now().toString(36)}`,
    os: 'linux',
    cpu: 1,
    memoryGb: 1,
    env: { SUITE: 'sandbox-conformance' },
    metadata: { suite: 'sandbox-conformance' },
  };

  await record('create with the same id is idempotent', async () => {
    const first = await provider.create(spec);
    const second = await provider.create(spec);
    assert(first.id === spec.id, 'status id must equal spec.id');
    assert(second.id === first.id, 'resubmission must return the same sandbox');
    assert(first.provider === provider.providerId, 'provider id mismatch');
    assert(second.state !== 'failed', `second create failed: ${second.failureReason ?? 'no reason'}`);
  });

  await record('exec returns stdout and exit code 0', async () => {
    const result = await provider.exec(spec.id, 'echo sandbox-conformance-ok');
    assert(result.exitCode === 0, `expected exit code 0, got ${result.exitCode}`);
    assert(
      result.stdout.includes('sandbox-conformance-ok'),
      `stdout must carry command output, got: ${JSON.stringify(result.stdout)}`,
    );
  });

  await record('write then read returns the same bytes', async () => {
    const bytes = new TextEncoder().encode('conformance bytes\nстрока\n');
    const path = '/workspace/conformance.txt';
    await provider.writeFile(spec.id, path, bytes);
    const back = await provider.readFile(spec.id, path);
    assert(back.byteLength === bytes.byteLength, `size mismatch: ${back.byteLength} vs ${bytes.byteLength}`);
    for (let i = 0; i < bytes.byteLength; i += 1) {
      assert(back[i] === bytes[i], `byte ${i} differs`);
    }
  });

  await record('stop yields a stopped sandbox', async () => {
    await provider.stop(spec.id);
    const status = await provider.get(spec.id);
    assert(status.state === 'stopped', `expected stopped, got ${status.state}`);
  });

  await record('exec after stop fails', async () => {
    await expectAnyFailure(() => provider.exec(spec.id, 'echo should-not-run'));
  });

  await record('destroy makes get fail with not_found', async () => {
    await provider.destroy(spec.id);
    await expectThrow(() => provider.get(spec.id), 'not_found');
  });

  return results;
}

// ----------------------------------------------------------

async function expectAnyFailure(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error('expected the call to fail, but it resolved');
}

async function waitFor(
  provider: CloudRunProvider,
  id: string,
  pred: (s: RunStatus) => boolean,
  timeoutMs: number,
): Promise<RunStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await provider.getStatus(id);
    if (pred(s)) return s;
    if (Date.now() > deadline) return s;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 100);
    await promise;
  }
}

async function expectThrow(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof CloudRunnerError && error.code === code) return;
    throw new Error(`expected ${code}, got: ${String(error)}`);
  }
  throw new Error(`expected ${code}, but no error was thrown`);
}

function defaultAssert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
