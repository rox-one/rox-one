/**
 * Modal adapter tests.
 *
 * Every test injects a fake `fetch`, so the whole file is offline by
 * construction: `createModalProvider` only ever calls `config.fetch`. The fake
 * records method, URL, headers, parsed JSON body and raw bytes, so a field that
 * stops being mapped shows up as a missing body key. The token is asserted in
 * the `Authorization` header and asserted absent from every error message.
 */

import { expect, test } from 'bun:test';
import type { SandboxSpec } from '../../../cloud-runner/src/sandbox.ts';
import { CloudRunnerError } from '../../../cloud-runner/src/types.ts';
import {
  createModalProvider,
  MODAL_DEFAULT_TIMEOUT_SEC,
  type ModalProviderConfig,
} from '../modal.ts';

const CREATED_AT = 1_700_000_000_000;
/** The bridge echoes seconds; the contract speaks epoch milliseconds. */
const CREATED_AT_SEC = CREATED_AT / 1000;
const TOKEN = 'token_id:token_secret';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  json?: unknown;
  bytes?: Uint8Array;
}

type Responder = (call: Call) => Response | Promise<Response>;

const baseSpec: SandboxSpec = {
  id: 'sbx-1',
  os: 'linux',
  image: 'python:3.12-slim',
  cpu: 2,
  memoryGb: 4,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(
  respond: Responder,
  opts: { now?: () => number; plan?: ModalProviderConfig['plan'] } = {},
) {
  const calls: Call[] = [];

  const fake = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    const raw = init?.body;
    if (typeof raw === 'string') call.json = JSON.parse(raw);
    else if (raw instanceof Uint8Array) call.bytes = raw;
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;

  const provider = createModalProvider({
    id: 'modal',
    // A trailing slash must not produce `//v1/sandboxes`.
    apiUrl: 'https://bridge.test/api/',
    apiKey: TOKEN,
    fetch: fake,
    now: opts.now ?? (() => CREATED_AT),
    plan: opts.plan,
  });

  return { provider, calls };
}

async function expectCode(run: () => Promise<unknown>, code: CloudRunnerError['code']): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(CloudRunnerError);
    expect((error as CloudRunnerError).code).toBe(code);
    return;
  }
  throw new Error(`expected CloudRunnerError with code ${code}`);
}

/** Responds to create with a sandbox and to everything else with `other`. */
function createdThen(other: Responder): Responder {
  return (call) =>
    call.method === 'POST' && call.url.endsWith('/v1/sandboxes')
      ? json({ id: 'ms-1', state: 'starting', created_at: CREATED_AT_SEC })
      : other(call);
}

test('create maps every bridge field and sends the bearer header', async () => {
  const { provider, calls } = setup(() =>
    json({ id: 'ms-1', state: 'starting', created_at: CREATED_AT_SEC }),
  );

  const status = await provider.create({
    ...baseSpec,
    gpu: { type: 'a10', count: 2, spot: true },
    ttlSec: 3601,
    env: { ROX_TENANT: 'acme' },
    metadata: { tenant: 'acme' },
  });

  expect(calls.length).toBe(1);
  const call = calls[0]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('https://bridge.test/api/v1/sandboxes');
  expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(call.headers['Content-Type']).toBe('application/json');
  expect(call.json).toEqual({
    cpu: 2,
    memory_mb: 4096,
    timeout_sec: 3601,
    gpu: { type: 'a10', count: 2 },
    image: 'python:3.12-slim',
    env: { ROX_TENANT: 'acme' },
    tags: { tenant: 'acme' },
  });
  expect(status).toMatchObject({
    id: 'sbx-1',
    provider: 'modal',
    state: 'starting',
    createdAt: CREATED_AT,
    expiresAt: CREATED_AT + 3_601_000,
  });
  // The token belongs in the header only, never in a URL.
  expect(call.url.includes('token_secret')).toBe(false);
});

test('create rounds resources and falls back to the five-minute timeout', async () => {
  const { provider, calls } = setup(() =>
    json({ id: 'ms-1', state: 'starting', created_at: CREATED_AT_SEC }),
  );

  const status = await provider.create({ ...baseSpec, cpu: 0.5, memoryGb: 1.5 });

  expect(calls[0]!.json).toEqual({
    cpu: 1,
    memory_mb: 1536,
    timeout_sec: MODAL_DEFAULT_TIMEOUT_SEC,
    image: 'python:3.12-slim',
  });
  expect(status.expiresAt).toBe(CREATED_AT + MODAL_DEFAULT_TIMEOUT_SEC * 1000);
});

