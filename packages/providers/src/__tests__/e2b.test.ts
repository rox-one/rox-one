/**
 * E2B adapter tests.
 *
 * Every test injects a fake `fetch`, so the file is offline by construction:
 * `createE2BProvider` only ever calls `config.fetch`. The fake records method,
 * URL, headers and the raw request body (JSON or bytes), so a field that stops
 * being mapped — or a Connect frame that stops being a frame — shows up here.
 *
 * Connect responses are built with the framing written out by hand rather than
 * with a helper from the adapter: a bug in the adapter's own frame reader must
 * be able to fail these tests.
 */

import { expect, test } from 'bun:test';
import type { SandboxSpec } from '../../../cloud-runner/src/sandbox.ts';
import { CloudRunnerError } from '../../../cloud-runner/src/types.ts';
import { createE2BProvider, type E2BProviderConfig } from '../e2b.ts';

const CREATED_AT = 1_700_000_000_000;
const API = 'https://api.e2b.test';
const SANDBOX = 'https://sandbox.e2b.test';

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
  snapshot: 'rox-base',
  cpu: 2,
  memoryGb: 4,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createdResponse(): Response {
  return json(
    { templateID: 'rox-base', sandboxID: 'e2b-1', envdAccessToken: 'envd-token' },
    201,
  );
}

/** One Connect frame, built the way the protocol documents it. */
function frame(payload: unknown, flags = 0): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const out = new Uint8Array(5 + body.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, body.length, false);
  out.set(body, 5);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A streamed Connect response body: data frames plus the terminal frame. */
function connectStream(frames: Uint8Array[]): Response {
  return new Response(concat(frames), {
    status: 200,
    headers: { 'Content-Type': 'application/connect+json' },
  });
}

