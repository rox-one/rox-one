/**
 * Production DiscoveryHost: reads OS config files and seals dotenv copy material.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  createSealedSecret,
  type DiscoveryHost,
  type LegacyMetadataItem,
} from './p0-adapters.ts';
import type { SealedSecret } from './provider-contract.ts';

const execFileAsync = promisify(execFile);
const ENV_FILE_NAME = /^\.env(?:\..+)?$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface OsDiscoveryHostOptions {
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /** Injected keychain metadata (real dump-keychain is too noisy). */
  readonly keychainItems?: readonly { service: string; account: string }[];
  readonly listLegacyMetadata?: () => Promise<readonly LegacyMetadataItem[]>;
}

function hasPathTraversal(path: string): boolean {
  return path.split(/[/\\]/).includes('..');
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function extractDotenvValue(content: string, key: string): string | undefined {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const found = withoutExport.slice(0, eq).trim();
    if (found !== key || !ENV_KEY.test(found)) continue;
    let value = withoutExport.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function redactAdcMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/private[_-]?key|secret|password|token|credential/i.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function parseSshAddList(stdout: string): Array<{ fingerprint: string; comment?: string }> {
  const items: Array<{ fingerprint: string; comment?: string }> = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /no identities/i.test(line)) continue;
    const match = line.match(/^\d+\s+(SHA256:[A-Za-z0-9+/=]+)(?:\s+(.+?))?\s*(?:\([^)]+\))?\s*$/);
    if (!match?.[1]) continue;
    const rest = match[2]?.trim();
    const comment = rest && !/^\([^)]+\)$/.test(rest) ? rest.replace(/\s*\([^)]+\)$/, '').trim() : undefined;
    items.push({
      fingerprint: match[1],
      ...(comment ? { comment } : {}),
    });
  }
  return items;
}

async function listEnvFilesInDir(dir: string): Promise<Array<{ path: string; content: string }>> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const found: Array<{ path: string; content: string }> = [];
  for (const name of entries) {
    if (!ENV_FILE_NAME.test(name)) continue;
    const full = resolve(dir, name);
    if (hasPathTraversal(full) || hasPathTraversal(name)) continue;
    if (basename(full) !== name) continue;
    const content = await readTextIfExists(full);
    if (content === undefined) continue;
    found.push({ path: full, content });
  }
  return found;
}

function parseDotenvCandidateId(
  candidateId: string,
): { path: string; key: string } | undefined {
  if (!candidateId.startsWith('dotenv:')) return undefined;
  const rest = candidateId.slice('dotenv:'.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0) return undefined;
  const path = rest.slice(0, lastColon);
  const key = rest.slice(lastColon + 1);
  if (!path || !ENV_KEY.test(key) || hasPathTraversal(path) || !ENV_FILE_NAME.test(basename(path))) {
    return undefined;
  }
  return { path, key };
}

export function createOsDiscoveryHost(options: OsDiscoveryHostOptions = {}): DiscoveryHost {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const host: DiscoveryHost = {
    async listEnvFiles() {
      const dirs = [resolve(cwd), resolve(homeDir)];
      const seen = new Set<string>();
      const out: Array<{ path: string; content: string }> = [];
      for (const dir of dirs) {
        if (hasPathTraversal(dir)) continue;
        for (const file of await listEnvFilesInDir(dir)) {
          if (seen.has(file.path)) continue;
          seen.add(file.path);
          out.push(file);
        }
      }
      return out;
    },

    async gitConfigText() {
      return readTextIfExists(join(homeDir, '.gitconfig'));
    },

    async dockerConfigText() {
      return readTextIfExists(join(homeDir, '.docker', 'config.json'));
    },

    async awsConfigText() {
      return readTextIfExists(join(homeDir, '.aws', 'config'));
    },

    async listGcpAdc() {
      const items: Array<{ source: string; metadata?: unknown }> = [];
      const seen = new Set<string>();

      const push = async (source: string, path: string) => {
        if (seen.has(path) || hasPathTraversal(path)) return;
        if (!(await pathExists(path))) return;
        seen.add(path);
        const text = await readTextIfExists(path);
        if (text === undefined) {
          items.push({ source });
          return;
        }
        try {
          const parsed = JSON.parse(text) as unknown;
          const metadata = redactAdcMetadata(parsed);
          items.push(metadata ? { source, metadata } : { source });
        } catch {
          items.push({ source });
        }
      };

      const adcEnv = env.GOOGLE_APPLICATION_CREDENTIALS;
      if (typeof adcEnv === 'string' && adcEnv.trim()) {
        await push(adcEnv.trim(), resolve(adcEnv.trim()));
      }
      await push(
        'application_default_credentials.json',
        join(homeDir, '.config', 'gcloud', 'application_default_credentials.json'),
      );
      return items;
    },

    async listSshIdentities() {
      if (!env.SSH_AUTH_SOCK) return [];
      try {
        const { stdout } = await execFileAsync('ssh-add', ['-l'], {
          env: { ...env },
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
        });
        return parseSshAddList(stdout);
      } catch {
        return [];
      }
    },

    async listKeychainItems() {
      if (options.keychainItems) return [...options.keychainItems];
      if (process.platform !== 'darwin') return [];
      // Real `security dump-keychain` is too noisy for discovery; opt-in via injection.
      return [];
    },

    async approveCopy(candidateId: string): Promise<SealedSecret | undefined> {
      const parsed = parseDotenvCandidateId(candidateId);
      if (!parsed) return undefined;
      const content = await readTextIfExists(parsed.path);
      if (content === undefined) return undefined;
      const value = extractDotenvValue(content, parsed.key);
      if (value === undefined) return undefined;
      return createSealedSecret('api_key', value);
    },
  };

  if (options.listLegacyMetadata) {
    host.listLegacyMetadata = options.listLegacyMetadata;
  }

  return host;
}
