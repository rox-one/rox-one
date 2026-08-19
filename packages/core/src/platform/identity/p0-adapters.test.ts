import { describe, expect, it } from 'bun:test';
import {
  createP0ProviderStack,
  createSealedSecret,
  extractDotenvKeys,
  metadataFingerprint,
  parseAwsConfig,
  parseDockerConfig,
  parseGitCredentialConfig,
  redactGcpAdcPreview,
  type DiscoveryHost,
} from './p0-adapters.ts';
import { ConnectionFabricError, P0_IMPORTER_IDS } from './provider-contract.ts';

const HOST: DiscoveryHost = {
  listLegacyMetadata: async () => [
    { id: 'github/default', kind: 'api_key', label: 'GitHub', fingerprint: 'c'.repeat(64) },
  ],
  listEnvFiles: async () => [
    {
      path: '/tmp/.env',
      content: 'export GH_TOKEN=ghp_livevalue\n# comment\nEMPTY=\nNOT_A_KEY\nAPI_KEY=x\n',
    },
  ],
  listKeychainItems: async () => [{ service: 'rox.one', account: 'mark' }],
  gitConfigText: async () => `[credential "https://github.com"]\n\thelper = osxkeychain\n`,
  dockerConfigText: async () =>
    JSON.stringify({
      credsStore: 'desktop',
      credHelpers: { 'ghcr.io': 'osxkeychain' },
    }),
  awsConfigText: async () =>
    `[profile prod]\ncredential_process = /usr/bin/okta\n[sso-session work]\nsso_start_url = https://example\n[default]\nregion = eu-north-1\n`,
  listGcpAdc: async () => [
    {
      source: 'application_default_credentials.json',
      metadata: { type: 'service_account', client_email: 'bot@example.com', private_key: 'SECRET' },
    },
  ],
  listSshIdentities: async () => [{ fingerprint: 'SHA256:abcd', comment: 'laptop' }],
  approveCopy: async () => createSealedSecret('api_key'),
};

describe('P0 discovery parsers', () => {
  it('extracts dotenv keys without values or shell expansion', () => {
    expect(extractDotenvKeys('export GH_TOKEN=ghp_livevalue\nFOO="${HOME}"\n')).toEqual([
      'GH_TOKEN',
      'FOO',
    ]);
  });

  it('parses git helpers from config text only', () => {
    expect(
      parseGitCredentialConfig(`[credential "https://github.com"]\nhelper = osxkeychain\n`),
    ).toEqual([{ host: 'github.com', helper: 'osxkeychain' }]);
  });

  it('parses docker credsStore and per-registry helpers', () => {
    expect(
      parseDockerConfig(JSON.stringify({ credsStore: 'desktop', credHelpers: { 'ghcr.io': 'osxkeychain' } })),
    ).toEqual([
      { registry: '*', helper: 'desktop' },
      { registry: 'ghcr.io', helper: 'osxkeychain' },
    ]);
    expect(() => parseDockerConfig('not-json')).toThrow(/IMPORT_VALIDATION_FAILED/);
  });

  it('parses named AWS profiles without inventing a default section', () => {
    expect(parseAwsConfig(`[profile prod]\ncredential_process = /bin/okta\n`)).toEqual([
      { profile: 'prod', source: 'credential_process' },
    ]);
    expect(parseAwsConfig(`[default]\nregion = eu-north-1\n[sso-session x]\nsso_start_url = https://x\n`)).toEqual([
      { profile: 'default', source: 'config' },
    ]);
  });

  it('redacts ADC JSON so private_key never appears', () => {
    const summary = redactGcpAdcPreview({
      type: 'service_account',
      client_email: 'bot@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----',
    });
    expect(summary).toContain('bot@example.com');
    expect(summary).not.toContain('BEGIN');
    expect(summary).not.toContain('private_key');
  });

  it('builds stable metadata fingerprints', () => {
    expect(metadataFingerprint(['dotenv', '.env', 'GH_TOKEN'])).toMatch(/^[0-9a-f]{64}$/);
    expect(metadataFingerprint(['dotenv', '.env', 'GH_TOKEN'])).toBe(
      metadataFingerprint(['dotenv', '.env', 'GH_TOKEN']),
    );
  });
});