/** Base64 of ASCII text the way the vendor encodes a data event. */
function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function setup(respond: Responder, config: Partial<E2BProviderConfig> = {}) {
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

  const provider = createE2BProvider({
    id: 'e2b',
    // Trailing slashes must not produce `//v2/sandboxes`.
    apiUrl: `${API}/`,
    apiKey: 'tenant-key',
    sandboxHost: `${SANDBOX}/`,
    defaultTemplate: 'default-tpl',
    fetch: fake,
    now: () => CREATED_AT,
    ...config,
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

async function errorMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to fail');
}

/** Responds to create with a sandbox and to everything else with `other`. */
function createdThen(other: Responder): Responder {
  return (call) =>
    call.method === 'POST' && call.url.endsWith('/v2/sandboxes') ? createdResponse() : other(call);
}

test('create maps every contract field and sends the API key header', async () => {
  const { provider, calls } = setup(() => createdResponse());

  const status = await provider.create({
    ...baseSpec,
    cpu: 2.4,
    ttlSec: 600,
    env: { ROX_TENANT: 'acme' },
    metadata: { tenant: 'acme' },
  });

  expect(calls.length).toBe(1);
  const call = calls[0]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe(`${API}/v2/sandboxes`);
  expect(call.headers['X-API-Key']).toBe('tenant-key');
  expect(call.headers['Content-Type']).toBe('application/json');
  expect(call.json).toEqual({
    templateID: 'rox-base',
    timeout: 600,
    cpuCount: 3,
    metadata: { tenant: 'acme' },
    envVars: { ROX_TENANT: 'acme' },
  });
  expect(status).toEqual({
    id: 'sbx-1',
    provider: 'e2b',
    state: 'running',
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
    expiresAt: CREATED_AT + 600_000,
  });
  // The key belongs in the header only, never in a URL.
  expect(call.url.includes('tenant-key')).toBe(false);
});

test('create falls back to the vendor default timeout and omits unset fields', async () => {
  const { provider, calls } = setup(() => createdResponse());

  await provider.create({ id: 'sbx-2', os: 'linux', snapshot: 'rox-base', cpu: 1, memoryGb: 1 });

  expect(calls[0]!.json).toEqual({ templateID: 'rox-base', timeout: 300, cpuCount: 1 });
});

test('create sends the contract id as the idempotency key and a second call does not POST', async () => {
  const { provider, calls } = setup(() => createdResponse());

  const first = await provider.create(baseSpec);
  const second = await provider.create({ ...baseSpec, cpu: 8 });

  expect(calls.length).toBe(1);
  expect(calls[0]!.headers['Idempotency-Key']).toBe('sbx-1');
  expect(second).toEqual(first);
});

test('an id outside the vendor alphabet still yields a valid, stable idempotency key', async () => {
  const spec: SandboxSpec = { ...baseSpec, id: 'Tenant_A/7' };

  const one = await setup(() => createdResponse());
  await one.provider.create(spec);
  const key = one.calls[0]!.headers['Idempotency-Key'] ?? '';

  // E2B documents `^[a-z0-9-]{1,255}$` and rejects anything else.
  expect(/^[a-z0-9-]{1,255}$/.test(key)).toBe(true);
  expect(key.startsWith('tenant-a-7-')).toBe(true);

  const two = await setup(() => createdResponse());
  await two.provider.create(spec);
  expect(two.calls[0]!.headers['Idempotency-Key']).toBe(key);
});

test('the configured template is used when the spec carries no snapshot', async () => {
  const { provider, calls } = setup(() => createdResponse());

  await provider.create({ ...baseSpec, snapshot: undefined });

  expect((calls[0]!.json as Record<string, unknown>).templateID).toBe('default-tpl');
});

test('a snapshot overrides the configured default template', async () => {
  const { provider, calls } = setup(() => createdResponse());

  await provider.create({ ...baseSpec, snapshot: 'snap-42' });

  expect((calls[0]!.json as Record<string, unknown>).templateID).toBe('snap-42');
});

test('no template at all is an invalid spec', async () => {
  const { provider, calls } = setup(() => createdResponse(), { defaultTemplate: undefined });

  await expectCode(
    () => provider.create({ ...baseSpec, snapshot: undefined }),
    'invalid_spec',
  );
  expect(calls.length).toBe(0);
});

const rejections: ReadonlyArray<readonly [string, SandboxSpec]> = [
  ['a non-Linux guest', { ...baseSpec, os: 'windows' }],
  ['a GPU', { ...baseSpec, gpu: { type: 'a10', count: 1 } }],
  ['a disk size', { ...baseSpec, diskGb: 20 }],
  ['an image without a snapshot', { ...baseSpec, snapshot: undefined, image: 'ubuntu:24.04' }],
];

for (const [label, spec] of rejections) {
  test(`create refuses ${label} before any request`, async () => {
    const { provider, calls } = setup(() => createdResponse());

    await expectCode(() => provider.create(spec), 'capability_unavailable');
    expect(calls.length).toBe(0);
  });
}

test('get maps the running state through', async () => {
  const { provider } = setup(
    createdThen(() =>
      json({
        sandboxID: 'e2b-1',
        state: 'running',
        startedAt: '2026-11-19T10:00:00.000Z',
        endAt: '2026-11-19T11:00:00.000Z',
      }),
    ),
  );

  await provider.create(baseSpec);
  const status = await provider.get('sbx-1');

  expect(status.state).toBe('running');
  expect(status.provider).toBe('e2b');
  expect(status.createdAt).toBe(CREATED_AT);
  expect(status.startedAt).toBe(Date.parse('2026-11-19T10:00:00.000Z'));
  expect(status.expiresAt).toBe(Date.parse('2026-11-19T11:00:00.000Z'));
});

test('get maps a paused sandbox to stopped', async () => {
  const { provider } = setup(
    createdThen(() => json({ sandboxID: 'e2b-1', state: 'paused' })),
  );

  await provider.create(baseSpec);
  const status = await provider.get('sbx-1');

  // E2B has no pause state in the contract; a paused sandbox is resumable and
  // therefore reads as stopped.
  expect(status.state).toBe('stopped');
});

test('a 404 on get forgets the sandbox without asking again', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 404 })));

  await provider.create(baseSpec);

  await expectCode(() => provider.get('sbx-1'), 'not_found');
  const afterFirstGet = calls.length;
  await expectCode(() => provider.get('sbx-1'), 'not_found');
  expect(calls.length).toBe(afterFirstGet);
});

