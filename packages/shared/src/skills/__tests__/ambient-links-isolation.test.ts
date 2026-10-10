/**
 * Ambient skill-link isolation
 *
 * The ambient (startup) sync links application-owned skills into the user's
 * REAL home catalog (`~/.agents/skills`) — a PRIMARY-install feature. Isolation
 * is a resolved location, not the presence of an override: an instance whose
 * config root resolves to a DIFFERENT directory than the one a plain launch
 * would use (benches, e2e runs, dev instances) must lose the ambient link
 * target so it never writes into the shared home, while an override that
 * merely pins the real root (the app's supervised service sets exactly that)
 * keeps publishing.
 *
 * Covered here:
 * - unit: `ambientSkillLinksRoot()` keeps the real home catalog when no
 *   override is set AND when the override pins the default root (absolute,
 *   `~/`-relative or trailing-slash spelling), and returns null when the
 *   override roots anywhere else.
 * - unit: `resolveBundledSkillsTarget()` derives `linksRoot` from the same
 *   rule, while an explicit `linksRoot`/`targetRoot` keeps its documented
 *   meaning.
 * - end-to-end: three subprocesses with a synthetic HOME prove a primary
 *   install links into `~/.agents/skills`, a root-pinned install does too, and
 *   an isolated install materializes skills under its own root WITHOUT
 *   creating `~/.agents`.
 *
 * Env is manipulated deterministically inside the process; the end-to-end
 * checks spawn plain `bun <script>` children, which do NOT receive the bunfig
 * `[test].preload`, so the child env is self-contained.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join } from 'path';
import { ambientSkillLinksRoot, GLOBAL_AGENT_SKILLS_DIR } from '../storage.ts';
import { resolveBundledSkillsTarget } from '../bundled.ts';
import { resolveConfigDir } from '../../config/env.ts';
import { isSkillLinkTo } from '../managed.ts';

const REPO_ROOT = join(dirname(import.meta.dir), '..', '..', '..', '..');

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ambient-links-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run `body` with both config-root overrides forced to `value` (undefined
 * deletes them), then restore the originals — including the preload-provided
 * values an isolated `bun test` process starts with.
 */
function withConfigEnv(value: string | undefined, body: () => void): void {
  const prevRox = process.env.ROX_CONFIG_DIR;
  const prevCraft = process.env.CRAFT_CONFIG_DIR;
  const set = (key: string, next: string | undefined): void => {
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  };
  try {
    set('ROX_CONFIG_DIR', value);
    set('CRAFT_CONFIG_DIR', value);
    body();
  } finally {
    set('ROX_CONFIG_DIR', prevRox);
    set('CRAFT_CONFIG_DIR', prevCraft);
  }
}

// ============================================================
// Unit: the ambient link root itself
// ============================================================

/**
 * The config root this process would resolve with the override removed — the
 * "default" side of the ambient-link decision.
 */
function defaultConfigRoot(): string {
  return resolveConfigDir({ ...process.env, ROX_CONFIG_DIR: undefined, CRAFT_CONFIG_DIR: undefined });
}

describe('ambientSkillLinksRoot', () => {
  it('returns null when an explicit config root is set', () => {
    withConfigEnv(join(tempDir(), '.rox-iso'), () => {
      expect(ambientSkillLinksRoot()).toBeNull();
    });
  });

  it('returns the real home catalog when neither config override is set', () => {
    withConfigEnv('', () => {
      expect(ambientSkillLinksRoot()).toBe(GLOBAL_AGENT_SKILLS_DIR);
    });
  });

  it('keeps the home catalog when the override pins the default config root', () => {
    withConfigEnv(defaultConfigRoot(), () => {
      expect(ambientSkillLinksRoot()).toBe(GLOBAL_AGENT_SKILLS_DIR);
    });
  });

  it('accepts `~/`-relative and trailing-slash spellings of the default root', () => {
    const root = defaultConfigRoot();
    withConfigEnv(`${root}/`, () => {
      expect(ambientSkillLinksRoot()).toBe(GLOBAL_AGENT_SKILLS_DIR);
    });
    withConfigEnv(`~${root.slice(homedir().length)}`, () => {
      expect(ambientSkillLinksRoot()).toBe(GLOBAL_AGENT_SKILLS_DIR);
    });
  });

  it('still isolates an override rooted elsewhere under the home directory', () => {
    withConfigEnv(join(homedir(), '.rox-ambient-links-iso'), () => {
      expect(ambientSkillLinksRoot()).toBeNull();
    });
  });
});

// ============================================================
// Unit: resolveBundledSkillsTarget derives the same linksRoot rule
// ============================================================

describe('resolveBundledSkillsTarget linksRoot', () => {
  it('defaults to no links when the config root is overridden', () => {
    withConfigEnv(join(tempDir(), '.rox-iso'), () => {
      expect(resolveBundledSkillsTarget().linksRoot).toBeNull();
    });
  });

  it('keeps the home catalog when the config root is pinned to the default', () => {
    withConfigEnv(defaultConfigRoot(), () => {
      expect(resolveBundledSkillsTarget().linksRoot).toBe(GLOBAL_AGENT_SKILLS_DIR);
    });
  });

  it('keeps an explicit linksRoot untouched', () => {
    withConfigEnv(join(tempDir(), '.rox-iso'), () => {
      expect(resolveBundledSkillsTarget({ linksRoot: '/custom-links' }).linksRoot).toBe('/custom-links');
    });
  });

  it('defaults to no links when an explicit targetRoot is provided', () => {
    withConfigEnv('', () => {
      expect(resolveBundledSkillsTarget({ targetRoot: '/custom-target' }).linksRoot).toBeNull();
    });
  });
});

