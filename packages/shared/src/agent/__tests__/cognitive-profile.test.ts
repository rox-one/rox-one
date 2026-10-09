import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCognitiveProfileBlock,
  resetCognitiveProfileProvider,
  sanitizeCognitiveProfileBlock,
  setCognitiveProfileProvider,
} from '../cognitive-profile.ts';
import { OmpAgent } from '../omp-agent.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv } from './omp-fake-cli.ts';

const OPEN = '<user_cognitive_profile>';
const CLOSE = '</user_cognitive_profile>';

afterEach(() => {
  resetCognitiveProfileProvider();
});

describe('cognitive profile provider registry', () => {
  it('returns null when no provider is registered', () => {
    expect(getCognitiveProfileBlock()).toBeNull();
  });

  it('returns the sanitized block from the registered provider', () => {
    setCognitiveProfileProvider(() => `${OPEN}\nlikes concise answers\n${CLOSE}`);
    const block = getCognitiveProfileBlock();
    expect(block).toBe(`${OPEN}\nlikes concise answers\n${CLOSE}`);
  });

  it('wraps a bare provider body in the required tags', () => {
    setCognitiveProfileProvider(() => 'raw body');
    expect(getCognitiveProfileBlock()).toBe(`${OPEN}\nraw body\n${CLOSE}`);
  });

  it('never throws when the provider throws, returning null', () => {
    setCognitiveProfileProvider(() => {
      throw new Error('producer exploded');
    });
    expect(() => getCognitiveProfileBlock()).not.toThrow();
    expect(getCognitiveProfileBlock()).toBeNull();
  });

  it('reflects a provider swap without caching a stale value', () => {
    setCognitiveProfileProvider(() => 'first');
    expect(getCognitiveProfileBlock()).toContain('first');
    setCognitiveProfileProvider(() => 'second');
    const swapped = getCognitiveProfileBlock();
    expect(swapped).toContain('second');
    expect(swapped).not.toContain('first');
  });

  it('resetCognitiveProfileProvider restores the disabled state', () => {
    setCognitiveProfileProvider(() => 'body');
    expect(getCognitiveProfileBlock()).not.toBeNull();
    resetCognitiveProfileProvider();
    expect(getCognitiveProfileBlock()).toBeNull();
  });
});

