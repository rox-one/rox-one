import { expect, it } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, type FSWatcher } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { availableParallelism, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { OmpRuntimeObserver, OMP_OBSERVATION_MAX_FRAME_BYTES, type OmpRuntimeObservation } from '../omp-runtime-observer.ts';
import { OmpRuntimeTraceBridge } from '../omp-runtime-trace-bridge.ts';

const waitFor = async (ready: () => boolean, diagnostics: () => unknown = () => undefined): Promise<void> => {
  const deadline = performance.now() + 3_000;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Actual filesystem watcher delivery did not complete: ${JSON.stringify(diagnostics())}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

it('delivers bounded append bursts through the actual watcher with source order, replay, gap and frame-limit evidence', async () => {
  const sha256 = (path: URL): string => createHash('sha256').update(readFileSync(path)).digest('hex');
  const fingerprints = () => ({ observer: sha256(new URL('../omp-runtime-observer.ts', import.meta.url)),
    bridge: sha256(new URL('../omp-runtime-trace-bridge.ts', import.meta.url)),
    test: sha256(new URL('./omp-runtime-observer-watch.test.ts', import.meta.url)) });
  const sourceBefore = fingerprints();
  const revisionBefore = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const root = mkdtempSync(join(tmpdir(), 'rox-observer-watch-'));
  const bridge = new OmpRuntimeTraceBridge();
  bridge.beginRun('watch-fixture-run', 'bounded observer transport fixture');
  const received: number[] = [];
  const mapped: ReturnType<OmpRuntimeTraceBridge['map']> = [];
  const errors: Error[] = [];
  const pending: Array<{ sequence: number; appendedAt: number }> = [];
  const latencyMs: number[] = [];
  let highWaterFrames = 0;
  let mapMs = 0;
  let callbackOrderMatched = true;
  const observer = new OmpRuntimeObserver(join(root, 'observer'), event => {
    const expected = pending.shift();
    if (!expected || expected.sequence !== event.sourceSeq) callbackOrderMatched = false;
    if (expected) latencyMs.push(performance.now() - expected.appendedAt);
    received.push(event.sourceSeq);
    const mappingStarted = performance.now();
    mapped.push(...bridge.map(event));
    mapMs += performance.now() - mappingStarted;
  }, error => errors.push(error));
  const watcherEvents: Array<{ event: string; filename: string | null }> = [];
  (observer as unknown as { watcher?: FSWatcher }).watcher?.on('change', (event, filename) => {
    watcherEvents.push({ event, filename: filename?.toString() ?? null });
  });
  const frame = (sourceSeq: number): OmpRuntimeObservation => ({
    version: 1, id: randomUUID(), sourceId: 'bounded-watch-fixture-source', sourceSeq,
    observedAt: Date.now(), elapsedMs: performance.now(), runId: 'watch-fixture-run',
    nativeSessionId: 'watch-fixture-session',
    agent: { kind: 'sub', id: 'watch-fixture-worker', name: 'fixture', depth: 1, parentId: 'Main' },
    cwd: root, hook: sourceSeq === 1 ? 'before_agent_start' : 'tool_execution_start',
    payload: sourceSeq === 1 ? { prompt: 'transport fixture', systemPrompt: [], tools: ['read'] }
      : { toolCallId: `watch-fixture-call-${sourceSeq}`, toolName: 'read', args: { path: '/fixture/input' } },
  });
  try {
    const sequences = Array.from({ length: 96 }, (_, index) => index + 1).filter(sequence => sequence !== 40);
    const physical: OmpRuntimeObservation[] = [];
    for (const sequence of sequences) {
      const event = frame(sequence);
      physical.push(event);
      if (sequence === 12 || sequence === 70) physical.push(event); // Exact physical replay.
    }
    let target = 0;
    const started = performance.now();
    for (let offset = 0; offset < physical.length; offset += 32) {
      const burst = physical.slice(offset, offset + 32);
      for (const event of burst) {
        pending.push({ sequence: event.sourceSeq, appendedAt: performance.now() });
        appendFileSync(observer.env.ROX_RUNTIME_OBSERVATION_PATH!, JSON.stringify(event) + '\n');
        highWaterFrames = Math.max(highWaterFrames, pending.length);
      }
      target += burst.length;
      // No manual drain: only the actual fs.watch callback delivers these frames.
      await waitFor(() => received.length === target, () => ({ target, received: received.length, pending: pending.length, errors: errors.map(error => error.message), watcherEvents }));
    }
    const deliveryMs = performance.now() - started;
    expect(errors).toHaveLength(0);
    expect(callbackOrderMatched).toBe(true);
    expect(received).toEqual(physical.map(event => event.sourceSeq));
    expect(pending).toHaveLength(0);
    expect(mapped.filter(event => event.kind === 'tool.started')).toHaveLength(sequences.length - 1);
    const gaps = mapped.filter(event => event.kind === 'trace.coverage' && event.payload.coverage.missing?.includes('native-source-gap'));
    expect(gaps).toHaveLength(1);
    expect(JSON.stringify(gaps)).toContain('40–40');
    expect(latencyMs.every(value => Number.isFinite(value) && value >= 0)).toBe(true);

    const oversized = frame(97);
    oversized.payload = { toolCallId: 'watch-fixture-over-limit', toolName: 'read', args: { data: 'x'.repeat(OMP_OBSERVATION_MAX_FRAME_BYTES + 1) } };
    const beforeQuota = received.length;
    appendFileSync(observer.env.ROX_RUNTIME_OBSERVATION_PATH!, JSON.stringify(oversized) + '\n');
    await waitFor(() => errors.length > 0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('Native observation frame exceeded limit');
    expect(received).toHaveLength(beforeQuota);
    expect(mapped.some(event => event.toolUseId === 'watch-fixture-over-limit')).toBe(false);

    const sorted = [...latencyMs].sort((a, b) => a - b);
    const percentile = (fraction: number): number => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
    const sourceAfter = fingerprints();
    expect(sourceAfter).toEqual(sourceBefore);
    const receipt = {
      class: 'actual-filesystem-watcher-and-production-bridge-with-bounded-fixture-frames',
      assertionsPassed: true,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceRevisionBefore: revisionBefore, sourceSha256: sourceAfter, measuredSourcesStable: true,
      clockScope: 'Bun performance.now() in one process, append initiation to actual observer callback; includes local scheduling and preceding drain work',
      environment: { platform: platform(), kernel: release(), bun: process.versions.bun, nodeCompatibility: process.versions.node,
        cpu: cpus()[0]?.model, availableParallelism: availableParallelism(), totalMemoryBytes: totalmem() },
      measurements: { physicalFrames: physical.length, uniqueSourceFrames: sequences.length, exactReplaysDroppedByBridge: 2,
        watcherNotifications: watcherEvents,
        sourceGap: { first: 40, last: 40, coverageEvents: gaps.length },
        appendedButUndeliveredFramesHighWater: highWaterFrames, queuedFramesAfterBursts: pending.length,
        deliveryMs, mapMs, appendToCallbackMs: { p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) },
        frameLimitBytes: OMP_OBSERVATION_MAX_FRAME_BYTES, oversizedFramesRejected: errors.length },
      limits: ['Controlled fixture frames exercise production filesystem transport and bridge, not SDK/provider execution.',
        'Measured local latency is not a global product budget or an installed-platform acceptance claim.',
        'The 64 MiB producer spool quota and emitter-count quota are not exercised by this bounded decoder test.'],
    };
    if (process.env.ROX_OBSERVER_WATCH_RECEIPT) writeFileSync(process.env.ROX_OBSERVER_WATCH_RECEIPT, JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt));
  } finally { observer.dispose(); rmSync(root, { recursive: true, force: true }); }
}, 10_000);