// ============================================================
// End-to-end: primary vs. isolated instance, synthetic HOME
// ============================================================

/** Minimal single-pack bundle fixture: pack 'superpowers' shipping skill 'alpha'. */
function seedFixture(root: string): string {
  const fixture = join(root, 'fixture');
  writeFile(
    fixture,
    'superpowers/alpha/SKILL.md',
    '---\nname: alpha\ndescription: A test skill\n---\n\nBody alpha\n',
  );
  writeFile(
    fixture,
    'SKILLS.lock',
    JSON.stringify({
      version: 1,
      packs: [
        { slug: 'superpowers', origin: 'https://example.test/superpowers', commit: 'sha-v1', skills: ['alpha'] },
      ],
    }),
  );
  return fixture;
}

/**
 * Probe script mirroring the ambient startup call (no `targetRoot` option) and
 * printing one JSON line with the resolved target/link roots and installed
 * skills.
 */
function writeProbe(dir: string, bundleRoot: string): string {
  const scriptPath = join(dir, 'ambient-probe.ts');
  writeFileSync(
    scriptPath,
    [
      `import { ensureBundledSkills, resolveBundledSkillsTarget } from ${JSON.stringify(join(REPO_ROOT, 'packages/shared/src/skills/bundled.ts'))};`,
      `const bundleRoot = ${JSON.stringify(bundleRoot)};`,
      `const resolved = resolveBundledSkillsTarget({ bundleRoot });`,
      `const result = ensureBundledSkills({ bundleRoot });`,
      `console.log(JSON.stringify({ targetRoot: result.targetRoot, linksRoot: resolved.linksRoot, installed: result.packs.flatMap(p => p.installed) }));`,
    ].join('\n'),
    'utf-8',
  );
  return scriptPath;
}

interface ProbeOutput {
  targetRoot: string;
  linksRoot: string | null;
  installed: string[];
}

function runProbe(scriptPath: string, env: Record<string, string | undefined>, cwd: string): ProbeOutput {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    env: { ...process.env, ...env },
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(proc.exitCode, proc.stderr.toString()).toBe(0);
  const lines = proc.stdout.toString().trim().split('\n');
  return JSON.parse(lines[lines.length - 1]!) as ProbeOutput;
}

describe('ambient link isolation end-to-end', () => {
  it('primary instance links into the real home catalog', () => {
    const root = tempDir();
    const home = join(root, 'home1');
    mkdirSync(home, { recursive: true });
    const fixture = seedFixture(root);
    const scriptPath = writeProbe(root, fixture);

    const out = runProbe(scriptPath, {
      HOME: home,
      ROX_CONFIG_DIR: undefined,
      CRAFT_CONFIG_DIR: undefined,
    }, home);

    expect(out.targetRoot).toBe(join(home, '.rox', 'skills'));
    expect(out.linksRoot).toBe(join(home, '.agents', 'skills'));
    expect(out.installed).toEqual(['alpha']);
    expect(isSkillLinkTo(join(home, '.agents', 'skills', 'alpha'), join(home, '.rox', 'skills', 'alpha'))).toBe(true);
  });

  it('isolated instance never writes into the real home catalog', () => {
    const root = tempDir();
    const home = join(root, 'home2');
    mkdirSync(home, { recursive: true });
    const isoConfig = join(home, '.rox-iso');
    const fixture = seedFixture(root);
    const scriptPath = writeProbe(root, fixture);

    const out = runProbe(scriptPath, {
      HOME: home,
      ROX_CONFIG_DIR: isoConfig,
      CRAFT_CONFIG_DIR: undefined,
    }, home);

    expect(out.linksRoot).toBeNull();
    expect(out.targetRoot).toBe(join(home, '.rox-iso', 'skills'));
    expect(out.installed).toEqual(['alpha']);
    expect(existsSync(join(home, '.agents'))).toBe(false);
    // Skills are still materialized under the instance's own root.
    expect(existsSync(join(out.targetRoot, 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('instance whose override pins the default root still links into the home catalog', () => {
    const root = tempDir();
    const home = join(root, 'home3');
    mkdirSync(home, { recursive: true });
    const fixture = seedFixture(root);
    const scriptPath = writeProbe(root, fixture);

    // A fresh home has no visible `~/rox`, so its default root is `<home>/.rox`
    // — the exact directory the app's supervised service pins via
    // ROX_CONFIG_DIR. Pinning is not isolation.
    const out = runProbe(scriptPath, {
      HOME: home,
      ROX_CONFIG_DIR: join(home, '.rox'),
      CRAFT_CONFIG_DIR: undefined,
    }, home);

    expect(out.targetRoot).toBe(join(home, '.rox', 'skills'));
    expect(out.linksRoot).toBe(join(home, '.agents', 'skills'));
    expect(out.installed).toEqual(['alpha']);
    expect(isSkillLinkTo(join(home, '.agents', 'skills', 'alpha'), join(home, '.rox', 'skills', 'alpha'))).toBe(true);
  });
});