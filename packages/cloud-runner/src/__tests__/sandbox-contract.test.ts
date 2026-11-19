/**
 * Sandbox resource contract — suite + surface.
 *
 * The fake below is deliberately dumb: a map of machines, an `echo`-only
 * shell and a files map. It proves the suite can be satisfied without any
 * vendor SDK, which is the point of the vendor-neutral interface.
 */
import { describe, expect, test } from 'bun:test';
import { sandboxConformanceSuite } from '../conformance.ts';
import type {
  SandboxExecOptions,
  SandboxExecResult,
  SandboxProvider,
  SandboxSpec,
  SandboxStatus,
} from '../sandbox.ts';
import { CloudRunnerError } from '../types.ts';

interface FakeSandbox {
  status: SandboxStatus;
  files: Map<string, Uint8Array>;
}

function runFakeCommand(command: string, _opts?: SandboxExecOptions): SandboxExecResult {
  const trimmed = command.trim();
  if (trimmed.startsWith('echo ')) {
    return { stdout: `${trimmed.slice('echo '.length)}\n`, stderr: '', exitCode: 0 };
  }
  return { stdout: '', stderr: `unsupported command: ${trimmed}\n`, exitCode: 127 };
}

function createMemorySandboxProvider(providerId = 'memory'): SandboxProvider {
  const sandboxes = new Map<string, FakeSandbox>();
  let clock = 1_700_000_000_000;

  const lookup = (id: string, allowStopped = false): FakeSandbox => {
    const box = sandboxes.get(id);
    if (!box) throw new CloudRunnerError(`sandbox not found: ${id}`, 'not_found');
    if (!allowStopped && box.status.state === 'stopped') {
      throw new CloudRunnerError(`sandbox is stopped: ${id}`, 'provider_error');
    }
    return box;
  };

  return {
    providerId,

    async create(spec: SandboxSpec): Promise<SandboxStatus> {
      const existing = sandboxes.get(spec.id);
      if (existing) return { ...existing.status };
      const createdAt = clock++;
      const status: SandboxStatus = {
        id: spec.id,
        provider: providerId,
        state: 'running',
        createdAt,
        startedAt: createdAt,
        costSoFarUsd: 0,
        routingReason: 'memory fake: single provider',
        ...(spec.ttlSec !== undefined ? { expiresAt: createdAt + spec.ttlSec * 1000 } : {}),
      };
      sandboxes.set(spec.id, { status, files: new Map() });
      return { ...status };
    },

    async get(id: string): Promise<SandboxStatus> {
      return { ...lookup(id, true).status };
    },

    async exec(id: string, command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
      lookup(id);
      return runFakeCommand(command, opts);
    },

    async readFile(id: string, path: string): Promise<Uint8Array> {
      const box = lookup(id);
      const bytes = box.files.get(path);
      if (!bytes) throw new CloudRunnerError(`file not found: ${path}`, 'not_found');
      return Uint8Array.from(bytes);
    },

    async writeFile(id: string, path: string, data: Uint8Array): Promise<void> {
      lookup(id).files.set(path, Uint8Array.from(data));
    },

    async stop(id: string): Promise<void> {
      lookup(id, true).status.state = 'stopped';
    },

    async destroy(id: string): Promise<void> {
      if (!sandboxes.delete(id)) throw new CloudRunnerError(`sandbox not found: ${id}`, 'not_found');
    },
  };
}

describe('sandbox conformance suite', () => {
  test('an in-memory provider passes all six sandbox checks', async () => {
    const results = await sandboxConformanceSuite(() => createMemorySandboxProvider());
    expect(results).toHaveLength(6);
    for (const result of results) {
      expect(result.error ?? '').toBe('');
      expect(result.ok).toBe(true);
    }
    expect(results.map((r) => r.name)).toEqual([
      'create with the same id is idempotent',
      'exec returns stdout and exit code 0',
      'write then read returns the same bytes',
      'stop yields a stopped sandbox',
      'exec after stop fails',
      'destroy makes get fail with not_found',
    ]);
  });

  test('the suite reports failures instead of throwing them', async () => {
    const broken: SandboxProvider = {
      ...createMemorySandboxProvider(),
      async exec() {
        return { stdout: '', stderr: 'nope', exitCode: 1 };
      },
    };
    const results = await sandboxConformanceSuite(() => broken);
    const execCheck = results.find((r) => r.name === 'exec returns stdout and exit code 0');
    expect(execCheck?.ok).toBe(false);
    expect(execCheck?.error ?? '').toContain('exit code 0');
  });
});

describe('sandbox provider surface', () => {
  test('exposes a provider id and the seven contract methods', () => {
    const provider = createMemorySandboxProvider();
    expect(provider.providerId).toBe('memory');
    const methods: (keyof SandboxProvider)[] = [
      'create',
      'get',
      'exec',
      'readFile',
      'writeFile',
      'stop',
      'destroy',
    ];
    for (const method of methods) {
      expect(typeof provider[method]).toBe('function');
    }
  });

  test('unknown ids surface as not_found', async () => {
    const provider = createMemorySandboxProvider();
    const error = await provider.get('missing').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudRunnerError);
    expect((error as CloudRunnerError).code).toBe('not_found');
  });
});
