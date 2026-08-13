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
import {
  formatOmpCredentialLine,
  formatOmpCredentialStep,
  inspectOmpFirstRunReadiness,
  isOmpCredentialErrorCode,
  provisionOmpRoxConfig,
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
    expect(models).toContain('kimi-K3');
    expect(config).toMatch(/modelRoles:[\s\S]*default:\s*rox\/kimi-K3/);
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
