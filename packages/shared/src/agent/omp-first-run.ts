/**
 * First-run OMP / Rox credential seam (ticket 01).
 *
 * OMP reads models from ~/.omp/agent/models.yml and default role from
 * ~/.omp/agent/config.yml. A clean Rox install seeds a `rox-kimi`
 * connection with authType `none`, so craft setup looks complete while
 * OMP still has no models — the first turn dies as OMP_NO_MODELS.
 *
 * This module is the single inspect / provision / copy source for that
 * gap. It never overwrites an existing user models.yml or config.yml
 * (omp-v2-prd: do not rewrite ~/.omp). The raw API key is never written
 * into those files; models.yml pins `apiKey: ROX_API_KEY` (env-var name)
 * and the spawn path injects the value.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OmpStartupErrorCode } from './errors.ts';

export const OMP_CREDENTIAL_CODES = [
  'OMP_NO_MODELS',
  'OMP_AUTH_REQUIRED',
  'OMP_NOT_CONFIGURED',
] as const;

export type OmpCredentialCode = (typeof OMP_CREDENTIAL_CODES)[number];

export const ROX_OMP_PROVIDER_ID = 'rox';
export const ROX_OMP_MODEL_ID = 'kimi-K3';
export const ROX_OMP_DEFAULT_BASE_URL = 'https://api.rox.one/v1';
export const ROX_OMP_API_KEY_ENV = 'ROX_API_KEY';

export interface OmpFirstRunInspectInput {
  homeDir: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  storedApiKey?: string | null;
}

export interface OmpCredentialStep {
  code: OmpCredentialCode;
  title: string;
  message: string;
  howToSupply: string;
  canRetry: boolean;
}

export interface OmpFirstRunReadiness {
  ready: boolean;
  code?: OmpCredentialCode;
  step?: OmpCredentialStep;
  canProvision: boolean;
}

export interface ProvisionOmpRoxConfigInput {
  homeDir: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ProvisionOmpRoxConfigResult {
  created: string[];
  skipped: string[];
}

const MODELS_BASENAMES = ['models.yml', 'models.yaml'] as const;
const CONFIG_BASENAMES = ['config.yml', 'config.yaml'] as const;

const HAS_PROVIDER_MODELS =
  /providers:\s*\n[\s\S]*models:\s*\n\s*-\s*id:/i;

function ompAgentDir(homeDir: string): string {
  return join(homeDir, '.omp', 'agent');
}

function firstExisting(homeDir: string, names: readonly string[]): string | null {
  const dir = ompAgentDir(homeDir);
  for (const name of names) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function readIfExists(path: string | null): string {
  if (!path) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function hasProvisionableKey(input: OmpFirstRunInspectInput): boolean {
  const envKey = input.env?.[ROX_OMP_API_KEY_ENV]?.trim();
  const stored = input.storedApiKey?.trim();
  return Boolean(envKey || stored);
}

function hasOmpModels(homeDir: string): boolean {
  return HAS_PROVIDER_MODELS.test(readIfExists(firstExisting(homeDir, MODELS_BASENAMES)));
}

export function isOmpCredentialErrorCode(code: string | undefined | null): code is OmpCredentialCode {
  return !!code && (OMP_CREDENTIAL_CODES as readonly string[]).includes(code);
}

export function formatOmpCredentialStep(code: OmpCredentialCode): OmpCredentialStep {
  switch (code) {
    case 'OMP_NO_MODELS':
      return {
        code,
        title: 'OMP has no models configured',
        message: 'The OMP runtime has no model providers. A Rox API key (ROX_API_KEY) or ~/.omp/agent/models.yml is required before the first turn.',
        howToSupply: 'Paste a Rox API key here, or set the ROX_API_KEY environment variable. Rox creates ~/.omp/agent/models.yml and config.yml only if they are missing — existing OMP files are never overwritten.',
        canRetry: true,
      };
    case 'OMP_AUTH_REQUIRED':
      return {
        code,
        title: 'OMP authentication required',
        message: 'OMP rejected the current credentials. Supply a valid Rox API key and retry.',
        howToSupply: 'Set ROX_API_KEY or paste a Rox API key. Existing ~/.omp/agent files are left untouched.',
        canRetry: false,
      };
    case 'OMP_NOT_CONFIGURED':
      return {
        code,
        title: 'OMP runtime not configured',
        message: 'The omp CLI is missing or its toolchain is not ready.',
        howToSupply: 'Install the omp CLI (or wait for the toolchain download), then set ROX_API_KEY or paste a Rox API key.',
        canRetry: true,
      };
  }
}

export function formatOmpCredentialLine(step: OmpCredentialStep): string {
  return `${step.code}: ${step.title}\n${step.message}\n${step.howToSupply}`;
}

export function formatTypedErrorForCli(error: {
  code?: string;
  title?: string;
  message?: string;
}): string {
  if (error.code && isOmpCredentialErrorCode(error.code)) {
    return formatOmpCredentialLine(formatOmpCredentialStep(error.code));
  }
  const code = error.code ? `${error.code}: ` : '';
  const title = error.title && error.title !== error.message ? `${error.title}: ` : '';
  return `${code}${title}${error.message ?? ''}`.trim();
}

export function inspectOmpFirstRunReadiness(input: OmpFirstRunInspectInput): OmpFirstRunReadiness {
  const canProvision = hasProvisionableKey(input);
  if (hasOmpModels(input.homeDir)) {
    return { ready: true, canProvision };
  }
  const step = formatOmpCredentialStep('OMP_NO_MODELS');
  return {
    ready: false,
    code: 'OMP_NO_MODELS',
    step,
    canProvision,
  };
}

function modelsYmlTemplate(baseUrl: string): string {
  return [
    '# Provisioned by Rox first-run. apiKey is the env var name, not the secret.',
    '# Existing user files are never overwritten.',
    'providers:',
    `  ${ROX_OMP_PROVIDER_ID}:`,
    `    baseUrl: ${baseUrl}`,
    '    api: openai-completions',
    `    apiKey: ${ROX_OMP_API_KEY_ENV}`,
    '    models:',
    `      - id: ${ROX_OMP_MODEL_ID}`,
    '        name: Kimi K3',
    '        contextWindow: 262144',
    '        maxTokens: 8192',
    '',
  ].join('\n');
}

function configYmlTemplate(): string {
  return [
    '# Provisioned by Rox first-run. Existing user files are never overwritten.',
    'modelRoles:',
    `  default: ${ROX_OMP_PROVIDER_ID}/${ROX_OMP_MODEL_ID}`,
    '',
  ].join('\n');
}

export function provisionOmpRoxConfig(input: ProvisionOmpRoxConfigInput): ProvisionOmpRoxConfigResult {
  const created: string[] = [];
  const skipped: string[] = [];
  const dir = ompAgentDir(input.homeDir);
  mkdirSync(dir, { recursive: true });

  const modelsPath = join(dir, 'models.yml');
  const configPath = join(dir, 'config.yml');
  const existingModels = firstExisting(input.homeDir, MODELS_BASENAMES);
  const existingConfig = firstExisting(input.homeDir, CONFIG_BASENAMES);
  const baseUrl = (input.baseUrl?.trim() || ROX_OMP_DEFAULT_BASE_URL).replace(/\/$/, '');

  if (existingModels) {
    skipped.push(existingModels);
  } else {
    writeFileSync(modelsPath, modelsYmlTemplate(baseUrl), { encoding: 'utf8', mode: 0o600 });
    created.push(modelsPath);
  }

  if (existingConfig) {
    skipped.push(existingConfig);
  } else {
    writeFileSync(configPath, configYmlTemplate(), { encoding: 'utf8', mode: 0o600 });
    created.push(configPath);
  }

  return { created, skipped };
}

export function ensureOmpRoxFirstRun(input: OmpFirstRunInspectInput & { baseUrl?: string }): OmpFirstRunReadiness {
  const first = inspectOmpFirstRunReadiness(input);
  if (first.ready) return first;
  const key = input.env?.[ROX_OMP_API_KEY_ENV]?.trim() || input.storedApiKey?.trim();
  if (!key) return first;
  provisionOmpRoxConfig({
    homeDir: input.homeDir,
    apiKey: key,
    baseUrl: input.baseUrl,
  });
  return inspectOmpFirstRunReadiness({
    ...input,
    env: { ...input.env, [ROX_OMP_API_KEY_ENV]: key },
  });
}

export function buildOmpSpawnCredentialEnv(input: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  storedApiKey?: string | null;
}): Record<string, string> {
  const key = input.env?.[ROX_OMP_API_KEY_ENV]?.trim() || input.storedApiKey?.trim();
  return key ? { [ROX_OMP_API_KEY_ENV]: key } : {};
}

export function defaultOmpHomeDir(): string {
  return homedir();
}

export function isOmpStartupCredentialCode(code: OmpStartupErrorCode): boolean {
  return isOmpCredentialErrorCode(code);
}
