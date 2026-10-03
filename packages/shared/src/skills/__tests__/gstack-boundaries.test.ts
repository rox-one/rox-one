import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dir, '../../../../..');
const vendor = path.join(root, 'apps/electron/resources/skills/gstack/gstack');
const sandbox = () => fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'rox-gstack-boundary-')));

test('Graphify status parses bounded regular graphs and skips oversized or linked graphs', async () => {
  const { GraphifyProvider } = await import(path.join(vendor, 'lib/code-intelligence/graphify-adapter.ts'));
  const dir = sandbox();
  try {
    fs.mkdirSync(path.join(dir, 'graphify-out'));
    const graph = path.join(dir, 'graphify-out/graph.json');
    fs.writeFileSync(graph, JSON.stringify({ nodes: [{}, {}] }));
    const provider = new GraphifyProvider({ root: dir });
    expect((await provider.status()).itemCount).toBe(2);
    const fd = fs.openSync(graph, 'w'); fs.ftruncateSync(fd, 6 * 1024 * 1024); fs.closeSync(fd);
    const oversized = await provider.status();
    expect(oversized.itemCount).toBeUndefined();
    expect(oversized.detail).toContain('node count skipped');
    fs.unlinkSync(graph);
    const outside = path.join(dir, 'outside.json'); fs.writeFileSync(outside, '{"nodes":[{}]}');
    fs.symlinkSync(outside, graph);
    expect((await provider.status()).itemCount).toBeUndefined();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memory snapshot bounds sources and artifact body/hash/size refer to the same bytes', async () => {
  const { readSourceSnapshot, SOURCE_READ_MAX_BYTES, buildArtifactPage, parseTranscriptJsonl } = await import(path.join(vendor, 'bin/gstack-memory-ingest.ts'));
  const dir = sandbox();
  try {
    const source = path.join(dir, 'artifact.md'); const text = '# Authored memory\nTail content';
    fs.writeFileSync(source, text);
    const snapshot = readSourceSnapshot(source);
    expect(snapshot.bytes.toString()).toBe(text);
    expect(snapshot.size).toBe(Buffer.byteLength(text));
    const page = buildArtifactPage(source, 'learning', undefined, snapshot);
    expect(page.body).toBe(text);
    expect(page.content_sha256).toBe(createHash('sha256').update(text).digest('hex'));
    expect(page.size_bytes).toBe(snapshot.size);
    const oversized = path.join(dir, 'large.jsonl');
    const fd = fs.openSync(oversized, 'w'); fs.ftruncateSync(fd, SOURCE_READ_MAX_BYTES + 1); fs.closeSync(fd);
    expect(() => readSourceSnapshot(oversized)).toThrow();
    expect(parseTranscriptJsonl(oversized)).toBeNull();
    const link = path.join(dir, 'linked.md'); fs.symlinkSync(source, link);
    expect(() => readSourceSnapshot(link)).toThrow();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('import failure tail is bounded and unsafe/unverifiable output prevents state advancement', async () => {
  const { readNewFailures } = await import(path.join(vendor, 'bin/gstack-memory-ingest.ts'));
  const { readBoundedRangeStable } = await import(path.join(vendor, 'lib/cso/bounded-range-file.ts'));
  const dir = sandbox();
  try {
    const log = path.join(dir, 'failures.jsonl');
    const sources = new Map([['one.md', '/source/one'], ['two.md', '/source/two']]);
    const previous = JSON.stringify({ path: 'one.md' }) + '\n';
    fs.writeFileSync(log, previous + JSON.stringify({ path: 'two.md' }) + '\n');
    expect([...readNewFailures(log, Buffer.byteLength(previous), sources)]).toEqual(['/source/two']);
    expect(readBoundedRangeStable(log, Buffer.byteLength(previous), 1024, 'Test tail').toString()).toContain('two.md');
    expect(() => readBoundedRangeStable(log, 0, 1, 'Test tail')).toThrow();
    expect(() => readBoundedRangeStable(log, -1, 1024, 'Test tail')).toThrow();
    expect([...readNewFailures(log, 999999, sources)]).toEqual([...sources.values()]);
    const linked = path.join(dir, 'linked.jsonl'); fs.symlinkSync(log, linked);
    expect([...readNewFailures(linked, 0, sources)]).toEqual([...sources.values()]);
    const oversized = path.join(dir, 'oversized.jsonl');
    const fd = fs.openSync(oversized, 'w'); fs.ftruncateSync(fd, 16 * 1024 * 1024 + 1); fs.closeSync(fd);
    expect([...readNewFailures(oversized, 0, sources)]).toEqual([...sources.values()]);
    expect([...readNewFailures(path.join(dir, 'absent'), 0, sources)]).toEqual([]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('dream-marker cleanup refuses symlinks and leaves another owner intact', async () => {
  const sync = await import(path.join(vendor, 'bin/gstack-gbrain-sync.ts'));
  const dir = sandbox(), previous = process.env.GSTACK_STATE_ROOT;
  process.env.GSTACK_STATE_ROOT = dir;
  try {
    const marker = sync.dreamMarkerPath();
    const target = path.join(dir, 'not-a-marker');
    fs.writeFileSync(target, JSON.stringify({ pid: process.pid }));
    fs.symlinkSync(target, marker);
    sync.releaseDreamMarker();
    expect(fs.lstatSync(marker).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
    fs.unlinkSync(marker); fs.writeFileSync(marker, JSON.stringify({ pid: process.pid + 100000 }));
    sync.releaseDreamMarker(); expect(fs.existsSync(marker)).toBe(true);
    fs.unlinkSync(marker);
    expect(sync.acquireDreamMarker()).toBe(true);
    const owned = JSON.parse(fs.readFileSync(marker, 'utf8'));
    expect(owned.generation).toMatch(/^[a-f0-9-]{36}$/);
    if (process.platform !== 'win32') expect(fs.statSync(marker).mode & 0o777).toBe(0o600);
    expect(sync.acquireDreamMarker()).toBe(false);
    const replacement = JSON.stringify({ ...owned, generation: 'different-generation' });
    fs.writeFileSync(marker, replacement);
    sync.releaseDreamMarker(); expect(fs.readFileSync(marker, 'utf8')).toBe(replacement);
    fs.unlinkSync(marker);
    const mutex = marker + '.mutation-lock'; fs.mkdirSync(mutex);
    expect(sync.acquireDreamMarker()).toBe(false); expect(fs.existsSync(marker)).toBe(false);
    fs.rmdirSync(mutex);
    expect(sync.acquireDreamMarker()).toBe(true);
    fs.mkdirSync(mutex); sync.releaseDreamMarker(); expect(fs.existsSync(marker)).toBe(true);
    fs.rmdirSync(mutex); sync.releaseDreamMarker(); expect(fs.existsSync(marker)).toBe(false);
    const old = JSON.stringify({ pid: process.pid, started_at: '2000-01-01' });
    fs.writeFileSync(marker, old); fs.utimesSync(marker, new Date(0), new Date(0));
    expect(sync.acquireDreamMarker()).toBe(false); expect(fs.readFileSync(marker, 'utf8')).toBe(old);
  } finally {
    if (previous === undefined) delete process.env.GSTACK_STATE_ROOT; else process.env.GSTACK_STATE_ROOT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gbrain capability CLI refuses oversized and linked source/state before invoking external gbrain', () => {
  const dir = sandbox();
  try {
    const repo = path.join(dir, 'repo'), stateRoot = path.join(dir, 'state'); fs.mkdirSync(repo); fs.mkdirSync(stateRoot);
    execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore' });
    const pin = path.join(repo, '.gbrain-source'), state = path.join(stateRoot, '.gbrain-sync-state.json');
    fs.writeFileSync(pin, 'a'.repeat(513)); fs.writeFileSync(state, '{}');
    const check = () => JSON.parse(execFileSync(process.execPath, [path.join(vendor, 'bin/gstack-gbrain-read-capability.ts')], {
      cwd: repo, env: { PATH: process.env.PATH, HOME: dir, GSTACK_STATE_ROOT: stateRoot }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
    }));
    expect(check().status).toBe('unknown');
    fs.writeFileSync(pin, 'valid-source'); fs.writeFileSync(state, ' '.repeat(64 * 1024 + 1));
    expect(check().status).toBe('unknown');
    fs.unlinkSync(state); const outside = path.join(dir, 'private.json'); fs.writeFileSync(outside, '{"PRIVATE_SENTINEL":true}'); fs.symlinkSync(outside, state);
    const verdict = check(); expect(verdict.status).toBe('unknown'); expect(JSON.stringify(verdict)).not.toContain('PRIVATE_SENTINEL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('secret-scan report rejects oversize/linked output and preserves real scanner functionality', async () => {
  const helpers = await import(path.join(vendor, 'lib/gstack-memory-helpers.ts'));
  const dir = sandbox(), priorPath = process.env.PATH, priorMode = process.env.ROX_FAKE_SCAN_MODE;
  try {
    const source = path.join(dir, 'source.md'); fs.writeFileSync(source, 'local authored text');
    const fixture = path.join(dir, 'gitleaks');
    fs.writeFileSync(fixture, `#!${process.execPath}\nimport fs from 'node:fs';
if (process.argv.includes('version')) process.exit(0);
const report=process.argv[process.argv.indexOf('--report-path')+1];
if(process.env.ROX_FAKE_SCAN_MODE==='large'){const fd=fs.openSync(report,'w');fs.ftruncateSync(fd,16*1024*1024+1);fs.closeSync(fd)}
else if(process.env.ROX_FAKE_SCAN_MODE==='link'){fs.unlinkSync(report);fs.symlinkSync(process.argv[process.argv.indexOf('--source')+1],report)}
else fs.writeFileSync(report,JSON.stringify([{RuleID:'test-rule',Description:'Test finding',StartLine:1,Secret:'TEST_ONLY_VALUE'}]));\n`, { mode: 0o700 });
    process.env.PATH = dir + path.delimiter + priorPath;
    helpers._resetGitleaksAvailabilityCache();
    process.env.ROX_FAKE_SCAN_MODE = 'normal';
    const valid = helpers.secretScanFile(source);
    expect(valid.scanned).toBe(true); expect(valid.findings.length).toBe(1);
    expect(JSON.stringify(valid)).not.toContain('TEST_ONLY_VALUE');
    for (const mode of ['large', 'link']) {
      process.env.ROX_FAKE_SCAN_MODE = mode;
      const invalid = helpers.secretScanFile(source);
      expect(invalid.scanned).toBe(false); expect(invalid.scanner).toBe('error');
      expect(fs.readFileSync(source, 'utf8')).toBe('local authored text');
    }
  } finally {
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    if (priorMode === undefined) delete process.env.ROX_FAKE_SCAN_MODE; else process.env.ROX_FAKE_SCAN_MODE = priorMode;
    helpers._resetGitleaksAvailabilityCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bounded failure-range descriptor detects replacement after open and growth during read', async () => {
  const { readBoundedRangeStable } = await import(path.join(vendor, 'lib/cso/bounded-range-file.ts'));
  const dir = sandbox();
  const originalOpen = fs.openSync, originalRead = fs.readSync;
  try {
    const log = path.join(dir, 'failures.jsonl'); fs.writeFileSync(log, 'original');
    let intercepted = false;
    fs.openSync = ((file: any, ...args: any[]) => {
      const fd = (originalOpen as any)(file, ...args);
      if (file === log) { intercepted = true; fs.unlinkSync(log); fs.writeFileSync(log, 'replacement'); }
      return fd;
    }) as typeof fs.openSync;
    expect(() => readBoundedRangeStable(log, 0, 1024, 'Race test')).toThrow();
    expect(intercepted).toBe(true);
    fs.openSync = originalOpen;
    fs.writeFileSync(log, 'stable-before-read');
    let changed = false;
    fs.readSync = ((...args: any[]) => {
      const count = (originalRead as any)(...args);
      if (!changed) { changed = true; fs.appendFileSync(log, ' grew'); }
      return count;
    }) as typeof fs.readSync;
    expect(() => readBoundedRangeStable(log, 0, 1024, 'Race test')).toThrow();
    expect(changed).toBe(true);
  } finally {
    fs.openSync = originalOpen; fs.readSync = originalRead;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bounded failure range preserves bigint file IDs beyond Number precision', async () => {
  const { readBoundedRangeStable } = await import(path.join(vendor, 'lib/cso/bounded-range-file.ts'));
  const dir = sandbox(), fstat = fs.fstatSync, lstat = fs.lstatSync;
  const lstatMock = spyOn(fs, 'lstatSync');
  try {
    const file = path.join(dir, 'log'); fs.writeFileSync(file, 'data');
    const identity = 9007199254740992n; let observedBigint = false;
    fs.fstatSync = ((fd: any, options: any) => {
      observedBigint = options?.bigint === true;
      const stat = (fstat as any)(fd, options);
      return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino: identity });
    }) as typeof fs.fstatSync;
    lstatMock.mockImplementation(((name: any, options: any) => {
      const stat = (lstat as any)(name, options);
      return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino: identity + 1n });
    }) as typeof fs.lstatSync);
    expect(() => readBoundedRangeStable(file, 0, 32, 'Full-width identity')).toThrow();
    expect(observedBigint).toBe(true);
    expect(Number(identity)).toBe(Number(identity + 1n));
    fs.fstatSync = fstat; lstatMock.mockRestore();
    expect(() => readBoundedRangeStable(file, Number.MAX_SAFE_INTEGER + 1, 32, 'Invalid offset')).toThrow();
    expect(() => readBoundedRangeStable(file, 0, Number.MAX_SAFE_INTEGER + 1, 'Invalid cap')).toThrow();
  } finally { fs.fstatSync = fstat; lstatMock.mockRestore(); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const copy of ['gstack']) test(`PDF image confinement binds the checked path to the opened file (${copy || 'flat'})`, async () => {
  const { inlineLocalImages } = await import(path.join(root, 'apps/electron/resources/skills/gstack', copy, 'make-pdf/src/diagram-prepass.ts'));
  const dir = sandbox(); const image = path.join(dir, 'image.svg');
  const original = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  fs.writeFileSync(image, original);
  const options = { inputDir: dir, strict: true, allowNetwork: false, contentWidthIn: 6, warn() {}, run: null };
  const namespace = await import('node:fs');
  const open = namespace.openSync; const openMock = spyOn(namespace, 'openSync');
  let replaced = false;
  try {
    openMock.mockImplementation(((name: any, flags: any, mode: any) => {
      if (name === image && !replaced) {
        replaced = true; fs.renameSync(image, image + '.old'); fs.writeFileSync(image, '<svg>replacement</svg>');
      }
      return open(name, flags, mode);
    }) as typeof fs.openSync);
    const result = inlineLocalImages('<img src="image.svg">', options);
    expect(replaced).toBe(true);
    await expect(result).rejects.toThrow('changed after confinement');
    openMock.mockRestore();
    fs.writeFileSync(image, original);
    expect(await inlineLocalImages('<img src="image.svg">', options)).toContain('data:image/svg+xml;base64,');
  } finally { openMock.mockRestore(); fs.rmSync(dir, { recursive: true, force: true }); }
});
