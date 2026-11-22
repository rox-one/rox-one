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

/** Answers create with a sandbox and then plays `steps` in order, repeating the last. */
function createdThenSteps(steps: Responder[]): Responder {
  let index = 0;
  return (call) => {
    if (call.method === 'POST' && call.url.endsWith('/sandbox')) {
      return json({ id: 'dt-1', state: 'started' });
    }
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    return step(call);
  };
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

test('stop retries a 500 exactly once', async () => {
  const { provider, calls } = setup(
    createdThenSteps([
      () => json({ message: 'boom' }, 500),
      () => new Response(null, { status: 200 }),
    ]),
  );

  await provider.create(baseSpec);
  await provider.stop('sbx-1');

  // create + first /stop + retried /stop, and nothing more.
  expect(calls.length).toBe(3);
  expect(calls.filter((call) => call.url.endsWith('/stop')).length).toBe(2);
});

test('destroy retries a 503 exactly once and forgets the sandbox', async () => {
  const { provider, calls } = setup(
    createdThenSteps([
      () => new Response(null, { status: 503 }),
      () => new Response(null, { status: 204 }),
    ]),
  );

  await provider.create(baseSpec);
  await provider.destroy('sbx-1');

  expect(calls.length).toBe(3);
  expect(calls.filter((call) => call.method === 'DELETE').length).toBe(2);

  // The retried delete succeeded, so the id is gone without another request.
  await expectCode(() => provider.get('sbx-1'), 'not_found');
  expect(calls.length).toBe(3);
});

test('a 404 on destroy is not retried and still forgets the sandbox', async () => {
  const { provider, calls } = setup(
    createdThenSteps([() => new Response(null, { status: 404 })]),
  );

  await provider.create(baseSpec);
  await provider.destroy('sbx-1');

  expect(calls.length).toBe(2);
  await expectCode(() => provider.get('sbx-1'), 'not_found');
  expect(calls.length).toBe(2);
});

test('a 409 on destroy is retried after a pause and ends as success', async () => {
  const { provider, calls } = setup(
    createdThenSteps([
      () => new Response(null, { status: 409 }),
      () => new Response(null, { status: 404 }),
    ]),
  );

  await provider.create(baseSpec);
  await provider.destroy('sbx-1');

  expect(calls.filter((call) => call.method === 'DELETE').length).toBe(2);
  await expectCode(() => provider.get('sbx-1'), 'not_found');
});

test('a 409 that never clears explains itself and keeps the request retryable', async () => {
  const { provider, calls } = setup(
    createdThenSteps([() => new Response(null, { status: 409 })]),
  );

  await provider.create(baseSpec);

  await expectCode(() => provider.destroy('sbx-1'), 'provider_error');
  expect(calls.filter((call) => call.method === 'DELETE').length).toBe(3);
});

test('a rejected stop request is retried once and then succeeds', async () => {
  const { provider, calls } = setup(
    createdThenSteps([
      () => {
        throw new Error('socket closed');
      },
      () => new Response(null, { status: 200 }),
    ]),
  );

  await provider.create(baseSpec);
  await provider.stop('sbx-1');

  expect(calls.length).toBe(3);
  expect(calls.filter((call) => call.url.endsWith('/stop')).length).toBe(2);
});

test('two 5xx answers to stop surface a provider error and stop there', async () => {
  const { provider, calls } = setup(
    createdThenSteps([
      () => json({ message: 'boom' }, 500),
      () => json({ message: 'boom' }, 502),
    ]),
  );

  await provider.create(baseSpec);

  await expectCode(() => provider.stop('sbx-1'), 'provider_error');
  expect(calls.length).toBe(3);
});

test('two rejected destroy requests surface a provider error and stop there', async () => {
  const { provider, calls } = setup(
    createdThenSteps([
      () => {
        throw new Error('socket closed');
      },
    ]),
  );

  await provider.create(baseSpec);

  await expectCode(() => provider.destroy('sbx-1'), 'provider_error');
  expect(calls.length).toBe(3);
});

test('get does not retry a 500', async () => {
  const { provider, calls } = setup(
    createdThenSteps([() => json({ message: 'boom' }, 500)]),
  );

  await provider.create(baseSpec);

  await expectCode(() => provider.get('sbx-1'), 'provider_error');
  expect(calls.length).toBe(2);
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

test('previewUrl asks for a signed link and caps the lifetime', async () => {
  const { provider, calls } = setup(
    createdThen((call) =>
      call.url.includes('/ports/8000/signed-preview-url')
        ? json({ url: 'https://8000-dt-1.proxy.test/token' })
        : json({}),
    ),
  );

  await provider.create(baseSpec);
  const preview = await provider.previewUrl!('sbx-1', 8000, 3600);

  const call = calls.at(-1)!;
  expect(call.method).toBe('GET');
  expect(call.url).toBe(
    'https://daytona.test/api/sandbox/dt-1/ports/8000/signed-preview-url?expiresInSeconds=3600',
  );
  expect(call.headers.Authorization).toBe('Bearer tenant-key');
  expect(preview).toEqual({
    url: 'https://8000-dt-1.proxy.test/token',
    expiresAt: CREATED_AT + 3_600_000,
  });
});

test('sshAccess returns the vendor command and expiry, never a made-up one', async () => {
  const { provider, calls } = setup(
    createdThen((call) =>
      call.url.includes('/ssh-access?expiresInMinutes=15')
        ? json({
            sshCommand: 'ssh dt-token@ssh.test',
            expiresAt: new Date(CREATED_AT + 15 * 60_000).toISOString(),
          })
        : json({}),
    ),
  );

  await provider.create(baseSpec);
  const access = await provider.sshAccess!('sbx-1', 900);

  const call = calls.at(-1)!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('https://daytona.test/api/sandbox/dt-1/ssh-access?expiresInMinutes=15');
  expect(access.command).toBe('ssh dt-token@ssh.test');
  expect(access.expiresAt).toBe(CREATED_AT + 900_000);
});

test('listFiles maps names, folders, sizes and modified time', async () => {
  const { provider, calls } = setup(
    createdThen((call) =>
      call.url.includes('/files?path=%2Fhome%2Fdaytona')
        ? json([
            { name: 'notes', path: '/home/daytona/notes', isDir: true, size: 0, modifiedAt: '2026-11-22T08:00:00Z' },
            { name: 'hello.txt', path: '/home/daytona/hello.txt', isDir: false, size: 12 },
          ])
        : json({}),
    ),
  );

  await provider.create(baseSpec);
  const entries = await provider.listFiles!('sbx-1', '/home/daytona');

  expect(calls.at(-1)!.url).toBe('https://toolbox.test/toolbox/dt-1/files?path=%2Fhome%2Fdaytona');
  expect(entries).toEqual([
    {
      name: 'notes',
      path: '/home/daytona/notes',
      isDir: true,
      size: 0,
      modifiedAt: Date.parse('2026-11-22T08:00:00Z'),
    },
    { name: 'hello.txt', path: '/home/daytona/hello.txt', isDir: false, size: 12 },
  ]);
});

test('create reports the vendor sandbox id as providerRef', async () => {
  const { provider } = setup(() => json({ id: 'dt-1', state: 'started' }));

  const status = await provider.create(baseSpec);

  // The caller persists this, so it must be the id the vendor itself uses.
  expect(status.providerRef).toBe('dt-1');
  expect((await provider.get('sbx-1')).providerRef).toBe('dt-1');
});

test('adopt reattaches through the stored vendor id without a POST', async () => {
  const { provider, calls } = setup((call) =>
    call.url.includes('/process/execute')
      ? json({ result: 'hi\n', exitCode: 0 })
      : json({ id: 'dt-adopted', state: 'started' }),
  );

  const adoptedAt = CREATED_AT - 60_000;
  provider.adopt!('sbx-9', 'dt-adopted', 'paused', adoptedAt, adoptedAt + 3_600_000);

  const status = await provider.get('sbx-9');
  expect(status).toMatchObject({
    id: 'sbx-9',
    provider: 'daytona',
    providerRef: 'dt-adopted',
    state: 'running',
    createdAt: adoptedAt,
    expiresAt: adoptedAt + 3_600_000,
  });

  const result = await provider.exec('sbx-9', 'echo hi');
  expect(result).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 });

  // The first request is the get: nothing was created for the adopted id.
  expect(calls.length).toBe(2);
  expect(calls[0]!.method).toBe('GET');
  expect(calls[0]!.url).toBe('https://daytona.test/api/sandbox/dt-adopted');
  expect(calls[1]!.url).toBe('https://toolbox.test/toolbox/dt-adopted/process/execute');
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/sandbox'))).toBe(false);
  for (const call of calls) {
    expect(call.headers.Authorization).toBe('Bearer tenant-key');
    expect(call.url.includes('tenant-key')).toBe(false);
  }
});

test('createSnapshot posts name and includeMemory:false to the vendor route', async () => {
  const { provider, calls } = setup(
    createdThen((call) =>
      call.url.endsWith('/sandbox/dt-1/snapshot')
        ? json({ name: 'rox-snap', state: 'building' })
        : json({}),
    ),
  );

  await provider.create(baseSpec);
  const snapshot = await provider.createSnapshot!('sbx-1', '  rox-snap  ');

  const call = calls.at(-1)!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('https://daytona.test/api/sandbox/dt-1/snapshot');
  expect(call.headers.Authorization).toBe('Bearer tenant-key');
  expect(call.headers['Content-Type']).toBe('application/json');
  // Trimmed, memory excluded, and nothing else in the body.
  expect(call.json).toEqual({ name: 'rox-snap', includeMemory: false });
  expect(call.url.includes('tenant-key')).toBe(false);
  expect(snapshot).toEqual({ name: 'rox-snap', state: 'building' });
});

test('createSnapshot falls back to the sent name and building state', async () => {
  const { provider } = setup(
    createdThen(() => json({}, 202)),
  );

  await provider.create(baseSpec);

  expect(await provider.createSnapshot!('sbx-1', 'rox-snap')).toEqual({
    name: 'rox-snap',
    state: 'building',
  });
});

test('a 404 on createSnapshot becomes not_found without leaking the key', async () => {
  const { provider, calls } = setup(createdThen(() => new Response(null, { status: 404 })));

  await provider.create(baseSpec);
  const error = await provider.createSnapshot!('sbx-1', 'rox-snap').then(
    () => undefined,
    (cause: unknown) => cause,
  );

  expect(error).toBeInstanceOf(CloudRunnerError);
  expect((error as CloudRunnerError).code).toBe('not_found');
  expect((error as Error).message.includes('tenant-key')).toBe(false);
  expect(calls.at(-1)!.url).toBe('https://daytona.test/api/sandbox/dt-1/snapshot');
});

test('a failed snapshot request names no key and no body', async () => {
  const { provider } = setup(createdThenSteps([() => json({ message: 'boom' }, 500)]));

  await provider.create(baseSpec);
  const error = await provider.createSnapshot!('sbx-1', 'rox-snap').then(
    () => undefined,
    (cause: unknown) => cause,
  );

  expect(error).toBeInstanceOf(CloudRunnerError);
  expect((error as CloudRunnerError).code).toBe('provider_error');
  const message = (error as Error).message;
  expect(message.includes('tenant-key')).toBe(false);
  expect(message.includes('rox-snap')).toBe(false);
});