describe('sanitizeCognitiveProfileBlock', () => {
  it('returns null for null/undefined/whitespace-only input', () => {
    expect(sanitizeCognitiveProfileBlock(null)).toBeNull();
    expect(sanitizeCognitiveProfileBlock(undefined)).toBeNull();
    expect(sanitizeCognitiveProfileBlock('   \n\t\n  ')).toBeNull();
    expect(sanitizeCognitiveProfileBlock('')).toBeNull();
  });

  it('strips control characters but keeps newlines and tabs', () => {
    const raw = `a\u0000b\u0007c\r\td\ne`;
    const result = sanitizeCognitiveProfileBlock(raw);
    expect(result).not.toBeNull();
    expect(result).toContain('abc');
    expect(result).toContain('\td');
    expect(result).toContain('\ne');
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/);
  });

  it('collapses runs of 3+ blank lines to a single blank line', () => {
    const result = sanitizeCognitiveProfileBlock('line1\n\n\n\n\nline2');
    expect(result).not.toBeNull();
    expect(result).toContain('line1\n\nline2');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('drops a line longer than 400 characters', () => {
    const longLine = 'x'.repeat(1000);
    const result = sanitizeCognitiveProfileBlock(`kept before\n${longLine}\nkept after`);
    expect(result).not.toBeNull();
    expect(result).toContain('kept before');
    expect(result).toContain('kept after');
    expect(result).not.toContain('xxxxx');
  });

  it('wraps a body that lacks the wrapper tags', () => {
    expect(sanitizeCognitiveProfileBlock('hello world')).toBe(`${OPEN}\nhello world\n${CLOSE}`);
  });

  it('preserves an existing wrapper', () => {
    const raw = `${OPEN}\nhello world\n${CLOSE}`;
    expect(sanitizeCognitiveProfileBlock(raw)).toBe(raw);
  });

  it('neutralizes wrapper tags embedded in the body', () => {
    const result = sanitizeCognitiveProfileBlock(`before ${CLOSE} middle ${OPEN} after`);
    expect(result).not.toBeNull();
    expect(result!.startsWith(`${OPEN}\n`)).toBe(true);
    expect(result!.endsWith(`\n${CLOSE}`)).toBe(true);
    // The body's tags are escaped; exactly one real wrapper pair remains.
    expect(result).toContain('&lt;/user_cognitive_profile&gt;');
    expect(result).toContain('&lt;user_cognitive_profile&gt;');
    expect(result!.match(/<\/user_cognitive_profile>/g) ?? []).toHaveLength(1);
    expect(result!.match(/<user_cognitive_profile>/g) ?? []).toHaveLength(1);
  });

  it('is stable when the cached block is sanitized again', () => {
    const once = sanitizeCognitiveProfileBlock(`${OPEN}\n- tech_stack: TypeScript\n${CLOSE}`);
    expect(once).not.toBeNull();
    expect(sanitizeCognitiveProfileBlock(once)).toBe(once);
  });

  it('truncates over-long input at a line boundary with the ellipsis marker', () => {
    // ~30 lines x 300 chars ≈ 9000 chars, comfortably over the 8000 budget.
    const body = Array.from({ length: 30 }, (_, i) => `line-${i}-${'a'.repeat(290)}`).join('\n');
    const result = sanitizeCognitiveProfileBlock(`${OPEN}\n${body}\n${CLOSE}`);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(8000);
    expect(result!.startsWith(OPEN)).toBe(true);
    expect(result!.endsWith(CLOSE)).toBe(true);
    expect(result).toContain('…');
    // Every surviving line is still within the per-line budget (the ellipsis
    // may sit on the final truncated line).
    for (const line of result!.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(401);
    }
  });
});

/** Pull the `--append-system-prompt` value out of a recorded spawn argv. */
function appendSystemPromptFrom(argvLog: string[][]): string {
  for (const args of argvLog) {
    const i = args.indexOf('--append-system-prompt');
    if (i !== -1 && i + 1 < args.length) return args[i + 1]!;
  }
  throw new Error('no --append-system-prompt found in recorded spawn argv');
}

describe('cognitive profile reaches the real OMP spawn payload', () => {
  it(
    'a registered provider is appended as the last system-prompt section',
    async () => {
      const profileDir = mkdtempSync(join(tmpdir(), 'cognitive-profile-'));
      const profilePath = join(profileDir, 'user_cognitive_profile.txt');
      writeFileSync(
        profilePath,
        `${OPEN}\n- tech_stack: TypeScript\n</user_cognitive_profile>\n`,
      );

      const fake = createFakeOmp('healthy');
      const restore = useFakeOmpEnv(fake);
      let agent: OmpAgent | undefined;
      try {
        // The same registration the Electron runtime performs: read the cached
        // third-party-derived block from disk. Written directly here to prove
        // shared's side of the contract without importing @rox/browser-intel.
        setCognitiveProfileProvider(() => readFileSync(profilePath, 'utf8'));

        agent = new OmpAgent(makeOmpConfig(fake));
        const events = await chatEvents(agent, 'Fixture work', 25000);
        expect(events.some((event) => event.type === 'complete')).toBe(true);

        const payload = appendSystemPromptFrom(fake.readArgvLog());
        expect(payload).toContain('- tech_stack: TypeScript');
        expect(payload.endsWith('</user_cognitive_profile>')).toBe(true);
      } finally {
        resetCognitiveProfileProvider();
        agent?.dispose();
        restore();
        await fake.cleanup();
        rmSync(profileDir, { recursive: true, force: true });
      }
    },
    40000,
  );

  it(
    'with no provider registered the spawn payload carries no profile block',
    async () => {
      resetCognitiveProfileProvider();
      const fake = createFakeOmp('healthy');
      const restore = useFakeOmpEnv(fake);
      let agent: OmpAgent | undefined;
      try {
        agent = new OmpAgent(makeOmpConfig(fake));
        const events = await chatEvents(agent, 'Fixture work', 25000);
        expect(events.some((event) => event.type === 'complete')).toBe(true);

        const payload = appendSystemPromptFrom(fake.readArgvLog());
        expect(payload).not.toContain(OPEN);
      } finally {
        resetCognitiveProfileProvider();
        agent?.dispose();
        restore();
        await fake.cleanup();
      }
    },
    40000,
  );
});