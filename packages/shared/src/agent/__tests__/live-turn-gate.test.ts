/**
 * Ticket 13 — live-credential first-turn E2E gate.
 *
 * A live stream + host tool + MCP tool + permission + restart restore
 * may be claimed VERIFIED only when a real credential produced a log
 * and a browser trace. Missing ROX_API_KEY is BLOCKED (named), never
 * a fake green.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_ERROR_CODES, isAgentErrorCode } from '@craft-agent/core/types';
import {
  LIVE_TURN_REQUIRED_SECRET,
  LIVE_TURN_STEPS,
  claimLiveTurnVerified,
  evaluateLiveTurnGate,
  formatLiveTurnEvidence,
  inspectLiveTurnCredential,
  type LiveTurnStepId,
} from '../live-turn-gate.ts';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'live-turn-gate-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BOUNDED_NEGATIVE_CODES = [
  'OMP_NO_MODELS',
  'OMP_AUTH_REQUIRED',
  'OMP_NOT_CONFIGURED',
  'OMP_START_FAILED',
  'OMP_PROTOCOL_ERROR',
  'mcp_unreachable',
  'invalid_credentials',
] as const;

describe('inspectLiveTurnCredential', () => {
  it('names ROX_API_KEY when the env key is missing', () => {
    const homeDir = tempHome();
    const inspect = inspectLiveTurnCredential({ homeDir, env: {} });

    expect(inspect.hasRoxApiKey).toBe(false);
    expect(inspect.hasOmpModelsYml).toBe(false);
    expect(inspect.ready).toBe(false);
    expect(inspect.missingSecret).toBe(LIVE_TURN_REQUIRED_SECRET);
    expect(inspect.missingSecret).toBe('ROX_API_KEY');
  });

  it('is ready when ROX_API_KEY is present (provision can create models.yml)', () => {
    const homeDir = tempHome();
    const inspect = inspectLiveTurnCredential({
      homeDir,
      env: { ROX_API_KEY: 'rox-live-test-key' },
    });

    expect(inspect.hasRoxApiKey).toBe(true);
    expect(inspect.ready).toBe(true);
    expect(inspect.missingSecret).toBeNull();
  });

  it('blank ROX_API_KEY is still missing', () => {
    const homeDir = tempHome();
    const inspect = inspectLiveTurnCredential({
      homeDir,
      env: { ROX_API_KEY: '   ' },
    });

    expect(inspect.hasRoxApiKey).toBe(false);
    expect(inspect.ready).toBe(false);
    expect(inspect.missingSecret).toBe('ROX_API_KEY');
  });

  it('records existing ~/.omp/agent/models.yml without treating it as a credential', () => {
    const homeDir = tempHome();
    const agentDir = join(homeDir, '.omp', 'agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'models.yml'),
      [
        'providers:',
        '  rox:',
        '    apiKey: ROX_API_KEY',
        '    models:',
        '      - id: kimi-K3',
        '',
      ].join('\n'),
    );

    const inspect = inspectLiveTurnCredential({ homeDir, env: {} });
    expect(inspect.hasOmpModelsYml).toBe(true);
    expect(inspect.ready).toBe(false);
    expect(inspect.missingSecret).toBe('ROX_API_KEY');
  });
});

describe('evaluateLiveTurnGate', () => {
  it('BLOCKED gate names ROX_API_KEY and does not claim a live turn', () => {
    const gate = evaluateLiveTurnGate(
      inspectLiveTurnCredential({ homeDir: tempHome(), env: {} }),
    );

    expect(gate.status).toBe('BLOCKED');
    expect(gate.missingSecret).toBe('ROX_API_KEY');
    expect(gate.claim).toBe('live-turn-not-claimed');
    expect(gate.reason).toMatch(/ROX_API_KEY/);
    for (const step of LIVE_TURN_STEPS) {
      expect(gate.steps[step]).toBe('BLOCKED');
    }
  });

  it('READY gate still does not claim VERIFIED (gate is not a live run)', () => {
    const gate = evaluateLiveTurnGate(
      inspectLiveTurnCredential({
        homeDir: tempHome(),
        env: { ROX_API_KEY: 'rox-live-test-key' },
      }),
    );

    expect(gate.status).toBe('READY');
    expect(gate.missingSecret).toBeNull();
    expect(gate.claim).toBe('live-turn-not-claimed');
    for (const step of LIVE_TURN_STEPS) {
      expect(gate.steps[step]).toBe('NOT_RUN');
    }
  });

  it('formatLiveTurnEvidence stays honest on BLOCKED', () => {
    const gate = evaluateLiveTurnGate(
      inspectLiveTurnCredential({ homeDir: tempHome(), env: {} }),
    );
    const text = formatLiveTurnEvidence(gate);

    expect(text).toMatch(/BLOCKED/);
    expect(text).toMatch(/ROX_API_KEY/);
    expect(text).not.toMatch(/live-turn-verified/);
    expect(text).not.toMatch(/\bVERIFIED\b.*stream_answer/);
  });
});

describe('claimLiveTurnVerified', () => {
  it('refuses to mark VERIFIED without log + browser trace files', () => {
    const gate = evaluateLiveTurnGate(
      inspectLiveTurnCredential({
        homeDir: tempHome(),
        env: { ROX_API_KEY: 'rox-live-test-key' },
      }),
    );

    expect(() =>
      claimLiveTurnVerified({
        gate,
        logPath: join(tempHome(), 'missing-log.txt'),
        browserTracePath: join(tempHome(), 'missing-trace.json'),
        stepEvidence: Object.fromEntries(
          LIVE_TURN_STEPS.map((step) => [step, { verified: true, note: 'fake' }]),
        ) as Record<LiveTurnStepId, { verified: true; note: string }>,
      }),
    ).toThrow(/log|browser|trace|missing/i);
  });

  it('marks VERIFIED only when READY and both evidence files exist', () => {
    const homeDir = tempHome();
    const logPath = join(homeDir, 'turn.log');
    const browserTracePath = join(homeDir, 'trace.json');
    writeFileSync(logPath, 'text_delta + host_tool + mcp + permission');
    writeFileSync(browserTracePath, '{"trace":true}');

    const gate = evaluateLiveTurnGate(
      inspectLiveTurnCredential({
        homeDir,
        env: { ROX_API_KEY: 'rox-live-test-key' },
      }),
    );
    const verified = claimLiveTurnVerified({
      gate,
      logPath,
      browserTracePath,
      stepEvidence: Object.fromEntries(
        LIVE_TURN_STEPS.map((step) => [step, { verified: true, note: 'fixture' }]),
      ) as Record<LiveTurnStepId, { verified: true; note: string }>,
    });

    expect(verified.claim).toBe('live-turn-verified');
    for (const step of LIVE_TURN_STEPS) {
      expect(verified.steps[step]).toBe('VERIFIED');
    }
  });

  it('refuses to mark VERIFIED from a BLOCKED gate even if files exist', () => {
    const homeDir = tempHome();
    const logPath = join(homeDir, 'turn.log');
    const browserTracePath = join(homeDir, 'trace.json');
    writeFileSync(logPath, 'not a live turn');
    writeFileSync(browserTracePath, '{}');

    const gate = evaluateLiveTurnGate(
      inspectLiveTurnCredential({ homeDir, env: {} }),
    );

    expect(() =>
      claimLiveTurnVerified({
        gate,
        logPath,
        browserTracePath,
        stepEvidence: Object.fromEntries(
          LIVE_TURN_STEPS.map((step) => [step, { verified: true, note: 'fake' }]),
        ) as Record<LiveTurnStepId, { verified: true; note: string }>,
      }),
    ).toThrow(/BLOCKED|ROX_API_KEY/i);
  });
});

describe('Wave 5 negative-path codes stay on the agent union', () => {
  it('bounded negative codes remain typed ErrorCode members', () => {
    for (const code of BOUNDED_NEGATIVE_CODES) {
      expect(AGENT_ERROR_CODES.includes(code)).toBe(true);
      expect(isAgentErrorCode(code)).toBe(true);
    }
  });
});
