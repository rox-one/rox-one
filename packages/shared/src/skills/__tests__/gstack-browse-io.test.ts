import { expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const pack = resolve(import.meta.dir, '../../../../../apps/electron/resources/skills/gstack');

for (const copy of ['', 'gstack']) {
  const root = join(pack, copy, 'browse/src');
  const { writeEvalResult, handleReadCommand } = await import(join(root, 'read-commands.ts'));
  const { handleWriteCommand } = await import(join(root, 'write-commands.ts'));
  const { guardScreenshotPath } = await import(join(root, 'screenshot-size-guard.ts'));
  const { acquireAgentStateLock } = await import(join(root, 'terminal-agent-control.ts'));
  test(`browser evaluate output preserves text/base64 but rejects victim links (${copy || 'flat'})`, () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'rox-browse-output-'));
    try {
      const file = join(dir, 'result'), victim = join(dir, 'victim');
      expect(writeEvalResult(file, 'data:image/png;base64,aGVsbG8=', { raw: false })).toBe(5);
      expect(fs.readFileSync(file, 'utf8')).toBe('hello'); expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(writeEvalResult(file, 'ёж', { raw: true })).toBe(4);
      expect(fs.readFileSync(file, 'utf8')).toBe('ёж');
      fs.writeFileSync(victim, 'victim'); fs.rmSync(file); fs.symlinkSync(victim, file);
      expect(() => writeEvalResult(file, 'bad', { raw: true })).toThrow();
      expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test(`actual HTML and eval dispatch use bounded descriptors before browser delivery (${copy || 'flat'})`, async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'rox-browse-input-'));
    try {
      const file = join(dir, 'page.html'), json = join(dir, 'page.json'), code = join(dir, 'script.js');
      const delivered: string[] = [];
      const page = { url: () => 'https://fixture.test', evaluate: async (body: string) => { delivered.push(body); return 'fixture'; } };
      const session = { getPage: () => page, getActiveFrameOrPage: () => page, getFrame: () => null,
        setTabContent: async (html: string) => { delivered.push(html); } };
      const bm = { hasCookieImports: () => false };
      fs.writeFileSync(file, '<p>Hello</p>'); fs.writeFileSync(json, JSON.stringify({ html: '<p>Inline</p>' })); fs.writeFileSync(code, '1 + 1');
      expect(await handleWriteCommand('load-html', [file], session, bm)).toContain('Loaded HTML');
      expect(delivered.at(-1)).toBe('<p>Hello</p>');
      await handleWriteCommand('load-html', ['--from-file', json], session, bm);
      expect(delivered.at(-1)).toBe('<p>Inline</p>');
      expect(await handleReadCommand('eval', [code], session, bm)).toBe('fixture');
      const count = delivered.length;
      fs.rmSync(file); fs.symlinkSync(json, file); fs.rmSync(code); fs.symlinkSync(json, code);
      await expect(handleWriteCommand('load-html', [file], session, bm)).rejects.toThrow();
      await expect(handleReadCommand('eval', [code], session, bm)).rejects.toThrow();
      expect(delivered.length).toBe(count);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test(`screenshot input and publication lock never follow attacker links (${copy || 'flat'})`, async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'rox-browse-lock-'));
    try {
      const victim = join(dir, 'victim'), screenshot = join(dir, 'shot.png'), lock = join(dir, 'terminal-agent-pid.lock');
      fs.writeFileSync(victim, 'victim'); fs.symlinkSync(victim, screenshot);
      await expect(guardScreenshotPath(screenshot)).rejects.toThrow();
      fs.symlinkSync(victim, lock);
      expect(() => acquireAgentStateLock(dir, 0)).toThrow('state lock unavailable');
      expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
      fs.rmSync(lock); const release = acquireAgentStateLock(dir, 0);
      expect(fs.statSync(lock).mode & 0o777).toBe(0o600);
      fs.renameSync(lock, join(dir, 'old-lock')); fs.writeFileSync(lock, 'another owner');
      release(); expect(fs.readFileSync(lock, 'utf8')).toBe('another owner');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