test('a second create with the same id does not POST again', async () => {
  const { provider, calls } = setup(() =>
    json({ id: 'ms-1', state: 'starting', created_at: CREATED_AT_SEC }),
  );

  const first = await provider.create(baseSpec);
  const second = await provider.create({ ...baseSpec, cpu: 8 });

  expect(calls.length).toBe(1);
  expect(second).toEqual(first);
});

const stateCases: ReadonlyArray<readonly [string, string]> = [
  ['starting', 'starting'],
  ['running', 'running'],
  ['stopped', 'stopped'],
  ['failed', 'failed'],
  ['expired', 'expired'],
];

for (const [raw, expected] of stateCases) {
  test(`get maps bridge state ${raw} to ${expected}`, async () => {
    const { provider } = setup(createdThen(() =>
      json({ id: 'ms-1', state: raw, created_at: CREATED_AT_SEC }),
    ));

    await provider.create(baseSpec);
    const status = await provider.get('sbx-1');

    expect(String(status.state)).toBe(expected);
    expect(status.provider).toBe('modal');
    expect(status.createdAt).toBe(CREATED_AT);
  });
}

test('a failed sandbox carries a failure reason and a running one a start time', async () => {
  const started = setup(createdThen(() =>
    json({ id: 'ms-1', state: 'running', created_at: CREATED_AT_SEC, started_at: CREATED_AT_SEC }),
  ));
  await started.provider.create(baseSpec);
  expect((await started.provider.get('sbx-1')).startedAt).toBe(CREATED_AT);

  const failed = setup(createdThen(() =>
    json({ id: 'ms-1', state: 'failed', created_at: CREATED_AT_SEC }),
  ));
  await failed.provider.create(baseSpec);
  const status = await failed.provider.get('sbx-1');
  expect(status.state).toBe('failed');
  expect(status.failureReason).toContain('failed');
});

test('a 404 on get forgets the sandbox', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 404 })));

  await provider.create(baseSpec);

  await expectCode(() => provider.get('sbx-1'), 'not_found');
  // The second call never reaches the bridge: the id is already forgotten.
  await expectCode(() => provider.get('sbx-1'), 'not_found');
  expect(calls.length).toBe(2);
});

test('an unknown id is refused without a request', async () => {
  const { provider, calls } = setup(() => json({ id: 'ms-1', state: 'starting' }));

  await expectCode(() => provider.get('nope'), 'not_found');
  expect(calls.length).toBe(0);
});

test('exec posts the command and parses stdout, stderr and the exit code', async () => {
  const { provider, calls } = setup(createdThen(() =>
    json({ stdout: 'hi\n', stderr: 'warn\n', exit_code: 0 }),
  ));

  await provider.create(baseSpec);
  const result = await provider.exec('sbx-1', 'echo hi', { timeoutMs: 5000 });

  const call = calls[1]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('https://bridge.test/api/v1/sandboxes/ms-1/exec');
  expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(call.json).toEqual({ command: 'echo hi', timeout_sec: 5 });
  expect(result).toEqual({ stdout: 'hi\n', stderr: 'warn\n', exitCode: 0 });
});

test('exec passes a non-zero exit code through as a normal result', async () => {
  const { provider } = setup(createdThen(() =>
    json({ stdout: '', stderr: 'not found', exit_code: 127 }),
  ));

  await provider.create(baseSpec);

  expect(await provider.exec('sbx-1', 'nope')).toEqual({
    stdout: '',
    stderr: 'not found',
    exitCode: 127,
  });
});

test('exec turns cwd into a quoted cd and refuses a per-exec env', async () => {
  const { provider, calls } = setup(createdThen(() => json({ stdout: '', stderr: '', exit_code: 0 })));

  await provider.create(baseSpec);
  await provider.exec('sbx-1', 'ls', { cwd: "/tmp/it's" });

  expect(calls[1]!.json).toEqual({ command: "cd -- '/tmp/it'\\''s' && ls" });

  await expectCode(() => provider.exec('sbx-1', 'ls', { env: { A: '1' } }), 'capability_unavailable');
  expect(calls.length).toBe(2);
});

test('readFile downloads bytes from the bridge', async () => {
  const { provider, calls } = setup(createdThen(() =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  ));

  await provider.create(baseSpec);
  const bytes = await provider.readFile('sbx-1', '/tmp/a b.txt');

  expect(Array.from(bytes)).toEqual([1, 2, 3]);
  const call = calls[1]!;
  expect(call.method).toBe('GET');
  expect(call.url).toBe('https://bridge.test/api/v1/sandboxes/ms-1/files?path=%2Ftmp%2Fa%20b.txt');
});

