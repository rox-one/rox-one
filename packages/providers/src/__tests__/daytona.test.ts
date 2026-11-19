/**
 * Daytona adapter tests.
 *
 * Every test injects a fake `fetch`, so the whole file is offline by
 * construction: `createDaytonaProvider` only ever calls `config.fetch`.
 * The fake records method, URL, headers, parsed JSON body and raw bytes, so
 * a field that stops being mapped shows up as a missing body key.
 */

import { expect, test } from 'bun:test';
import type { SandboxSpec } from '../../../cloud-runner/src/sandbox.ts';
import { CloudRunnerError } from '../../../cloud-runner/src/types.ts';
import {
  createDaytonaProvider,
  DAYTONA_AUTO_DELETE_MINUTES,
  DAYTONA_AUTO_STOP_MINUTES,
} from '../daytona.ts';

const CREATED_AT = 1_700_000_000_000;

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

function setup(respond: Responder, opts: { now?: () => number } = {}) {
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

  const provider = createDaytonaProvider({
    id: 'daytona',
    // Trailing slashes must not produce `//sandbox`.
    apiUrl: 'https://daytona.test/api/',
    apiKey: 'tenant-key',
    toolboxUrl: 'https://toolbox.test/toolbox/',
    fetch: fake,
    now: opts.now ?? (() => CREATED_AT),
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
    call.method === 'POST' && call.url.endsWith('/sandbox') ? json({ id: 'dt-1', state: 'started' }) : other(call);
}

test('create maps every contract field and sends the bearer header', async () => {
  const { provider, calls } = setup(() => json({ id: 'dt-1', state: 'started' }));

  const status = await provider.create({
    ...baseSpec,
    diskGb: 10,
    gpu: { type: 'h100', count: 1, spot: true },
    ttlSec: 3601,
    env: { ROX_TENANT: 'acme' },
    metadata: { tenant: 'acme' },
  });

  expect(calls.length).toBe(1);
  const call = calls[0]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('https://daytona.test/api/sandbox');
  expect(call.headers.Authorization).toBe('Bearer tenant-key');
  expect(call.headers['Content-Type']).toBe('application/json');
  expect(call.json).toEqual({
    // Resources are inherited from the snapshot and must not be sent with it.
    snapshot: 'rox-base',
    env: { ROX_TENANT: 'acme' },
    labels: { tenant: 'acme' },
    autoStopInterval: DAYTONA_AUTO_STOP_MINUTES,
    autoDeleteInterval: DAYTONA_AUTO_DELETE_MINUTES,
  });
  expect(status).toMatchObject({
    id: 'sbx-1',
    provider: 'daytona',
    state: 'running',
    createdAt: CREATED_AT,
    expiresAt: CREATED_AT + 3_601_000,
  });
  // The key belongs in the header only, never in a URL.
  expect(call.url.includes('tenant-key')).toBe(false);
});

test('create omits what the spec did not ask for', async () => {
  const { provider, calls } = setup(() => json({ id: 'dt-1', state: 'started' }));

  await provider.create({ id: 'sbx-2', os: 'linux', snapshot: 'rox-base', cpu: 1, memoryGb: 1 });

  expect(calls[0]!.json).toEqual({
    snapshot: 'rox-base',
    autoStopInterval: DAYTONA_AUTO_STOP_MINUTES,
    autoDeleteInterval: DAYTONA_AUTO_DELETE_MINUTES,
  });
});

test('a request above the default snapshot is refused before any request', async () => {
  const { provider, calls } = setup(() => json({ id: 'dt-1', state: 'started' }));

  await expect(
    provider.create({ id: 'sbx-3', os: 'linux', cpu: 2, memoryGb: 4 }),
  ).rejects.toMatchObject({ code: 'capability_unavailable' });
  expect(calls.length).toBe(0);
});

test('a default-sized request uses the default snapshot without naming it', async () => {
  const { provider, calls } = setup(() => json({ id: 'dt-1', state: 'started' }));

  await provider.create({ id: 'sbx-4', os: 'linux', cpu: 1, memoryGb: 1 });

  expect(calls[0]!.json).toEqual({
    autoStopInterval: DAYTONA_AUTO_STOP_MINUTES,
    autoDeleteInterval: DAYTONA_AUTO_DELETE_MINUTES,
  });
});

test('a second create with the same id does not POST again', async () => {
  const { provider, calls } = setup(() => json({ id: 'dt-1', state: 'started' }));

  const first = await provider.create(baseSpec);
  const second = await provider.create({ ...baseSpec, cpu: 8 });

  expect(calls.length).toBe(1);
  expect(second).toEqual(first);
});

const stateCases: ReadonlyArray<readonly [string, string]> = [
  ['started', 'running'],
  ['paused', 'paused'],
  ['error', 'failed'],
  ['pulling_snapshot', 'starting'],
  ['archiving', 'stopping'],
  ['archived', 'stopped'],
  ['destroying', 'stopping'],
];

for (const [raw, expected] of stateCases) {
  test(`get maps Daytona state ${raw} to ${expected}`, async () => {
    const { provider } = setup(() => json({ id: 'dt-1', state: raw }));

    await provider.create(baseSpec);
    const status = await provider.get('sbx-1');

    expect(String(status.state)).toBe(expected);
    expect(status.provider).toBe('daytona');
    expect(status.createdAt).toBe(CREATED_AT);
  });
}

test('a failed sandbox carries a failure reason', async () => {
  const { provider } = setup(() => json({ id: 'dt-1', state: 'error' }));

  await provider.create(baseSpec);
  const status = await provider.get('sbx-1');

  expect(status.state).toBe('failed');
  expect(status.failureReason).toContain('error');
});

test('a sandbox the vendor stopped past its TTL reports expired', async () => {
  let clock = CREATED_AT;
  const { provider } = setup(() => json({ id: 'dt-1', state: 'stopped' }), { now: () => clock });

  await provider.create({ ...baseSpec, ttlSec: 60 });
  clock = CREATED_AT + 61_000;

  expect((await provider.get('sbx-1')).state).toBe('expired');
});

test('exec posts the command to the toolbox and returns the result', async () => {
  const { provider, calls } = setup(
    createdThen(() => json({ result: 'hi\n', exitCode: 0 })),
  );

  await provider.create(baseSpec);
  const result = await provider.exec('sbx-1', 'echo hi', {
    timeoutMs: 5000,
    cwd: '/tmp',
    env: { A: '1' },
  });

  const call = calls[1]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('https://toolbox.test/toolbox/dt-1/process/execute');
  expect(call.headers.Authorization).toBe('Bearer tenant-key');
  expect(call.json).toEqual({ command: 'echo hi', timeout: 5, cwd: '/tmp', env: { A: '1' } });
  expect(result).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 });
});