test('exec sends one Connect frame and decodes the streamed result', async () => {
  const { provider, calls } = setup(
    createdThen(() =>
      connectStream([
        frame({ event: { start: { pid: 11 } } }),
        frame({ event: { data: { stdout: base64('hi\n') } } }),
        frame({ event: { data: { stderr: base64('careful') } } }),
        frame({ event: { end: { exitCode: 3, exited: true, status: 'exit' } } }),
        frame({}, 2),
      ]),
    ),
  );

  await provider.create(baseSpec);
  const result = await provider.exec('sbx-1', 'echo hi', {
    cwd: '/home/user',
    env: { A: '1' },
    timeoutMs: 4321,
  });

  expect(result).toEqual({ stdout: 'hi\n', stderr: 'careful', exitCode: 3 });

  const call = calls[1]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe(`${SANDBOX}/process.Process/Start`);
  expect(call.headers['Content-Type']).toBe('application/connect+json');
  expect(call.headers['Connect-Protocol-Version']).toBe('1');
  expect(call.headers['E2b-Sandbox-Id']).toBe('e2b-1');
  expect(call.headers['E2b-Sandbox-Port']).toBe('49983');
  expect(call.headers['X-Access-Token']).toBe('envd-token');
  expect(call.headers['Connect-Timeout-Ms']).toBe('4321');

  const bytes = call.bytes ?? new Uint8Array();
  expect(bytes[0]).toBe(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payloadLength = view.getUint32(1, false);
  expect(payloadLength).toBe(bytes.length - 5);
  const payload = JSON.parse(new TextDecoder().decode(bytes.subarray(5)));
  expect(payload).toEqual({
    process: {
      cmd: 'bash',
      args: ['-lc', 'echo hi'],
      cwd: '/home/user',
      envs: { A: '1' },
    },
    stdin: false,
  });
});

test('exec returns a non-zero exit code as a normal result', async () => {
  const { provider } = setup(
    createdThen(() =>
      connectStream([frame({ event: { end: { exitCode: 127, exited: true } } }), frame({}, 2)]),
    ),
  );

  await provider.create(baseSpec);

  expect(await provider.exec('sbx-1', 'nope')).toEqual({ stdout: '', stderr: '', exitCode: 127 });
});

test('an end-stream error becomes provider_error', async () => {
  const { provider } = setup(
    createdThen(() => connectStream([frame({ error: { code: 'invalid_argument', message: 'bad' } }, 2)])),
  );

  await provider.create(baseSpec);

  await expectCode(() => provider.exec('sbx-1', 'echo hi'), 'provider_error');
});

test('a stream without an end event becomes provider_error', async () => {
  const { provider } = setup(
    createdThen(() => connectStream([frame({ event: { start: { pid: 1 } } })])),
  );

  await provider.create(baseSpec);

  await expectCode(() => provider.exec('sbx-1', 'echo hi'), 'provider_error');
});

test('readFile fetches bytes with the sandbox headers', async () => {
  const { provider, calls } = setup(
    createdThen(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
  );

  await provider.create(baseSpec);
  const bytes = await provider.readFile('sbx-1', '/tmp/a b.txt');

  expect(Array.from(bytes)).toEqual([1, 2, 3]);
  const call = calls[1]!;
  expect(call.method).toBe('GET');
  expect(call.url).toBe(`${SANDBOX}/files?path=%2Ftmp%2Fa%20b.txt`);
  expect(call.headers['E2b-Sandbox-Id']).toBe('e2b-1');
  expect(call.headers['E2b-Sandbox-Port']).toBe('49983');
  expect(call.headers['X-Access-Token']).toBe('envd-token');
  expect(call.headers['X-API-Key']).toBeUndefined();
});

test('writeFile posts raw bytes and accepts a 200 with a JSON body', async () => {
  const { provider, calls } = setup(
    createdThen(() => json([{ path: '/tmp/out.bin', name: 'out.bin', type: 'file' }])),
  );

  await provider.create(baseSpec);
  await provider.writeFile('sbx-1', '/tmp/out.bin', new Uint8Array([9, 8, 7]));

  const call = calls[1]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe(`${SANDBOX}/files?path=%2Ftmp%2Fout.bin`);
  expect(call.headers['Content-Type']).toBe('application/octet-stream');
  expect(call.headers['E2b-Sandbox-Id']).toBe('e2b-1');
  expect(call.headers['X-Access-Token']).toBe('envd-token');
  expect(Array.from(call.bytes ?? [])).toEqual([9, 8, 7]);
});

test('stop pauses the sandbox and destroy deletes it', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 204 })));

  await provider.create(baseSpec);
  await provider.stop('sbx-1');
  expect(calls[1]!.method).toBe('POST');
  expect(calls[1]!.url).toBe(`${API}/sandboxes/e2b-1/pause`);
  expect(calls[1]!.headers['X-API-Key']).toBe('tenant-key');

  await provider.destroy('sbx-1');
  expect(calls[2]!.method).toBe('DELETE');
  expect(calls[2]!.url).toBe(`${API}/sandboxes/e2b-1`);

  // No network call: the adapter already forgot the id.
  await expectCode(() => provider.get('sbx-1'), 'not_found');
  expect(calls.length).toBe(3);
});

