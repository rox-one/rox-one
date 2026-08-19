/**
 * Ticket 13 — live-credential first-turn E2E gate.
 *
 * Wave 5 can claim stream / host tool / MCP tool / permission / restart
 * as VERIFIED only after a real model credential produced a log and a
 * browser trace. This module is the honest gate: missing ROX_API_KEY is
 * BLOCKED (named). A READY inspect is not a live run.
 *
 * Do not fake green. claimLiveTurnVerified refuses BLOCKED gates and
 * missing evidence files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LIVE_TURN_REQUIRED_SECRET = 'ROX_API_KEY' as const;

export type LiveTurnStepId =
  | 'stream_answer'
  | 'host_tool'
  | 'mcp_tool'
  | 'permission_prompt'
  | 'restart_restore';

export const LIVE_TURN_STEPS: readonly LiveTurnStepId[] = [
  'stream_answer',
  'host_tool',
  'mcp_tool',
  'permission_prompt',
  'restart_restore',
] as const;

export type LiveTurnStepResult = 'VERIFIED' | 'BLOCKED' | 'NOT_RUN';
export type LiveTurnClaim = 'live-turn-not-claimed' | 'live-turn-verified';
export type LiveTurnGateStatus = 'READY' | 'BLOCKED';

export interface LiveTurnCredentialInspectInput {
  homeDir: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface LiveTurnCredentialInspect {
  hasRoxApiKey: boolean;
  hasOmpModelsYml: boolean;
  ready: boolean;
  missingSecret: typeof LIVE_TURN_REQUIRED_SECRET | null;
}

export interface LiveTurnGate {
  status: LiveTurnGateStatus;
  missingSecret: typeof LIVE_TURN_REQUIRED_SECRET | null;
  reason: string;
  claim: LiveTurnClaim;
  steps: Record<LiveTurnStepId, LiveTurnStepResult>;
  logPath?: string;
  browserTracePath?: string;
}

export interface LiveTurnVerifiedInput {
  gate: LiveTurnGate;
  logPath: string;
  browserTracePath: string;
  stepEvidence: Record<LiveTurnStepId, { verified: true; note: string }>;
}

const MODELS_BASENAMES = ['models.yml', 'models.yaml'] as const;
const HAS_PROVIDER_MODELS =
  /providers:\s*\n[\s\S]*models:\s*\n\s*-\s*id:/i;

function ompAgentDir(homeDir: string): string {
  return join(homeDir, '.omp', 'agent');
}

function hasOmpModelsYml(homeDir: string): boolean {
  const dir = ompAgentDir(homeDir);
  for (const name of MODELS_BASENAMES) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    try {
      if (HAS_PROVIDER_MODELS.test(readFileSync(path, 'utf8'))) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function readRoxApiKey(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
  return env?.[LIVE_TURN_REQUIRED_SECRET]?.trim() ?? '';
}

function blockedSteps(): Record<LiveTurnStepId, LiveTurnStepResult> {
  return Object.fromEntries(LIVE_TURN_STEPS.map((step) => [step, 'BLOCKED'])) as Record<
    LiveTurnStepId,
    LiveTurnStepResult
  >;
}

function notRunSteps(): Record<LiveTurnStepId, LiveTurnStepResult> {
  return Object.fromEntries(LIVE_TURN_STEPS.map((step) => [step, 'NOT_RUN'])) as Record<
    LiveTurnStepId,
    LiveTurnStepResult
  >;
}

export function inspectLiveTurnCredential(
  input: LiveTurnCredentialInspectInput,
): LiveTurnCredentialInspect {
  const hasRoxApiKey = Boolean(readRoxApiKey(input.env));
  const models = hasOmpModelsYml(input.homeDir);
  if (!hasRoxApiKey) {
    return {
      hasRoxApiKey: false,
      hasOmpModelsYml: models,
      ready: false,
      missingSecret: LIVE_TURN_REQUIRED_SECRET,
    };
  }
  return {
    hasRoxApiKey: true,
    hasOmpModelsYml: models,
    ready: true,
    missingSecret: null,
  };
}

export function evaluateLiveTurnGate(inspect: LiveTurnCredentialInspect): LiveTurnGate {
  if (!inspect.ready) {
    const secret = inspect.missingSecret ?? LIVE_TURN_REQUIRED_SECRET;
    return {
      status: 'BLOCKED',
      missingSecret: secret,
      reason: `Live first-turn E2E is BLOCKED — missing secret ${secret}. Do not claim stream / host tool / MCP tool / permission as VERIFIED.`,
      claim: 'live-turn-not-claimed',
      steps: blockedSteps(),
    };
  }
  return {
    status: 'READY',
    missingSecret: null,
    reason:
      'Credential is present. Gate is READY, not VERIFIED — run the live turn and pass log + browser trace to claimLiveTurnVerified.',
    claim: 'live-turn-not-claimed',
    steps: notRunSteps(),
  };
}

export function formatLiveTurnEvidence(gate: LiveTurnGate): string {
  const lines = [
    `status: ${gate.status}`,
    `claim: ${gate.claim}`,
    `missingSecret: ${gate.missingSecret ?? 'none'}`,
    `reason: ${gate.reason}`,
    'steps:',
    ...LIVE_TURN_STEPS.map((step) => `  ${step}: ${gate.steps[step]}`),
  ];
  if (gate.logPath) lines.push(`logPath: ${gate.logPath}`);
  if (gate.browserTracePath) lines.push(`browserTracePath: ${gate.browserTracePath}`);
  return lines.join('\n');
}

export function claimLiveTurnVerified(input: LiveTurnVerifiedInput): LiveTurnGate {
  if (input.gate.status === 'BLOCKED' || input.gate.missingSecret) {
    throw new Error(
      `Cannot claim a live turn while the gate is BLOCKED (missing ${input.gate.missingSecret ?? LIVE_TURN_REQUIRED_SECRET}).`,
    );
  }
  if (!existsSync(input.logPath)) {
    throw new Error(`Live-turn log is missing: ${input.logPath}`);
  }
  if (!existsSync(input.browserTracePath)) {
    throw new Error(`Live-turn browser trace is missing: ${input.browserTracePath}`);
  }
  for (const step of LIVE_TURN_STEPS) {
    if (!input.stepEvidence[step]?.verified) {
      throw new Error(`Live-turn step ${step} has no verified evidence.`);
    }
  }
  const steps = Object.fromEntries(LIVE_TURN_STEPS.map((step) => [step, 'VERIFIED'])) as Record<
    LiveTurnStepId,
    LiveTurnStepResult
  >;
  return {
    status: 'READY',
    missingSecret: null,
    reason: 'Live first-turn E2E verified from log + browser trace.',
    claim: 'live-turn-verified',
    steps,
    logPath: input.logPath,
    browserTracePath: input.browserTracePath,
  };
}

export function inspectThisEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
): LiveTurnGate {
  return evaluateLiveTurnGate(inspectLiveTurnCredential({ homeDir, env }));
}