test('writeFile uploads raw bytes and accepts 204', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 204 })));

  await provider.create(baseSpec);
  await provider.writeFile('sbx-1', '/tmp/out.bin', new Uint8Array([9, 8, 7]));

  const call = calls[1]!;
  expect(call.method).toBe('PUT');
  expect(call.url).toBe('https://bridge.test/api/v1/sandboxes/ms-1/files?path=%2Ftmp%2Fout.bin');
  expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(call.headers['Content-Type']).toBe('application/octet-stream');
  expect(Array.from(call.bytes ?? [])).toEqual([9, 8, 7]);
});

test('stop posts /stop and destroy deletes, hiding the sandbox afterwards', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 204 })));

  await provider.create(baseSpec);
  await provider.stop('sbx-1');
  expect(calls[1]!.method).toBe('POST');
  expect(calls[1]!.url).toBe('https://bridge.test/api/v1/sandboxes/ms-1/stop');

  await provider.destroy('sbx-1');
  expect(calls[2]!.method).toBe('DELETE');
  expect(calls[2]!.url).toBe('https://bridge.test/api/v1/sandboxes/ms-1');

  // No network call: the adapter already forgot the id.
  await expectCode(() => provider.get('sbx-1'), 'not_found');
  expect(calls.length).toBe(3);
});

test('destroy treats a missing sandbox as already gone', async () => {
  const { provider } = setup(createdThen(() => new Response(null, { status: 404 })));

  await provider.create(baseSpec);
  await provider.destroy('sbx-1');

  await expectCode(() => provider.get('sbx-1'), 'not_found');
});

test('an HTTP 500 becomes provider_error and never leaks the token', async () => {
  const { provider } = setup(() =>
    json({ error: { code: 'boom', message: `bad token ${TOKEN}` } }, 500),
  );

  try {
    await provider.create(baseSpec);
  } catch (error) {
    expect(error).toBeInstanceOf(CloudRunnerError);
    expect((error as CloudRunnerError).code).toBe('provider_error');
    expect((error as CloudRunnerError).message.includes('token_secret')).toBe(false);
    expect((error as CloudRunnerError).message).toContain('HTTP 500');
    return;
  }
  throw new Error('expected the create to fail');
});

test('a transport failure becomes provider_error without the token', async () => {
  const { provider } = setup(() => {
    throw new Error(`socket closed while sending ${TOKEN}`);
  });

  try {
    await provider.create(baseSpec);
  } catch (error) {
    expect((error as CloudRunnerError).code).toBe('provider_error');
    // The vendor's own message may echo anything, so it is not forwarded.
    expect((error as CloudRunnerError).message.includes('token_secret')).toBe(false);
    expect((error as CloudRunnerError).message).toContain('https://bridge.test/api/v1/sandboxes');
    return;
  }
  throw new Error('expected the create to fail');
});

test('a missing token is refused before any request', async () => {
  let called = false;
  const fake = (async () => {
    called = true;
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  await expectCode(
    async () => {
      createModalProvider({ id: 'modal', apiUrl: 'https://bridge.test/api', apiKey: '', fetch: fake });
    },
    'invalid_spec',
  );
  expect(called).toBe(false);
});

test('a missing bridge URL is refused before any request', async () => {
  await expectCode(
    async () => {
      createModalProvider({ id: 'modal', apiUrl: '', apiKey: TOKEN });
    },
    'invalid_spec',
  );
});

test('macOS is refused with capability_unavailable before any request', async () => {
  const { provider, calls } = setup(() => json({ id: 'ms-1', state: 'starting' }));

  await expectCode(() => provider.create({ ...baseSpec, os: 'macos' }), 'capability_unavailable');
  expect(calls.length).toBe(0);
});

test('GPU on the free plan is refused before any request', async () => {
  const { provider, calls } = setup(
    () => json({ id: 'ms-1', state: 'starting' }),
    { plan: 'free' },
  );

  await expectCode(
    () => provider.create({ ...baseSpec, gpu: { type: 'a10', count: 1 } }),
    'capability_unavailable',
  );
  expect(calls.length).toBe(0);
});

test('fields the bridge cannot express are refused instead of dropped', async () => {
  const { provider, calls } = setup(() => json({ id: 'ms-1', state: 'starting' }));

  await expectCode(() => provider.create({ ...baseSpec, snapshot: 'snap-1' }), 'capability_unavailable');
  await expectCode(() => provider.create({ ...baseSpec, diskGb: 20 }), 'capability_unavailable');
  await expectCode(() => provider.create({ ...baseSpec, idleTimeoutSec: 60 }), 'capability_unavailable');

  expect(calls.length).toBe(0);
});