test('destroying an already-gone sandbox is success', async () => {
  const { provider } = setup(createdThen(() => new Response(null, { status: 404 })));

  await provider.create(baseSpec);
  await provider.destroy('sbx-1');

  await expectCode(() => provider.get('sbx-1'), 'not_found');
});

test('an HTTP 500 becomes provider_error', async () => {
  const { provider } = setup(() => json({ message: 'boom' }, 500));

  await expectCode(() => provider.create(baseSpec), 'provider_error');
});

test('a 500 on exec becomes provider_error', async () => {
  const { provider } = setup(createdThen(() => new Response('routing failure', { status: 500 })));

  await provider.create(baseSpec);

  await expectCode(() => provider.exec('sbx-1', 'true'), 'provider_error');
});

test('a transport failure becomes provider_error', async () => {
  const { provider } = setup(() => {
    throw new Error('socket closed');
  });

  await expectCode(() => provider.create(baseSpec), 'provider_error');
});

test('the key and the access token never appear in an error message', async () => {
  const messages: string[] = [];

  const unauthorized = setup(() => json({ message: 'unauthorized' }, 401));
  messages.push(await errorMessage(() => unauthorized.provider.create(baseSpec)));

  const broken = setup(() => json({ message: 'boom' }, 500));
  messages.push(await errorMessage(() => broken.provider.create(baseSpec)));

  const { provider } = setup(createdThen(() => json({ message: 'unauthorized' }, 401)));
  await provider.create(baseSpec);
  messages.push(await errorMessage(() => provider.exec('sbx-1', 'echo hi')));
  messages.push(await errorMessage(() => provider.readFile('sbx-1', '/etc/hosts')));
  messages.push(await errorMessage(() => provider.writeFile('sbx-1', '/tmp/x', new Uint8Array([1]))));

  expect(messages.length).toBe(5);
  // The HTTP status is the whole story a caller gets.
  expect(messages[0]).toContain('401');
  for (const message of messages) {
    expect(message.includes('tenant-key')).toBe(false);
    expect(message.includes('envd-token')).toBe(false);
  }
});
