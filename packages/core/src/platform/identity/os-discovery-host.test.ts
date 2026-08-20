import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOsDiscoveryHost } from './os-discovery-host.ts';
import { createP0ProviderStack, unsealSecret } from './p0-adapters.ts';

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function makeFixtureHome(): Promise<{
  homeDir: string;
  cwd: string;
}> {
  tempRoot = await mkdtemp(join(tmpdir(), 'os-discovery-'));
  const homeDir = join(tempRoot, 'home');
  const cwd = join(tempRoot, 'cwd');
  await mkdir(join(homeDir, '.docker'), { recursive: true });
  await mkdir(join(homeDir, '.aws'), { recursive: true });
  await mkdir(join(homeDir, '.config', 'gcloud'), { recursive: true });
  await mkdir(cwd, { recursive: true });

  await writeFile(
    join(homeDir, '.gitconfig'),
    `[credential "https://github.com"]\n\thelper = osxkeychain\n`,
    'utf8',
  );
  await writeFile(
    join(homeDir, '.docker', 'config.json'),
    JSON.stringify({ credsStore: 'desktop', credHelpers: { 'ghcr.io': 'osxkeychain' } }),
    'utf8',
  );
  await writeFile(
    join(homeDir, '.aws', 'config'),
    `[profile prod]\ncredential_process = /usr/bin/okta\n[default]\nregion = eu-north-1\n`,
    'utf8',
  );
  await writeFile(
    join(homeDir, '.config', 'gcloud', 'application_default_credentials.json'),
    JSON.stringify({
      type: 'service_account',
      client_email: 'bot@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n',
    }),
    'utf8',
  );
  await writeFile(join(cwd, '.env'), 'export GH_TOKEN=ghp_livevalue\nAPI_KEY=x\n', 'utf8');
  await writeFile(join(cwd, '.env.local'), 'LOCAL_ONLY=1\n', 'utf8');
  await writeFile(join(homeDir, '.env'), 'HOME_KEY=home-secret\n', 'utf8');

  return { homeDir, cwd };
}

describe('createOsDiscoveryHost', () => {
  it('lists dotenv files from cwd and home without traversal', async () => {
    const { homeDir, cwd } = await makeFixtureHome();
    const host = createOsDiscoveryHost({ homeDir, cwd, env: {} });
    const files = await host.listEnvFiles!();
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(
      [join(cwd, '.env'), join(cwd, '.env.local'), join(homeDir, '.env')].sort(),
    );
    expect(files.every((file) => typeof file.content === 'string')).toBe(true);
    expect(JSON.stringify(files)).toContain('ghp_livevalue');
  });

  it('reads git/docker/aws config text from the fixture home only', async () => {
    const { homeDir, cwd } = await makeFixtureHome();
    const host = createOsDiscoveryHost({ homeDir, cwd, env: {} });
    await expect(host.gitConfigText!()).resolves.toContain('osxkeychain');
    await expect(host.dockerConfigText!()).resolves.toContain('credsStore');
    await expect(host.awsConfigText!()).resolves.toContain('[profile prod]');
  });

  it('returns GCP ADC metadata without private_key', async () => {
    const { homeDir, cwd } = await makeFixtureHome();
    const host = createOsDiscoveryHost({ homeDir, cwd, env: {} });
    const items = await host.listGcpAdc!();
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('application_default_credentials.json');
    expect(JSON.stringify(items)).toContain('bot@example.com');
    expect(JSON.stringify(items)).not.toContain('private_key');
    expect(JSON.stringify(items)).not.toContain('BEGIN PRIVATE KEY');
  });

  it('prefers GOOGLE_APPLICATION_CREDENTIALS when set', async () => {
    const { homeDir, cwd } = await makeFixtureHome();
    const custom = join(homeDir, 'custom-adc.json');
    await writeFile(
      custom,
      JSON.stringify({ type: 'authorized_user', client_id: 'cid', refresh_token: 'rt' }),
      'utf8',
    );
    const host = createOsDiscoveryHost({
      homeDir,
      cwd,
      env: { GOOGLE_APPLICATION_CREDENTIALS: custom },
    });
    const items = await host.listGcpAdc!();
    expect(items.some((item) => item.source === custom)).toBe(true);
    expect(JSON.stringify(items)).not.toContain('refresh_token');
  });

  it('fail-softs ssh identities without SSH_AUTH_SOCK', async () => {
    const { homeDir, cwd } = await makeFixtureHome();
    const host = createOsDiscoveryHost({ homeDir, cwd, env: {} });
    await expect(host.listSshIdentities!()).resolves.toEqual([]);
  });

  it('returns empty keychain unless items are injected', async () => {
    const { homeDir, cwd } = await makeFixtureHome();
    const bare = createOsDiscoveryHost({ homeDir, cwd, env: {} });
    await expect(bare.listKeychainItems!()).resolves.toEqual([]);
    const injected = createOsDiscoveryHost({
      homeDir,
      cwd,
      env: {},
      keychainItems: [{ service: 'rox.one', account: 'mark' }],
    });
    await expect(injected.listKeychainItems!()).resolves.toEqual([
      { service: 'rox.one', account: 'mark' },
    ]);
  });

  it('approveCopy seals dotenv values and never leaks them via inspect/preview', async () => {
    const { homeDir, cwd } = await makeFixtureHome();
    const host = createOsDiscoveryHost({ homeDir, cwd, env: {} });
    const { provider, importers } = createP0ProviderStack(host);
    const dotenv = await importers.dotenv!.discover({ sourceId: 'dotenv', workspaceId: 'ws' });
    const candidate = dotenv.find((item) => item.label === 'GH_TOKEN');
    expect(candidate).toBeDefined();

    const preview = await importers.dotenv!.preview({
      candidateId: candidate!.id,
      targetProviderId: provider.id,
    });
    expect(JSON.stringify(preview)).not.toContain('ghp_livevalue');

    const sealed = await host.approveCopy!(candidate!.id);
    expect(sealed?._brand).toBe('SealedSecret');
    expect(sealed?.ciphertext.startsWith('seal1:')).toBe(true);
    expect(unsealSecret(sealed!)).toBe('ghp_livevalue');

    const commit = await importers.dotenv!.commit({
      candidateId: candidate!.id,
      targetProviderId: provider.id,
      mode: 'copy',
      workspaceId: 'ws',
      requestedBy: 'user',
    });
    const inspect = await provider.inspect({
      id: commit.credentialRefId,
      kind: 'api_key',
      providerId: provider.id,
      locator: candidate!.locator!,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(JSON.stringify(inspect)).not.toContain('ghp_livevalue');
    expect(JSON.stringify(inspect)).not.toContain('SealedSecret');
    expect(JSON.stringify(inspect)).not.toContain('seal1:');
    expect(provider.peekPlaintextForTest(candidate!.locator!)).toBe('ghp_livevalue');
  });

  it('fail-softs missing home config files', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'os-discovery-empty-'));
    const homeDir = join(tempRoot, 'empty-home');
    const cwd = join(tempRoot, 'empty-cwd');
    await mkdir(homeDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    const host = createOsDiscoveryHost({ homeDir, cwd, env: {} });
    await expect(host.gitConfigText!()).resolves.toBeUndefined();
    await expect(host.dockerConfigText!()).resolves.toBeUndefined();
    await expect(host.awsConfigText!()).resolves.toBeUndefined();
    await expect(host.listGcpAdc!()).resolves.toEqual([]);
    await expect(host.listEnvFiles!()).resolves.toEqual([]);
  });
});
