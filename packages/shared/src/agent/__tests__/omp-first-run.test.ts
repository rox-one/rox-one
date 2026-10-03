/**
 * Ticket 01 — first-run OMP/Rox credential step.
 *
 * A clean install must either complete a first turn or stop on ONE
 * actionable credential step that names the missing OMP/Rox credential
 * and how to supply it. The same typed code is used by UI and CLI.
 *
 * These tests pin the shared seam (inspect / provision / format) before
 * onboarding and CLI are wired to it.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  formatOmpCredentialLine,
  formatOmpCredentialStep,
  inspectOmpFirstRunReadiness,
  isOmpCredentialErrorCode,
  provisionOmpRoxConfig,
  prepareOmpRoxRuntimeConfig,
} from '../omp-first-run.ts';
import { getSetupNeeds, type AuthState } from '../../auth/state.ts';
import { ompStartupErrorToAgentError, OmpStartupError } from '../errors.ts';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omp-first-run-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function billingConfigured(overrides: Partial<AuthState['billing']> = {}): AuthState {
  return {
    billing: {
      type: 'api_key',
      hasCredentials: true,
      apiKey: null,
      claudeOAuthToken: null,
      ...overrides,
    },
    workspace: { hasWorkspace: true, active: null },
  };
}

describe('inspectOmpFirstRunReadiness', () => {
  it('missing ~/.omp/agent/models.yml and config.yml is not ready with OMP_NO_MODELS', () => {
    const homeDir = tempHome();
    const readiness = inspectOmpFirstRunReadiness({ homeDir, env: {} });

    expect(readiness.ready).toBe(false);
    expect(readiness.code).toBe('OMP_NO_MODELS');
    expect(readiness.step?.code).toBe('OMP_NO_MODELS');
    expect(readiness.step?.howToSupply).toMatch(/ROX_API_KEY|~\/\.omp\/agent/i);
    expect(readiness.canProvision).toBe(false);
  });

  it('existing models.yml with a provider and models is ready', () => {
    const homeDir = tempHome();
    const agentDir = join(homeDir, '.omp', 'agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'models.yml'),
      [
        'providers:',
        '  rox:',
        '    baseUrl: https://api.rox.one/v1',
        '    api: openai-completions',
        '    apiKey: ROX_API_KEY',
        '    models:',
        '      - id: kimi-K3',
        '        name: Kimi K3',
        '        contextWindow: 262144',
        '        maxTokens: 8192',
        '',
      ].join('\n'),
    );

    const readiness = inspectOmpFirstRunReadiness({ homeDir, env: {} });
    expect(readiness.ready).toBe(true);
    expect(readiness.code).toBeUndefined();
  });

  it('ROX_API_KEY in env with no files is provisionable but not yet ready', () => {
    const homeDir = tempHome();
    const readiness = inspectOmpFirstRunReadiness({
      homeDir,
      env: { ROX_API_KEY: 'rox-test-key' },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.canProvision).toBe(true);
    expect(readiness.code).toBe('OMP_NO_MODELS');
  });

  it('stored API key with no files is provisionable', () => {
    const homeDir = tempHome();
    const readiness = inspectOmpFirstRunReadiness({
      homeDir,
      env: {},
      storedApiKey: 'stored-rox-key',
    });

    expect(readiness.canProvision).toBe(true);
    expect(readiness.ready).toBe(false);
  });
});

describe('provisionOmpRoxConfig', () => {
  it('creates models.yml and config.yml without writing the raw API key', () => {
    const homeDir = tempHome();
    const result = provisionOmpRoxConfig({
      homeDir,
      apiKey: 'super-secret-rox-key',
      baseUrl: 'https://api.rox.one/v1',
    });

    const modelsPath = join(homeDir, '.omp', 'agent', 'models.yml');
    const configPath = join(homeDir, '.omp', 'agent', 'config.yml');
    expect(result.created).toContain(modelsPath);
    expect(result.created).toContain(configPath);
    expect(existsSync(modelsPath)).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const models = readFileSync(modelsPath, 'utf8');
    const config = readFileSync(configPath, 'utf8');
    expect(models).not.toContain('super-secret-rox-key');
    expect(config).not.toContain('super-secret-rox-key');
    expect(models).toMatch(/apiKey:\s*ROX_API_KEY/);
    expect(models).toContain('https://api.rox.one/v1');
    expect(models).toContain('rox/standard');
    expect(models).not.toContain('kimi-K3');
    expect(config).toMatch(/modelRoles:[\s\S]*default:\s*rox\/rox\/standard/);
  });

  it('does not overwrite an existing models.yml', () => {
    const homeDir = tempHome();
    const agentDir = join(homeDir, '.omp', 'agent');
    mkdirSync(agentDir, { recursive: true });
    const modelsPath = join(agentDir, 'models.yml');
    writeFileSync(modelsPath, 'providers:\n  keep-me:\n    models:\n      - id: stay\n');

    const result = provisionOmpRoxConfig({
      homeDir,
      apiKey: 'new-key',
    });

    expect(result.skipped).toContain(modelsPath);
    expect(readFileSync(modelsPath, 'utf8')).toContain('keep-me');
    expect(readFileSync(modelsPath, 'utf8')).not.toContain('new-key');
  });

  it('after provision + ROX_API_KEY the inspect is ready', () => {
    const homeDir = tempHome();
    provisionOmpRoxConfig({ homeDir, apiKey: 'rox-test-key' });
    const readiness = inspectOmpFirstRunReadiness({
      homeDir,
      env: { ROX_API_KEY: 'rox-test-key' },
    });
    expect(readiness.ready).toBe(true);
  });
});

describe('private public Rox runtime catalog', () => {
  it('provisions canonical public IDs without changing existing user files or storing its secret', () => {
    const home = tempHome();
    const userAgent = join(home, '.omp', 'agent');
    mkdirSync(userAgent, { recursive: true });
    const original = 'providers:\n  user:\n    models:\n      - id: private-choice\n';
    const originalConfig = 'modelRoles:\n  default: user/private-choice\n';
    writeFileSync(join(userAgent, 'models.yml'), original);
    writeFileSync(join(userAgent, 'config.yml'), originalConfig);
    const runtime = prepareOmpRoxRuntimeConfig({ runtimeRoot: join(home, 'private-runs'), homeDir: home, apiKey: 'private-fixture-secret' });
    const models = readFileSync(join(runtime.agentDir, 'models.yml'), 'utf8');
    expect([...models.matchAll(/- id: (.+)/g)].map(match => match[1])).toEqual(['rox/explore', 'rox/standard', 'rox/max', 'rox/vision', 'rox/fast']);
    expect(models).not.toContain('private-fixture-secret');
    expect(models).not.toContain('kimi-K3');
    const config = parseYaml(readFileSync(join(runtime.agentDir, 'config.yml'), 'utf8'));
    expect(config.magicKeywords).toEqual({ enabled: true, ultrathink: true, orchestrate: true, workflow: true });
    expect(config.providers.autoThinkingMaxEffort).toBe('max');
    expect(config.eval).toEqual({ js: true, tools: { enabled: true } });
    expect(runtime.env.PI_CODING_AGENT_DIR).toBe(runtime.agentDir);
    expect(runtime.env.OMP_PROFILE).toBe('default');
    expect(runtime.env.ROX_API_KEY).toBe('private-fixture-secret');
    expect(runtime.env.PI_CONFIG_FILES).toEndWith(join(runtime.agentDir, 'rox-runtime-policy.yml'));
    expect(readFileSync(join(userAgent, 'models.yml'), 'utf8')).toBe(original);
    expect(readFileSync(join(userAgent, 'config.yml'), 'utf8')).toBe(originalConfig);
    runtime.dispose();
    runtime.dispose();
    expect(existsSync(runtime.agentDir)).toBe(false);
    expect(readFileSync(join(userAgent, 'models.yml'), 'utf8')).toBe(original);
    expect(readFileSync(join(userAgent, 'config.yml'), 'utf8')).toBe(originalConfig);
  });

  it('ships skills into each clean private profile and keeps blobs across process restarts', () => {
    const home = tempHome();
    const bundle = join(home, 'bundle');
    mkdirSync(join(bundle, 'example', 'alpha'), { recursive: true });
    writeFileSync(join(bundle, 'example', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Test skill\n---\nOffline instructions.');
    writeFileSync(join(bundle, 'SKILLS.lock'), JSON.stringify({ packs: [{ slug: 'example', skills: ['alpha'] }] }));
    const runtimeRoot = join(home, 'runs');
    const first = prepareOmpRoxRuntimeConfig({ runtimeRoot, homeDir: home, bundleRoot: bundle });
    expect(readFileSync(join(first.agentDir, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('Offline instructions.');
    writeFileSync(join(first.agentDir, 'blobs', 'image.dat'), 'persisted-image');
    first.dispose();
    const second = prepareOmpRoxRuntimeConfig({ runtimeRoot, homeDir: home, bundleRoot: bundle });
    expect(readFileSync(join(second.agentDir, 'blobs', 'image.dat'), 'utf8')).toBe('persisted-image');
    expect(existsSync(join(home, '.agents', 'skills'))).toBe(false);
    second.dispose();
  });

  it('preserves non-public models, credentials and user settings while enforcing runtime policy', () => {
    const home = tempHome();
    const source = join(home, '.omp', 'agent');
    mkdirSync(source, { recursive: true });
    const models = 'providers:\n  local:\n    models:\n      - id: user-model\n';
    writeFileSync(join(source, 'models.yaml'), models);
    writeFileSync(join(source, 'auth.json'), '{"fixture":true}');
    const config = 'theme:\n  dark: custom\nmagicKeywords:\n  enabled: false\neval:\n  py: false\n';
    writeFileSync(join(source, 'config.yaml'), config);
    const runtime = prepareOmpRoxRuntimeConfig({ runtimeRoot: join(home, 'runs'), homeDir: home, publicRoxCatalog: false });
    expect(readFileSync(join(runtime.agentDir, 'models.yaml'), 'utf8')).toBe(models);
    expect(readFileSync(join(runtime.agentDir, 'auth.json'), 'utf8')).toBe('{"fixture":true}');
    const effective = parseYaml(readFileSync(join(runtime.agentDir, 'config.yml'), 'utf8'));
    expect(effective.theme.dark).toBe('custom');
    expect(effective.eval.py).toBe(false);
    expect(effective.magicKeywords.enabled).toBe(true);
    expect(readFileSync(join(source, 'config.yaml'), 'utf8')).toBe(config);
    runtime.dispose();
  });

  it('preserves authored skill priority and does not rediscover disabled global bundle copies', () => {
    const home = tempHome();
    const bundle = join(home, 'bundle');
    for (const [pack, slug, description] of [['enabled', 'alpha', 'Bundled alpha'], ['disabled', 'beta', 'Bundled beta']]) {
      mkdirSync(join(bundle, pack!, slug!), { recursive: true });
      writeFileSync(join(bundle, pack!, slug!, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${description}\n---\nBody`);
    }
    writeFileSync(join(bundle, 'SKILLS.lock'), JSON.stringify({ packs: [{ slug: 'enabled', skills: ['alpha'] }, { slug: 'disabled', skills: ['beta'] }] }));
    const shared = join(home, '.agents', 'skills');
    for (const slug of ['alpha', 'beta']) {
      mkdirSync(join(shared, slug), { recursive: true });
      writeFileSync(join(shared, slug, 'SKILL.md'), `---\nname: ${slug}\ndescription: User ${slug}\n---\nUser instructions`);
    }
    const runtime = prepareOmpRoxRuntimeConfig({ runtimeRoot: join(home, 'runs'), homeDir: home, bundleRoot: bundle, disabledPacks: ['disabled'] });
    expect(readFileSync(join(runtime.agentDir, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('User instructions');
    expect(existsSync(join(runtime.agentDir, 'skills', 'beta'))).toBe(false);
    expect(readFileSync(join(shared, 'beta', 'SKILL.md'), 'utf8')).toContain('User instructions');
    const policy = parseYaml(readFileSync(join(runtime.agentDir, 'rox-runtime-policy.yml'), 'utf8'));
    expect(policy.skills.enableAgentsUser).toBe(false);
    runtime.dispose();
    expect(readFileSync(join(shared, 'alpha', 'SKILL.md'), 'utf8')).toContain('User instructions');
  });
});

describe('credential step copy is shared by UI and CLI', () => {
  it('formatOmpCredentialLine starts with the typed code the UI uses', () => {
    const step = formatOmpCredentialStep('OMP_NO_MODELS');
    const line = formatOmpCredentialLine(step);
    expect(step.code).toBe('OMP_NO_MODELS');
    expect(line.startsWith('OMP_NO_MODELS:')).toBe(true);
    expect(line).toContain(step.title);
    expect(step.howToSupply.length).toBeGreaterThan(10);
  });

  it('isOmpCredentialErrorCode covers the first-run codes only', () => {
    expect(isOmpCredentialErrorCode('OMP_NO_MODELS')).toBe(true);
    expect(isOmpCredentialErrorCode('OMP_AUTH_REQUIRED')).toBe(true);
    expect(isOmpCredentialErrorCode('OMP_NOT_CONFIGURED')).toBe(true);
    expect(isOmpCredentialErrorCode('OMP_READY_TIMEOUT')).toBe(false);
    expect(isOmpCredentialErrorCode('invalid_api_key')).toBe(false);
  });
});

describe('getSetupNeeds + OMP first-run', () => {
  it('seeded omp connection without OMP config is not fully configured', () => {
    const needs = getSetupNeeds(
      billingConfigured({ hasCredentials: true }),
      false,
      { ready: false, code: 'OMP_NO_MODELS' },
    );

    expect(needs.needsCredentials).toBe(true);
    expect(needs.needsOmpCredential).toBe(true);
    expect(needs.ompCredentialCode).toBe('OMP_NO_MODELS');
    expect(needs.isFullyConfigured).toBe(false);
  });

  it('OMP ready leaves a configured billing state fully configured', () => {
    const needs = getSetupNeeds(
      billingConfigured({ hasCredentials: true }),
      false,
      { ready: true },
    );

    expect(needs.needsOmpCredential).toBeFalsy();
    expect(needs.isFullyConfigured).toBe(true);
  });
});

describe('ompStartupErrorToAgentError credential actions', () => {
  it('OMP_NO_MODELS includes a settings action so the UI can open the credential step', () => {
    const agentError = ompStartupErrorToAgentError(new OmpStartupError({
      code: 'OMP_NO_MODELS',
      message: 'OMP exited before startup: no models are configured.',
      hint: 'Create ~/.omp/agent/models.yml or set ROX_API_KEY.',
    }));

    expect(agentError.code).toBe('OMP_NO_MODELS');
    expect(agentError.actions.some((a) => a.action === 'settings')).toBe(true);
    expect(agentError.canRetry).toBe(true);
  });
});
