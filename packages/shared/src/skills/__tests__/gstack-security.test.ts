import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const resources = resolve(import.meta.dir, '../../../../../apps/electron/resources/skills/gstack');
for (const copy of ['', 'gstack']) {
  const root = join(resources, copy);
  const { sanitizeParsedHtml, sanitizeDiagramSvg } = await import(join(root, 'make-pdf/src/safe-html.ts'));
  const { appendSecureFile, writeSecureFile } = await import(join(root, 'browse/src/file-permissions.ts'));
  describe(`gstack security ${copy || 'flat'}`, () => {
    test('malformed and nested executable markup cannot survive reconstruction', () => {
      for (const input of [
        '<scr<script>ipt>alert(1)</scr<script>ipt>',
        '<svg><foreignObject><p onload="alert(1)">bad</p></foreignObject></svg>',
        '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
        '<iframe srcdoc="<script>alert(1)</script>">bad</iframe>',
        '<style>@import "https://invalid.test/secret";</style>',
        '<img src="java&#x73;cript:alert(1)" onerror=alert(1)>',
        '<a href="java&#10;script:alert(1)">x</a>',
        '<img src="data:image/svg+xml;base64,AAA=">',
      ]) {
        const html = sanitizeParsedHtml(input);
        expect(html).not.toMatch(/<(?:script|svg|math|iframe|style)\b/i);
        expect(html).not.toMatch(/\s(?:on\w+|srcdoc|style)=/i);
        expect(html).not.toMatch(/(?:href|src)="(?:javascript|data:image\/svg)/i);
      }
    });
    test('ordinary document markup, links, image directives and escaped text survive', () => {
      expect(sanitizeParsedHtml('<h1>A &amp; B</h1><p><strong>Hello</strong> &lt;script&gt;</p><img src="plot.png" data-gstack-width="50%"><a href="https://example.com">link</a>'))
        .toBe('<h1>A &amp; B</h1><p><strong>Hello</strong> &lt;script&gt;</p><img src="plot.png" data-gstack-width="50%"><a href="https://example.com">link</a>');
    });
    test('SVG diagrams preserve geometry and local references without executable foreign content', () => {
      const svg = sanitizeDiagramSvg('<svg viewBox="0 0 40 40"><defs><marker id="arrow"><path d="M 0 0 L 4 2"/></marker></defs><path d="M 1 1 L 20 20" marker-end="url(#arrow)"/><text>Hello &amp; goodbye</text><foreignObject><p onload="evil()">bad</p></foreignObject><script>evil()</script><image href="https://invalid.test"/><a href="javascript:evil()">bad</a></svg>');
      expect(svg).toContain('<svg viewbox="0 0 40 40">');
      expect(svg).toContain('marker-end="url(#arrow)"');
      expect(svg).toContain('Hello &amp; goodbye');
      expect(svg).not.toMatch(/<(?:script|foreignobject|image|a)\b|javascript:|https:\/\/invalid|onload=/i);
    });
    test('render cannot reopen escaped attribute quotes after sanitization', async () => {
      const { render } = await import(join(root, 'make-pdf/src/render.ts'));
      const result = render({ markdown: '<p title="&quot; onclick=&quot;evil()">Hello</p>', cover: false });
      expect(result.html).not.toContain('title="" onclick="evil()"');
      expect(result.bodyHtml).toContain('&quot;');
    });
    test('private write and append tighten existing file and reject symlink target', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rox-gstack-test-'));
      try {
        const target = join(dir, 'state');
        writeFileSync(target, 'old', { mode: 0o644 });
        writeSecureFile(target, 'new');
        appendSecureFile(target, '+append');
        expect(readFileSync(target, 'utf8')).toBe('new+append');
        if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o600);
        const link = join(dir, 'link');
        symlinkSync(target, link);
        expect(() => writeSecureFile(link, 'clobber')).toThrow();
        expect(() => appendSecureFile(link, 'clobber')).toThrow();
        expect(readFileSync(target, 'utf8')).toBe('new+append');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    test('temporary output and editor use private unique directories and exclusive writes', () => {
      const orchestrator = readFileSync(join(root, 'make-pdf/src/orchestrator.ts'), 'utf8');
      const editor = readFileSync(join(root, 'browse/src/domain-skill-commands.ts'), 'utf8');
      expect(orchestrator).toContain('fs.mkdtempSync(path.join(os.tmpdir(), "gstack-make-pdf-"))');
      expect(orchestrator).toContain('fs.fchmodSync(fd, 0o600)');
      expect(editor).toContain("fs.mkdtemp(path.join(os.tmpdir(), 'gstack-domain-skill-'))");
      expect(editor).toContain("flag: 'wx', mode: 0o600");
      expect(editor).toContain('finally');
    });
  });
}

describe('gstack shared file boundaries', () => {
  test('bounded stable reads refuse links and oversized files', async () => {
    const { readBoundedStable } = await import(join(resources, 'gstack/lib/cso/bounded-file.ts'));
    const dir = mkdtempSync(join(tmpdir(), 'rox-gstack-bounded-'));
    try {
      const file = join(dir, 'input');
      writeFileSync(file, 'small');
      expect(readBoundedStable(file, 10, 'input').toString()).toBe('small');
      expect(() => readBoundedStable(file, 2, 'input')).toThrow();
      const link = join(dir, 'link');
      symlinkSync(file, link);
      expect(() => readBoundedStable(link, 10, 'input')).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('atomic writes privately replace the link itself and leave its target intact', async () => {
    const { atomicWriteSync } = await import(join(resources, 'gstack/lib/fs-atomic.ts'));
    const dir = mkdtempSync(join(tmpdir(), 'rox-gstack-atomic-'));
    try {
      const target = join(dir, 'target');
      const output = join(dir, 'output');
      writeFileSync(target, 'preserved');
      symlinkSync(target, output);
      atomicWriteSync(output, 'replacement');
      expect(readFileSync(target, 'utf8')).toBe('preserved');
      expect(readFileSync(output, 'utf8')).toBe('replacement');
      if (process.platform !== 'win32') expect(statSync(output).mode & 0o777).toBe(0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});


test('canonical pytest plan rejects quoted count-suppressing addopts but admits normal flags', async () => {
  const { canonicalTestPlan } = await import(join(resources, 'gstack/lib/cso/verification.ts'));
  const dir = mkdtempSync(join(tmpdir(), 'rox-gstack-pytest-'));
  try {
    writeFileSync(join(dir, 'test_example.py'), 'def test_example():\n    assert True\n');
    for (const config of ['[pytest]\naddopts="-qq"\n', "[pytest]\naddopts='-qqq'\n", '[pytest]\naddopts = -qq\n']) {
      writeFileSync(join(dir, 'pytest.ini'), config);
      expect(() => canonicalTestPlan(dir, 'python')).toThrow();
    }
    writeFileSync(join(dir, 'pytest.ini'), '[pytest]\naddopts="-q"\n');
    expect(() => canonicalTestPlan(dir, 'python')).not.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('capture identifiers are matched literally rather than as regular expressions', async () => {
  const { anchoredOn } = await import(join(resources, 'gstack/lib/qa-evidence.ts'));
  expect(anchoredOn('tool capture root abc.*', 'abc.*')).toBe(true);
  expect(anchoredOn('tool capture root abcXYZ', 'abc.*')).toBe(false);
  expect(anchoredOn('tool capture root normal-id', 'normal-id')).toBe(true);
});
