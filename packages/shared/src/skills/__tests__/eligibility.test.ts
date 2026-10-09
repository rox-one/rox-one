/**
 * Skills eligibility gating: every reason code, the collision report over the
 * ordered root plan, and the additive frontmatter parsing that supplies the
 * machine requirements.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  credentialIdMatchesEnvName,
  defaultBinExists,
  detectSkillCollisions,
  evaluateSkillEligibility,
  osMatches,
} from '../eligibility.ts';
import { loadSkillsFromDir } from '../storage.ts';
import type { LoadedSkill } from '../types.ts';

function skill(slug: string, path = `/root/${slug}`, metadata: Partial<LoadedSkill['metadata']> = {}): LoadedSkill {
  return {
    slug,
    path,
    source: 'workspace',
    content: '',
    metadata: { name: slug, description: `${slug} description`, ...metadata },
  };
}

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-eligibility-'));
  fixtures.push(dir);
  return dir;
}

describe('evaluateSkillEligibility reason codes', () => {
  it('admits a skill with no requirements', async () => {
    const report = await evaluateSkillEligibility({ skills: [skill('plain')] });
    expect(report.eligible.map(s => s.slug)).toEqual(['plain']);
    expect(report.ineligible).toEqual([]);
  });

  it('operator-not-allowed: slug outside the allowlist', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('allowed'), skill('blocked')],
      allowedSlugs: ['allowed'],
    });
    expect(report.eligible.map(s => s.slug)).toEqual(['allowed']);
    expect(report.ineligible[0]!.skill.slug).toBe('blocked');
    expect(report.ineligible[0]!.reasons.map(r => r.code)).toEqual(['operator-not-allowed']);
  });

  it('operator-not-allowed: an empty allowlist denies every skill', async () => {
    const report = await evaluateSkillEligibility({ skills: [skill('a')], allowedSlugs: [] });
    expect(report.eligible).toEqual([]);
    expect(report.ineligible[0]!.reasons[0]!.code).toBe('operator-not-allowed');
  });

  it('missing-bin: a required executable absent from PATH', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('needs-bin', undefined, { requires: { bins: ['no-such-bin-xyz'] } })],
      checks: { binExists: () => false },
    });
    expect(report.eligible).toEqual([]);
    expect(report.ineligible[0]!.reasons[0]!.code).toBe('missing-bin');
    expect(report.ineligible[0]!.reasons[0]!.detail).toContain('no-such-bin-xyz');
  });

  it('missing-bin: anyBins unsatisfied when none resolve', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('needs-any', undefined, { requires: { anyBins: ['a-cmd', 'b-cmd'] } })],
      checks: { binExists: () => false },
    });
    expect(report.ineligible[0]!.reasons[0]!.code).toBe('missing-bin');
  });

  it('missing-bin: anyBins satisfied by one resolving binary', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('needs-any', undefined, { requires: { anyBins: ['a-cmd', 'b-cmd'] } })],
      checks: { binExists: bin => bin === 'b-cmd' },
    });
    expect(report.eligible.map(s => s.slug)).toEqual(['needs-any']);
  });

  it('missing-env: a required credential absent from the fabric', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('needs-env', undefined, { requires: { env: ['OPENAI_API_KEY'] } })],
      checks: { envExists: () => false },
    });
    expect(report.ineligible[0]!.reasons.map(r => r.code)).toEqual(['missing-env']);
    expect(report.ineligible[0]!.reasons[0]!.detail).toContain('OPENAI_API_KEY');
  });

  it('missing-config: a required config key absent', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('needs-config', undefined, { requires: { config: ['skills.allowlist'] } })],
      checks: { configExists: () => false },
    });
    expect(report.ineligible[0]!.reasons.map(r => r.code)).toEqual(['missing-config']);
  });

  it('os-mismatch: the skill does not support this platform', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('win-only', undefined, { os: ['win32'] })],
      platform: 'darwin',
    });
    expect(report.ineligible[0]!.reasons[0]!.code).toBe('os-mismatch');
  });

  it('os-mismatch: aliases match (macos ↔ darwin)', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('mac-only', undefined, { os: ['macos'] })],
      platform: 'darwin',
    });
    expect(report.eligible.map(s => s.slug)).toEqual(['mac-only']);
  });

  it('disabled-pack: a disabled bundled pack is rejected', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('pack-skill')],
      disabledPackSlugs: ['pack-skill'],
    });
    expect(report.ineligible[0]!.reasons[0]!.code).toBe('disabled-pack');
  });

  it('collects every failing reason for one skill', async () => {
    const report = await evaluateSkillEligibility({
      skills: [skill('multi', undefined, { requires: { bins: ['x'], env: ['Y'] }, os: ['win32'] })],
      platform: 'darwin',
      checks: { binExists: () => false, envExists: () => false },
    });
    expect(report.ineligible[0]!.reasons.map(r => r.code).sort()).toEqual(['missing-bin', 'missing-env', 'os-mismatch']);
  });

  it('ignores shadowed OMP variants', async () => {
    const report = await evaluateSkillEligibility({ skills: [{ ...skill('dup'), shadowedByCraft: true }] });
    expect(report.eligible).toEqual([]);
    expect(report.ineligible).toEqual([]);
  });
});

describe('detectSkillCollisions', () => {
  it('reports the winner and shadowed tiers over the ordered root plan', () => {
    const collisions = detectSkillCollisions([
      { label: 'omp-global', skills: [skill('shared', '/omp/shared')] },
      { label: 'global', skills: [skill('shared', '/global/shared')] },
      { label: 'workspace', skills: [skill('shared', '/ws/shared'), skill('solo', '/ws/solo')] },
    ]);
    expect(collisions).toEqual([
      { name: 'shared', winner: 'workspace', shadowed: ['omp-global', 'global'] },
    ]);
  });

  it('returns no collisions when every slug is unique', () => {
    expect(detectSkillCollisions([
      { label: 'global', skills: [skill('a', '/global/a')] },
      { label: 'workspace', skills: [skill('b', '/ws/b')] },
    ])).toEqual([]);
  });
});

describe('credentialIdMatchesEnvName', () => {
  it('maps an LLM connection slug to its API-key env name', () => {
    expect(credentialIdMatchesEnvName({ type: 'llm_api_key', connectionSlug: 'openai' }, 'OPENAI_API_KEY')).toBe(true);
  });

  it('maps a source name to API key / token aliases', () => {
    expect(credentialIdMatchesEnvName({ type: 'source_apikey', name: 'scrape-creators' }, 'SCRAPE_CREATORS_TOKEN')).toBe(true);
  });

  it('does not match an unrelated env name', () => {
    expect(credentialIdMatchesEnvName({ type: 'llm_api_key', connectionSlug: 'openai' }, 'ANTHROPIC_API_KEY')).toBe(false);
  });
});

describe('osMatches', () => {
  it('matches alias spellings and rejects other platforms', () => {
    expect(osMatches(['macos', 'linux'], 'darwin')).toBe(true);
    expect(osMatches(['win32'], 'linux')).toBe(false);
  });
});

describe('defaultBinExists', () => {
  it('resolves a real executable and rejects a missing one', async () => {
    expect(await defaultBinExists(process.execPath)).toBe(true);
    expect(await defaultBinExists('no-such-binary-xyz-123')).toBe(false);
  });
});

describe('frontmatter machine metadata', () => {
  it('reads metadata.openclaw into SkillMetadata and preserves it on rewrite', async () => {
    const root = tmpFixture();
    mkdirSync(join(root, 'gated'), { recursive: true });
    writeFileSync(join(root, 'gated', 'SKILL.md'), [
      '---',
      'name: gated',
      'description: Needs a binary',
      'metadata:',
      '  openclaw:',
      '    requires:',
      '      bins:',
      '        - node',
      '      env:',
      '        - OPENAI_API_KEY',
      '    os:',
      '      - darwin',
      '    primaryEnv: OPENAI_API_KEY',
      '    homepage: https://example.test',
      '---',
      'Body text.',
    ].join('\n'));

    const [loaded] = loadSkillsFromDir(root, 'workspace');
    expect(loaded!.metadata.requires).toEqual({ bins: ['node'], env: ['OPENAI_API_KEY'] });
    expect(loaded!.metadata.os).toEqual(['darwin']);
    expect(loaded!.metadata.primaryEnv).toBe('OPENAI_API_KEY');
    expect(loaded!.metadata.homepage).toBe('https://example.test');
  });

  it('lets metadata.rox override metadata.openclaw and folds required envVars', async () => {
    const root = tmpFixture();
    mkdirSync(join(root, 'dual'), { recursive: true });
    writeFileSync(join(root, 'dual', 'SKILL.md'), [
      '---',
      'name: dual',
      'description: Two blocks',
      'metadata:',
      '  openclaw:',
      '    requires:',
      '      bins: [old-bin]',
      '  rox:',
      '    requires:',
      '      bins: [new-bin]',
      '    envVars:',
      '      - name: REQUIRED_TOKEN',
      '        required: true',
      '      - name: OPTIONAL_TOKEN',
      '        required: false',
      '---',
      'Body.',
    ].join('\n'));

    const [loaded] = loadSkillsFromDir(root, 'workspace');
    expect(loaded!.metadata.requires).toEqual({ bins: ['new-bin'], env: ['REQUIRED_TOKEN'] });
  });
});