test('exec passes a non-zero exit code through', async () => {
  const { provider } = setup(createdThen(() => json({ result: '', exitCode: 127 })));

  await provider.create(baseSpec);

  expect(await provider.exec('sbx-1', 'nope')).toEqual({ stdout: '', stderr: '', exitCode: 127 });
});

test('readFile downloads bytes from the toolbox', async () => {
  const { provider, calls } = setup(
    createdThen(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
  );

  await provider.create(baseSpec);
  const bytes = await provider.readFile('sbx-1', '/tmp/a b.txt');

  expect(Array.from(bytes)).toEqual([1, 2, 3]);
  const call = calls[1]!;
  expect(call.method).toBe('GET');
  expect(call.url).toBe(
    'https://toolbox.test/toolbox/dt-1/files/download?path=%2Ftmp%2Fa%20b.txt',
  );
});

test('writeFile uploads raw bytes', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 204 })));

  await provider.create(baseSpec);
  await provider.writeFile('sbx-1', '/tmp/out.bin', new Uint8Array([9, 8, 7]));

  const call = calls[1]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('https://toolbox.test/toolbox/dt-1/files/upload-v2?path=%2Ftmp%2Fout.bin');
  expect(call.headers['Content-Type']).toBe('application/octet-stream');
  expect(Array.from(call.bytes ?? [])).toEqual([9, 8, 7]);
});

test('stop posts /stop and destroy deletes, hiding the sandbox afterwards', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 204 })));

  await provider.create(baseSpec);
  await provider.stop('sbx-1');
  expect(calls[1]!.method).toBe('POST');
  expect(calls[1]!.url).toBe('https://daytona.test/api/sandbox/dt-1/stop');

  await provider.destroy('sbx-1');
  expect(calls[2]!.method).toBe('DELETE');
  expect(calls[2]!.url).toBe('https://daytona.test/api/sandbox/dt-1');

  // No network call: the adapter already forgot the id.
  await expectCode(() => provider.get('sbx-1'), 'not_found');
  expect(calls.length).toBe(3);
});

test('a 404 from the toolbox becomes not_found', async () => {
  const { provider } = setup(createdThen(() => new Response(null, { status: 404 })));

  await provider.create(baseSpec);

  await expectCode(() => provider.exec('sbx-1', 'true'), 'not_found');
});

test('a 404 on get forgets the sandbox', async () => {
  const { provider } = setup(
    createdThen(() => new Response(null, { status: 404 })),
  );

  await provider.create(baseSpec);

  await expectCode(() => provider.get('sbx-1'), 'not_found');
  await expectCode(() => provider.get('sbx-1'), 'not_found');
});

test('an image without a snapshot is refused before any request', async () => {
  const { provider, calls } = setup(() => json({ id: 'dt-1', state: 'started' }));

  await expectCode(
    () => provider.create({ ...baseSpec, snapshot: undefined, image: 'ubuntu:24.04' }),
    'capability_unavailable',
  );
  expect(calls.length).toBe(0);
});

test('an HTTP 500 becomes provider_error', async () => {
  const { provider } = setup(() => json({ message: 'boom' }, 500));

  await expectCode(() => provider.create(baseSpec), 'provider_error');
});

test('a transport failure becomes provider_error', async () => {
  const { provider } = setup(() => {
    throw new Error('socket closed');
  });

  await expectCode(() => provider.create(baseSpec), 'provider_error');
});

test('every request goes to the injected hosts only', async () => {
  const { provider, calls } = setup(
    createdThen((call) =>
      call.url.includes('/files/download')
        ? new Response(new Uint8Array(), { status: 200 })
        : json({ result: '', exitCode: 0 }),
    ),
  );

  await provider.create(baseSpec);
  await provider.exec('sbx-1', 'true');
  await provider.readFile('sbx-1', '/etc/hosts');
  await provider.stop('sbx-1');
  await provider.destroy('sbx-1');

  for (const call of calls) {
    const onApi = call.url.startsWith('https://daytona.test/api/sandbox');
    const onToolbox = call.url.startsWith('https://toolbox.test/toolbox/');
    expect(onApi || onToolbox).toBe(true);
  }
});