describe('P0 importers', () => {
  it('discovers metadata-only candidates for every P0 source', async () => {
    const { importers } = createP0ProviderStack(HOST);
    expect(Object.keys(importers).sort()).toEqual([...P0_IMPORTER_IDS].sort());
    const discovered = {
      legacy: await importers['legacy-local']!.discover({ sourceId: 'legacy-local', workspaceId: 'ws' }),
      dotenv: await importers.dotenv!.discover({ sourceId: 'dotenv', workspaceId: 'ws' }),
      keychain: await importers['macos-keychain']!.discover({
        sourceId: 'macos-keychain',
        workspaceId: 'ws',
      }),
      git: await importers['git-credential']!.discover({
        sourceId: 'git-credential',
        workspaceId: 'ws',
      }),
      docker: await importers['docker-credential']!.discover({
        sourceId: 'docker-credential',
        workspaceId: 'ws',
      }),
      aws: await importers['aws-profile']!.discover({ sourceId: 'aws-profile', workspaceId: 'ws' }),
      gcp: await importers['gcp-adc']!.discover({ sourceId: 'gcp-adc', workspaceId: 'ws' }),
      ssh: await importers['ssh-agent']!.discover({ sourceId: 'ssh-agent', workspaceId: 'ws' }),
    };

    expect(discovered.legacy).toHaveLength(1);
    expect(discovered.dotenv.map((item) => item.label).sort()).toEqual([
      'API_KEY',
      'EMPTY',
      'GH_TOKEN',
    ]);
    expect(discovered.keychain[0]?.locator).toEqual({
      type: 'keychain',
      service: 'rox.one',
      account: 'mark',
    });
    expect(discovered.git[0]?.locator).toEqual({ type: 'git_helper', host: 'github.com' });
    expect(discovered.docker.map((item) => item.locator)).toEqual([
      { type: 'docker_helper', registry: '*' },
      { type: 'docker_helper', registry: 'ghcr.io' },
    ]);
    expect(discovered.aws.map((item) => item.label).sort()).toEqual(['default', 'prod']);
    expect(discovered.ssh[0]?.kind).toBe('ssh_agent_identity');

    const blob = JSON.stringify(discovered);
    expect(blob).not.toContain('ghp_livevalue');
    expect(blob).not.toContain('BEGIN');
    expect(blob).not.toMatch(/"value"/);
  });

  it('masks preview and never returns helper or env values', async () => {
    const { importers } = createP0ProviderStack(HOST);
    const dotenv = await importers.dotenv!.discover({ sourceId: 'dotenv', workspaceId: 'ws' });
    const preview = await importers.dotenv!.preview({
      candidateId: dotenv[0]!.id,
      targetProviderId: 'legacy-local',
    });
    expect(preview.maskedSummary).toMatch(/=••••$/);
    expect(preview.maskedSummary).not.toContain('ghp_');
    expect(JSON.stringify(preview)).not.toContain('ghp_livevalue');
  });

  it('rejects dotenv traversal and ssh copy mode', async () => {
    const { importers } = createP0ProviderStack({
      ...HOST,
      listEnvFiles: async () => [{ path: '/tmp/../.env', keys: ['X'] }],
    });
    await expect(importers.dotenv!.discover({ sourceId: 'dotenv', workspaceId: 'ws' })).rejects.toThrow(
      /IMPORT_VALIDATION_FAILED/,
    );

    const ssh = await importers['ssh-agent']!.validate({
      candidateId: 'ssh-agent:SHA256:abcd',
      targetProviderId: 'legacy-local',
      mode: 'copy',
    });
    expect(ssh).toEqual({ ok: false, errorCode: 'IMPORT_MODE_UNSUPPORTED', warnings: [] });
  });

  it('commits copy material as a sealed handle and rolls it back', async () => {
    const { provider, importers } = createP0ProviderStack(HOST);
    const dotenv = await importers.dotenv!.discover({ sourceId: 'dotenv', workspaceId: 'ws' });
    const candidate = dotenv.find((item) => item.label === 'GH_TOKEN')!;
    const commit = await importers.dotenv!.commit({
      candidateId: candidate.id,
      targetProviderId: provider.id,
      mode: 'copy',
      workspaceId: 'ws',
      requestedBy: 'user',
    });
    expect(commit.mode).toBe('copy');
    expect(provider.peekHasSealed(candidate.locator!)).toBe(true);

    const inspect = await provider.inspect({
      id: commit.credentialRefId,
      kind: 'api_key',
      providerId: provider.id,
      locator: candidate.locator!,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(inspect.hasMaterial).toBe(true);
    expect(JSON.stringify(inspect)).not.toContain('SealedSecret');
    expect(JSON.stringify(inspect)).not.toContain('ghp_');

    await expect(
      provider.resolveForLease({
        credentialRef: {
          id: commit.credentialRefId,
          kind: 'api_key',
          providerId: provider.id,
          locator: candidate.locator!,
          createdAt: 0,
          updatedAt: 0,
        },
        purpose: 'test',
      }),
    ).resolves.toMatchObject({
      _brand: 'ProviderMaterialization',
      credentialRefId: commit.credentialRefId,
      providerId: provider.id,
    });

    await importers.dotenv!.rollback({ commit });
    await expect(
      provider.inspect({
        id: commit.credentialRefId,
        kind: 'api_key',
        providerId: provider.id,
        locator: candidate.locator!,
        createdAt: 0,
        updatedAt: 0,
      }),
    ).rejects.toThrow(ConnectionFabricError);
  });
});
