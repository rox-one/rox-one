import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformFileSafely } from '../../../../../apps/electron/resources/skills/oh-my-agent/oma-hwp/resources/safe-file-transform';

const resources = resolve(import.meta.dir, '../../../../../apps/electron/resources/skills');
describe('vendored browser helper boundaries', () => {
  test('Impeccable fallback uses secure browser randomness or fails closed', () => {
    const root: any = {};
    runInNewContext(readFileSync(join(resources, 'impeccable/impeccable/scripts/live-browser-dom.js'), 'utf8'), { window: root });
    const create = root.__IMPECCABLE_LIVE_DOM__.createLiveBrowserDomHelpers;
    let calls = 0;
    const helpers = create({ prefix: 'test', document: {}, crypto: { getRandomValues(bytes: Uint8Array) {
      calls++; bytes.set([0, 1, 127, 255]); return bytes;
    } } });
    expect(helpers.id8()).toBe('00017fff');
    expect(calls).toBe(1);
    expect(() => create({ prefix: 'test', document: {}, crypto: {} }).id8()).toThrow('Secure browser randomness');
    expect(create({ prefix: 'test', document: {}, crypto: { randomUUID: () => '12345678-abcd' } }).id8()).toBe('12345678');
  });
  test('Impeccable detector accepts only messages from its own window and origin', () => {
    const source = readFileSync(join(resources, 'impeccable/impeccable/scripts/live-browser.js'), 'utf8');
    const start = source.indexOf('  function onDetectMessage(e) {');
    const end = source.indexOf('  /** Full teardown', start);
    expect(start).toBeGreaterThan(0);
    const window = { location: { origin: 'https://preview.test' } };
    const context: any = { window, detectReady: false, detectPendingScan: false, detectActive: false };
    const handler = runInNewContext(`${source.slice(start, end)}; onDetectMessage`, context);
    const data = { source: 'impeccable-ready' };
    handler({ source: {}, origin: window.location.origin, data });
    handler({ source: window, origin: 'https://evil.test', data });
    expect(context.detectReady).toBe(false);
    handler({ source: window, origin: window.location.origin, data });
    expect(context.detectReady).toBe(true);
  });
  test('presenter navigation requires same-origin parent and a valid index', () => {
    let handler: any;
    const navigated: number[] = [];
    const parent = {};
    const window = { parent, location: { origin: 'https://slides.test' }, addEventListener(type: string, fn: any) {
      if (type === 'message') handler = fn;
    } };
    runInNewContext(readFileSync(join(resources, 'oh-my-agent/oma-slide/resources/assets/deck-stage.js'), 'utf8'), {
      window, HTMLElement: class {}, customElements: { define() {} }, document: {
        addEventListener() {}, querySelector: () => ({ goTo: (n: number) => navigated.push(n) }),
      },
    });
    handler({ source: {}, origin: window.location.origin, data: { type: 'navigateTo', index: 1 } });
    handler({ source: parent, origin: 'https://evil.test', data: { type: 'navigateTo', index: 1 } });
    for (const index of [-1, NaN, Infinity, 1.5, 'bad']) handler({ source: parent, origin: window.location.origin, data: { type: 'navigateTo', index } });
    expect(navigated).toEqual([]);
    handler({ source: parent, origin: window.location.origin, data: { type: 'navigateTo', index: 2 } });
    expect(navigated).toEqual([2]);
  });
});

describe('document transform descriptor boundary', () => {
  test('updates UTF-8 content, truncates correctly and preserves permissions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-transform-'));
    try {
      const path = join(dir, 'doc.md');
      writeFileSync(path, 'long document', { mode: 0o600 });
      expect(await transformFileSafely(path, () => 'ёж')).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('ёж');
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(await transformFileSafely(path, value => value)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('rejects symlinks and a replacement pathname without touching either file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-transform-'));
    try {
      const path = join(dir, 'doc.md');
      const victim = join(dir, 'victim.md');
      writeFileSync(victim, 'victim'); symlinkSync(victim, path);
      await expect(transformFileSafely(path, () => 'bad')).rejects.toThrow();
      expect(readFileSync(victim, 'utf8')).toBe('victim');
      rmSync(path); writeFileSync(path, 'original');
      await expect(transformFileSafely(path, () => {
        renameSync(path, join(dir, 'original.md')); symlinkSync(victim, path); return 'bad';
      })).rejects.toThrow('Document changed');
      expect(readFileSync(victim, 'utf8')).toBe('victim');
      expect(readFileSync(join(dir, 'original.md'), 'utf8')).toBe('original');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('failed transformation preserves original contents', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-transform-'));
    try {
      const path = join(dir, 'doc.md'); writeFileSync(path, 'original');
      await expect(transformFileSafely(path, () => { throw new Error('transform failed'); })).rejects.toThrow('transform failed');
      expect(readFileSync(path, 'utf8')).toBe('original');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
