/**
 * First-run OMP / Rox credential seam (ticket 01).
 *
 * OMP reads models from ~/.omp/agent/models.yml and default role from
 * ~/.omp/agent/config.yml. A clean Rox install seeds a `rox-kimi`
 * public connection with authType `none`, so craft setup looks complete while
 * OMP still has no models — the first turn dies as OMP_NO_MODELS.
 *
 * This module is the single inspect / provision / copy source for that
 * gap. It never overwrites an existing user models.yml or config.yml
 * (omp-v2-prd: do not rewrite ~/.omp). The raw API key is never written
 * into those files; models.yml pins `apiKey: ROX_API_KEY` (env-var name)
 * and the spawn path injects the value. Public Rox runtime catalogs come from
 * the declared Rox contract, not a claim of gateway discovery. They use a
 * private per-run agent directory and retain every original user file.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { linkBundledSkillsForOmp } from '../skills/bundled.ts';
import { OMP_WORKER_POLICY_SOURCE } from './omp-worker-policy.ts';
import type { OmpStartupErrorCode } from './errors.ts';
import { ROX_DEFAULT_PARENT_MODEL, ROX_PUBLIC_MODEL_CATALOG } from '../config/rox-public-models.ts';

export const OMP_CREDENTIAL_CODES = [
  'OMP_NO_MODELS',
  'OMP_AUTH_REQUIRED',
  'OMP_NOT_CONFIGURED',
] as const;

export type OmpCredentialCode = (typeof OMP_CREDENTIAL_CODES)[number];

export const ROX_OMP_PROVIDER_ID = 'rox';
export const ROX_OMP_MODEL_ID = ROX_DEFAULT_PARENT_MODEL;
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

/** First existing basename inside an OMP agent directory, in preference order. */
function firstExistingIn(dir: string, names: readonly string[]): string | null {
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
  return HAS_PROVIDER_MODELS.test(readIfExists(firstExistingIn(ompAgentDir(homeDir), MODELS_BASENAMES)));
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
    ...ROX_PUBLIC_MODEL_CATALOG.flatMap(model => [
      `      - id: ${model.id}`,
      `        name: ${JSON.stringify(model.name)}`,
      `        contextWindow: ${model.contextWindow}`,
      `        reasoning: ${model.supportsThinking}`,
      `        input: ${model.supportsImages ? '[text, image]' : '[text]'}`,
    ]),
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

const UNKNOWN_MODEL_CONTEXT_WINDOW = 200000;

function asMapping(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Materialize the requested Rox model in the disposable OMP overlay's provider
 * catalog.
 *
 * A clean home has no OMP provider catalog at all, and OMP refuses to select a
 * model it cannot resolve, so a pinned gateway model must be declared here or
 * the turn fails at `set_model`. Only the disposable overlay is written, and
 * only when the provider entry is missing or incomplete: the user's own
 * `~/.omp/agent` files are never modified.
 */
function ensureOverlayRoxModel(agentDir: string, baseUrl: string, model: string): void {
  const existing = firstExistingIn(agentDir, MODELS_BASENAMES);
  const catalog: Record<string, unknown> = (existing ? asMapping(parseYaml(readFileSync(existing, 'utf8'))) : null) ?? {};
  const providers: Record<string, unknown> = asMapping(catalog['providers']) ?? {};
  catalog['providers'] = providers;
  const rox: Record<string, unknown> = asMapping(providers[ROX_OMP_PROVIDER_ID]) ?? {};
  providers[ROX_OMP_PROVIDER_ID] = rox;
  const models: unknown[] = Array.isArray(rox['models']) ? rox['models'] : [];
  rox['models'] = models;
  const declared = models.some(entry => asMapping(entry)?.['id'] === model);
  const configuredBaseUrl = typeof rox['baseUrl'] === 'string' ? rox['baseUrl'].trim() : '';
  if (declared && configuredBaseUrl && rox['apiKey'] === ROX_OMP_API_KEY_ENV) return;
  rox['baseUrl'] = configuredBaseUrl || baseUrl;
  rox['api'] = typeof rox['api'] === 'string' && rox['api'] ? rox['api'] : 'openai-completions';
  // The gateway key reaches the child through the env indirection, never the file.
  rox['apiKey'] = ROX_OMP_API_KEY_ENV;
  if (!declared) {
    const known = ROX_PUBLIC_MODEL_CATALOG.find(candidate => candidate.id === model);
    models.push({
      id: model,
      name: known?.name ?? model,
      contextWindow: known?.contextWindow ?? UNKNOWN_MODEL_CONTEXT_WINDOW,
      reasoning: known?.supportsThinking ?? true,
      input: known?.supportsImages ? ['text', 'image'] : ['text'],
    });
  }
  writeFileSync(join(agentDir, 'models.yml'), stringifyYaml(catalog), { mode: 0o600 });
  rmSync(join(agentDir, 'models.yaml'), { force: true });
}

export function provisionOmpRoxConfig(input: ProvisionOmpRoxConfigInput): ProvisionOmpRoxConfigResult {
  const created: string[] = [];
  const skipped: string[] = [];
  const dir = ompAgentDir(input.homeDir);
  mkdirSync(dir, { recursive: true });

  const modelsPath = join(dir, 'models.yml');
  const configPath = join(dir, 'config.yml');
  const existingModels = firstExistingIn(dir, MODELS_BASENAMES);
  const existingConfig = firstExistingIn(dir, CONFIG_BASENAMES);
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

/** Public Rox runs use a private OMP agent directory; never modify user OMP files. */
export function prepareOmpRoxRuntimeConfig(input: {
  runtimeRoot: string;
  apiKey?: string | null;
  baseUrl?: string;
  /** False keeps the user's provider catalog while applying ROX runtime policy. */
  publicRoxCatalog?: boolean;
  /** Model the app pins for this child; declared in the overlay catalog when absent. */
  model?: string;
  sourceAgentDir?: string;
  /** Injection seams for clean-home native discovery verification. */
  bundleRoot?: string;
  homeDir?: string;
  configFiles?: string;
  disabledPacks?: string[];
}): { agentDir: string; env: Record<string, string>; dispose: () => void } {
  mkdirSync(input.runtimeRoot, { recursive: true, mode: 0o700 });
  const agentDir = mkdtempSync(join(input.runtimeRoot, 'rox-omp-'));
  try {
    const sourceDir = input.sourceAgentDir ?? ompAgentDir(input.homeDir ?? homedir());
    // Preserve provider credentials and unrelated settings in the disposable
    // overlay. No host-global skill directory or user config is modified.
    for (const name of ['auth.json', 'auth.yml', 'auth.yaml', 'secrets.json', 'models.yml', 'models.yaml']) {
      const source = join(sourceDir, name);
      if (existsSync(source)) copyFileSync(source, join(agentDir, name));
    }
    let config: Record<string, any> = {};
    for (const name of CONFIG_BASENAMES) {
      const source = join(sourceDir, name);
      if (!existsSync(source)) continue;
      const parsed = parseYaml(readFileSync(source, 'utf8'));
      if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw new Error(`OMP configuration must be a mapping: ${source}`);
      }
      config = parsed ?? {};
      break;
    }
    const baseUrl = (input.baseUrl?.trim() || ROX_OMP_DEFAULT_BASE_URL).replace(/\/$/, '');
    if (input.publicRoxCatalog !== false) {
      rmSync(join(agentDir, 'models.yaml'), { force: true });
      writeFileSync(join(agentDir, 'models.yml'), modelsYmlTemplate(baseUrl), { mode: 0o600 });
      config.modelRoles = { ...config.modelRoles, default: `${ROX_OMP_PROVIDER_ID}/${ROX_OMP_MODEL_ID}` };
    }
    // The child is pinned to this exact model over RPC; the catalog it reads must
    // therefore declare it, even on a clean home with no OMP provider config.
    const requestedModel = input.model?.trim();
    if (requestedModel) {
      ensureOverlayRoxModel(agentDir, baseUrl, requestedModel);
      config.modelRoles = { ...config.modelRoles, default: requestedModel };
    }
    config.magicKeywords = { ...config.magicKeywords, enabled: true, ultrathink: true, orchestrate: true, workflow: true };
    config.providers = { ...config.providers, autoThinkingMaxEffort: 'max' };
    const workerPolicyPath = join(agentDir, 'rox-worker-policy.js');
    writeFileSync(workerPolicyPath, OMP_WORKER_POLICY_SOURCE, { mode: 0o600 });
    config.extensions = [...(Array.isArray(config.extensions) ? config.extensions : []), workerPolicyPath];
    config.task = { ...config.task, maxEffort: 'max' };
    config.eval = { ...config.eval, js: true, tools: { ...config.eval?.tools, enabled: true } };
    config.skills = {
      ...config.skills, enabled: true, enableSkillCommands: true, enablePiUser: true, enableAgentsUser: false,
      enableCodexUser: false, enableClaudeUser: false,
    };
    writeFileSync(join(agentDir, 'config.yml'), stringifyYaml(config), { mode: 0o600 });
    // Explicit overlays are evaluated after project settings by native OMP.
    // ROX's mandatory execution policy must survive a workspace config that
    // switches off these keywords, without rewriting that workspace file.
    writeFileSync(join(agentDir, 'rox-runtime-policy.yml'), stringifyYaml({
      magicKeywords: config.magicKeywords,
      providers: { autoThinkingMaxEffort: 'max' },
      task: { maxEffort: 'max' },
      extensions: config.extensions,
      eval: { js: true, tools: { enabled: true } },
      skills: { enabled: true, enableSkillCommands: true, enablePiUser: true, enableAgentsUser: false, enableCodexUser: false, enableClaudeUser: false },
      // ROX supplies its host tools and pinned offline skill tier. Scanning
      // unrelated foreign plugin catalogs can block every process startup.
      disabledProviders: [...new Set([...(Array.isArray(config.disabledProviders) ? config.disabledProviders : []), 'claude-plugins', 'agent-plugins', 'omp-plugins'])],
    }), { mode: 0o600 });
    linkBundledSkillsForOmp({
      bundleRoot: input.bundleRoot, targetRoot: join(agentDir, 'skills'), disabled: input.disabledPacks,
      userSkillRoots: [join(sourceDir, 'skills'), join(input.homeDir ?? homedir(), '.agents', 'skills')],
    });
    // OMP stores image/tool blobs relative to the agent profile. Keep that store
    // across process restarts so a restored transcript retains its attachments.
    const existingBlobs = join(sourceDir, 'blobs');
    const persistentBlobs = existsSync(existingBlobs) ? existingBlobs : join(input.runtimeRoot, 'state', 'blobs');
    mkdirSync(persistentBlobs, { recursive: true, mode: 0o700 });
    symlinkSync(persistentBlobs, join(agentDir, 'blobs'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    rmSync(agentDir, { recursive: true, force: true });
    throw error;
  }
  return {
    agentDir,
    env: {
      PI_CODING_AGENT_DIR: agentDir,
      // Named ambient profiles override agent-dir resolution unless default is explicit.
      OMP_PROFILE: 'default',
      PI_CONFIG_FILES: [input.configFiles ?? process.env.PI_CONFIG_FILES, join(agentDir, 'rox-runtime-policy.yml')].filter(Boolean).join(delimiter),
      ROX_API_KEY: input.apiKey?.trim() || '',
    },
    dispose: () => rmSync(agentDir, { recursive: true, force: true }),
  };
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
