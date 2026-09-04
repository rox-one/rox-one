/**
 * Secure Storage Backend
 *
 * Stores credentials in an encrypted file at ~/.craft-agent/credentials.enc
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Encryption key is derived from OS-native hardware UUID using PBKDF2:
 * - macOS: IOPlatformUUID (tied to logic board, never changes)
 * - Windows: MachineGuid from registry (set at OS install)
 * - Linux: /var/lib/dbus/machine-id (set at OS install)
 *
 * This is more stable than the previous hostname-based derivation, which could
 * change with network/DHCP. Legacy credentials are auto-migrated on first load.
 *
 * File format:
 *   [Header - 64 bytes]
 *   ├── Magic: "CRAFT01\0" (8 bytes)
 *   ├── Flags: uint32 LE (4 bytes) - reserved for future use
 *   ├── Salt: 32 bytes (PBKDF2 salt)
 *   ├── Reserved: 20 bytes
 *   [Encrypted Payload]
 *   ├── IV: 12 bytes (random per write)
 *   ├── Auth Tag: 16 bytes (GCM authentication)
 *   └── Ciphertext: variable (encrypted JSON)
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
  createHash,
  randomUUID,
} from 'crypto';
import { execSync } from 'child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { hostname, userInfo, homedir } from 'os';
import { dirname, join } from 'path';

import type {
  CredentialBackend,
  CredentialMigrationBackend,
  CredentialMigrationCounts,
  CredentialMigrationRecord,
  CredentialMigrationSnapshot,
  CredentialMigrationStatus,
} from './types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialIdToAccount, accountToCredentialId } from '../types.ts';
import { CONFIG_DIR } from '../../config/paths.ts';

const STORE_NAME = 'credentials.enc';
const CREDENTIALS_FILE_NAME = STORE_NAME;
const BACKUP_NAME = 'credentials.enc.bak';

export type CredentialStoreErrorCode =
  | 'WRITE_BLOCKED'
  | 'REPAIR_REQUIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'BACKUP_MISSING';

export class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode;

  constructor(code: CredentialStoreErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CredentialStoreError';
    this.code = code;
  }
}

export type RepairState =
  | { readonly status: 'ok' }
  | {
      readonly status: 'repair_required';
      readonly code: 'malformed_header' | 'decrypt_failed';
      readonly sourceDigest: string;
      readonly quarantinePath: string;
    };

export interface LegacyMigrationManifest {
  readonly entryCount: number;
  readonly sourceDigest: string;
  readonly codecStatus: 'legacy-to-v2';
}

export interface SecureStorageOptions {
  readonly directory?: string;
  readonly keyVersion?: 'v1' | 'v2';
}

// File format constants
const MAGIC_BYTES = Buffer.from('CRAFT01\0');
const HEADER_SIZE = 64;
const MAGIC_SIZE = 8;
const FLAGS_SIZE = 4;
const SALT_SIZE = 32;
const IV_SIZE = 12;
const AUTH_TAG_SIZE = 16;
const KEY_SIZE = 32;

// PBKDF2 iterations (balance security vs startup time)
const PBKDF2_ITERATIONS = 100000;

/**
 * Get stable machine identifier using OS-native hardware UUID.
 * This is far more stable than hostname which can change with network/DHCP.
 * Falls back to username + homedir if hardware UUID unavailable.
 */
function getStableMachineId(): string {
  try {
    if (process.platform === 'darwin') {
      // macOS: IOPlatformUUID - tied to logic board, never changes
      const output = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } else if (process.platform === 'win32') {
      // Windows: MachineGuid from registry - set at OS install
      const output = execSync(
        'reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (match?.[1]) return match[1];
    } else {
      // Linux: dbus machine-id - set at OS install
      const machineIdPath = '/var/lib/dbus/machine-id';
      const altPath = '/etc/machine-id';
      if (existsSync(machineIdPath)) {
        return readFileSync(machineIdPath, 'utf-8').trim();
      } else if (existsSync(altPath)) {
        return readFileSync(altPath, 'utf-8').trim();
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: username + homedir (stable enough for most cases)
  return `${userInfo().username}:${homedir()}`;
}

/** Internal credential store structure */
interface CredentialStore {
  version: 1;
  credentials: Record<string, StoredCredential>;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

interface CredentialMigrationManifest {
  migrationId: string;
  createdAt: number;
  sourceChecksum: string;
  state: 'snapshot' | 'applied' | 'rolled_back';
  appliedChecksum?: string;
  appliedAt?: number;
  rolledBackAt?: number;
  counts?: CredentialMigrationCounts;
}

function isCredentialMigrationCounts(value: unknown): value is CredentialMigrationCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ready === 'number' &&
    typeof record.alreadyEnvelope === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.invalid === 'number'
  );
}

function isCredentialMigrationManifest(value: unknown): value is CredentialMigrationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('migrationId' in value) || !('createdAt' in value) || !('sourceChecksum' in value) || !('state' in value)) {
    return false;
  }
  return (
    typeof value.migrationId === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.sourceChecksum === 'string' &&
    (value.state === 'snapshot' || value.state === 'applied' || value.state === 'rolled_back') &&
    (!('appliedChecksum' in value) || typeof value.appliedChecksum === 'string') &&
    (!('appliedAt' in value) || typeof value.appliedAt === 'number') &&
    (!('rolledBackAt' in value) || typeof value.rolledBackAt === 'number') &&
    (!('counts' in value) || isCredentialMigrationCounts(value.counts))
  );
}

function cloneStore(store: CredentialStore): CredentialStore {
  return JSON.parse(JSON.stringify(store)) as CredentialStore;
}


export class SecureStorageBackend implements CredentialBackend, CredentialMigrationBackend {
  readonly name = 'secure-storage';
  readonly priority = 100;

  private readonly directory: string;
  private readonly file: string;
  private readonly backupFile: string;
  private readonly migrationsDir: string;
  private readonly writeKeyVersion: 'v1' | 'v2';
  private cachedStore: CredentialStore | null = null;
  private encryptionKey: Buffer | null = null;
  private salt: Buffer | null = null;
  private repairState: RepairState = { status: 'ok' };

  constructor(options: string | SecureStorageOptions = {}) {
    const opts: SecureStorageOptions = typeof options === 'string' ? { directory: options } : options;
    this.directory = opts.directory ?? CONFIG_DIR;
    this.file = join(this.directory, STORE_NAME);
    this.backupFile = join(this.directory, BACKUP_NAME);
    this.migrationsDir = join(this.directory, 'credential-migrations');
    this.writeKeyVersion = opts.keyVersion ?? 'v2';
  }

  getRepairState(): RepairState {
    return this.repairState.status === 'ok' ? { status: 'ok' } : { ...this.repairState };
  }

  async isAvailable(): Promise<boolean> {
    // File backend is always available - we can always write to filesystem
    return true;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    const store = await this.loadStore();
    if (!store) return null;

    const key = credentialIdToAccount(id);
    return store.credentials[key] || null;
  }

  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.assertWritable();
    let store = await this.loadStore();

    if (!store) {
      // Initialize new store
      store = {
        version: 1,
        credentials: {},
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    }

    const key = credentialIdToAccount(id);
    store.credentials[key] = credential;
    store.metadata.updatedAt = Date.now();

    await this.saveStore(store);
  }

  async delete(id: CredentialId): Promise<boolean> {
    return this.deleteSync(id);
  }

  deleteSync(id: CredentialId): boolean {
    this.assertWritable();
    const store = this.loadStoreSync();
    if (!store) return false;

    const key = credentialIdToAccount(id);
    if (!(key in store.credentials)) return false;

    delete store.credentials[key];
    store.metadata.updatedAt = Date.now();

    this.saveStoreSync(store);
    return true;
  }

  async list(filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    const store = await this.loadStore();
    if (!store) return [];

    const ids = Object.keys(store.credentials)
      .map(accountToCredentialId)
      .filter((id): id is CredentialId => id !== null);

    if (!filter) return ids;

    return ids.filter((id) => {
      if (filter.type && id.type !== filter.type) return false;
      if (filter.workspaceId && id.workspaceId !== filter.workspaceId) return false;
      if (filter.name && id.name !== filter.name) return false;
      return true;
    });
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async loadStore(): Promise<CredentialStore | null> {
    return this.loadStoreSync();
  }

  private loadStoreSync(): CredentialStore | null {
    // Return cached store if available
    if (this.cachedStore) return this.cachedStore;

    if (!existsSync(this.file)) return null;

    let fileData: Buffer;
    try {
      fileData = readFileSync(this.file);
    } catch {
      return null;
    }

    if (fileData.length < HEADER_SIZE + IV_SIZE + AUTH_TAG_SIZE) {
      this.enterRepair(fileData, 'malformed_header');
      return null;
    }

    if (!fileData.subarray(0, MAGIC_SIZE).equals(MAGIC_BYTES)) {
      this.enterRepair(fileData, 'malformed_header');
      return null;
    }

    // Parse header
    // const flags = fileData.readUInt32LE(MAGIC_SIZE); // Reserved for future use
    const salt = fileData.subarray(MAGIC_SIZE + FLAGS_SIZE, MAGIC_SIZE + FLAGS_SIZE + SALT_SIZE);
    this.salt = salt;

    // Extract encrypted data
    const encryptedData = fileData.subarray(HEADER_SIZE);

    // Try new stable key first (v2 - hardware UUID based)
    const newKey = this.getEncryptionKey(salt);
    let store = this.tryDecrypt(encryptedData, newKey);

    if (store) {
      this.cachedStore = store;
      return store;
    }

    // Try legacy key for migration (v1 - included hostname)
    // This handles credentials encrypted with old key derivation
    const legacyKey = this.getLegacyEncryptionKey(salt);
    store = this.tryDecrypt(encryptedData, legacyKey);

    if (store) {
      // Dual-read: do not rewrite on get. Cutover is commitLegacyMigration().
      this.cachedStore = store;
      return store;
    }

    this.enterRepair(fileData, 'decrypt_failed');
    return null;
  }

  /**
   * Attempt to decrypt data with given key.
   * Returns parsed store on success, null on failure.
   */
  private tryDecrypt(encryptedData: Buffer, key: Buffer): CredentialStore | null {
    try {
      const iv = encryptedData.subarray(0, IV_SIZE);
      const authTag = encryptedData.subarray(IV_SIZE, IV_SIZE + AUTH_TAG_SIZE);
      const ciphertext = encryptedData.subarray(IV_SIZE + AUTH_TAG_SIZE);

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    } catch {
      return null;
    }
  }

  private async saveStore(store: CredentialStore): Promise<void> {
    this.saveStoreSync(store);
  }

  private saveStoreSync(store: CredentialStore): void {
    this.assertWritable();
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    }

    // Use existing salt or generate new one
    const salt = this.salt || randomBytes(SALT_SIZE);
    this.salt = salt;

    const key = this.getEncryptionKey(salt, this.writeKeyVersion);

    // Serialize payload
    const plaintext = Buffer.from(JSON.stringify(store), 'utf8');

    // Generate new IV for each write (critical for GCM security)
    const iv = randomBytes(IV_SIZE);

    // Encrypt
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Build header
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt32LE(0, MAGIC_SIZE); // Flags (reserved)
    salt.copy(header, MAGIC_SIZE + FLAGS_SIZE);

    // Combine all parts
    const fileData = Buffer.concat([header, iv, authTag, ciphertext]);

    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, fileData, { mode: 0o600 });
    renameSync(tmp, this.file);
    copyFileSync(this.file, this.backupFile);
    this.cachedStore = store;
  }

  private getEncryptionKey(salt: Buffer, version: 'v1' | 'v2' = 'v2'): Buffer {
    if (version === 'v1') return this.getLegacyEncryptionKey(salt);
    if (this.encryptionKey) return this.encryptionKey;

    const stableMachineId = createHash('sha256')
      .update(getStableMachineId())
      .update('craft-agent-v2')
      .digest();

    this.encryptionKey = pbkdf2Sync(stableMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
    return this.encryptionKey;
  }

  /**
   * Legacy key derivation for migration from v1 (included hostname).
   * Used to decrypt credentials from older versions before re-encrypting with stable key.
   */
  private getLegacyEncryptionKey(salt: Buffer): Buffer {
    const legacyMachineId = createHash('sha256')
      .update(hostname())
      .update(userInfo().username)
      .update(homedir())
      .update('craft-agent-v1')
      .digest();

    return pbkdf2Sync(legacyMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
  }

  async restoreFromBackup(): Promise<boolean> {
    if (!existsSync(this.backupFile)) {
      throw new CredentialStoreError('BACKUP_MISSING');
    }
    const backup = readFileSync(this.backupFile);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, backup, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.repairState = { status: 'ok' };
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
    return this.loadStoreSync() !== null;
  }

  async commitLegacyMigration(): Promise<LegacyMigrationManifest> {
    this.assertWritable();
    const source = existsSync(this.file) ? readFileSync(this.file) : Buffer.alloc(0);
    const store = this.loadStoreSync();
    if (!store) throw new CredentialStoreError('PROVIDER_UNAVAILABLE');
    this.encryptionKey = null;
    this.saveStoreSync(store);
    return {
      entryCount: Object.keys(store.credentials).length,
      sourceDigest: sha256Hex(source),
      codecStatus: 'legacy-to-v2',
    };
  }

  private assertWritable(): void {
    if (this.repairState.status === 'repair_required') {
      throw new CredentialStoreError('WRITE_BLOCKED', this.repairState.code);
    }
  }

  private enterRepair(source: Buffer, code: 'malformed_header' | 'decrypt_failed'): void {
    const digest = sha256Hex(source);
    const quarantinePath = join(
      this.directory,
      `${STORE_NAME}.quarantine.${Date.now()}.${digest.slice(0, 12)}`,
    );
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    }
    writeFileSync(quarantinePath, source, { mode: 0o600 });
    const copied = readFileSync(quarantinePath);
    if (!copied.equals(source) || sha256Hex(copied) !== digest) {
      this.repairState = { status: 'repair_required', code, sourceDigest: digest, quarantinePath };
      this.cachedStore = null;
      return;
    }
    if (existsSync(this.file)) unlinkSync(this.file);
    this.repairState = { status: 'repair_required', code, sourceDigest: digest, quarantinePath };
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
  }

  /** Clear cached data (for testing or forced refresh) */
  clearCache(): void {
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
  }
  async createMigrationSnapshot(): Promise<CredentialMigrationSnapshot> {
    if (!existsSync(this.file)) {
      throw new Error('Credential migration source is unavailable');
    }

    const source = readFileSync(this.file);
    const snapshot: CredentialMigrationSnapshot = {
      migrationId: `credential-migration-${randomUUID()}`,
      createdAt: Date.now(),
      sourceChecksum: this.checksum(source),
    };
    const snapshotDir = this.snapshotDir(snapshot.migrationId);
    mkdirSync(this.migrationsDir, { recursive: true, mode: 0o700 });
    chmodSync(this.migrationsDir, 0o700);
    mkdirSync(snapshotDir, { mode: 0o700 });
    this.writePrivateFile(join(snapshotDir, CREDENTIALS_FILE_NAME), source);
    this.writeManifest(snapshotDir, {
      migrationId: snapshot.migrationId,
      createdAt: snapshot.createdAt,
      sourceChecksum: snapshot.sourceChecksum,
      state: 'snapshot',
    });
    return snapshot;
  }

  async applyMigration(
    snapshot: CredentialMigrationSnapshot,
    replacements: readonly CredentialMigrationRecord[],
    counts: CredentialMigrationCounts,
  ): Promise<void> {
    this.readSnapshot(snapshot);
    if (!existsSync(this.file)) {
      throw new Error('Credential migration source is unavailable');
    }
    const source = readFileSync(this.file);
    if (this.checksum(source) !== snapshot.sourceChecksum) {
      throw new Error('Credential migration source changed');
    }

    const loaded = this.decryptFileData(source);
    if (!loaded) throw new Error('Credential migration source is unavailable');
    const store = cloneStore(loaded);

    const keys = new Set<string>();
    for (const replacement of replacements) {
      const key = credentialIdToAccount(replacement.id);
      if (keys.has(key) || !(key in store.credentials)) {
        throw new Error('Credential migration replacement is invalid');
      }
      keys.add(key);
    }
    if (keys.size === 0) return;

    for (const replacement of replacements) {
      store.credentials[credentialIdToAccount(replacement.id)] = replacement.credential;
    }
    store.metadata.updatedAt = Date.now();

    const encrypted = this.encryptStore(store);
    const appliedChecksum = this.checksum(encrypted);
    const appliedAt = Date.now();
    // Persist applied metadata before replacing the live file so a crash cannot
    // leave a new credentials file without rollback eligibility.
    this.writeManifest(this.snapshotDir(snapshot.migrationId), {
      migrationId: snapshot.migrationId,
      createdAt: snapshot.createdAt,
      sourceChecksum: snapshot.sourceChecksum,
      state: 'applied',
      appliedChecksum,
      appliedAt,
      counts,
    });
    this.writePrivateFile(this.file, encrypted);
    this.cachedStore = store;
  }

  async rollbackMigration(migrationId: string): Promise<void> {
    const snapshot = this.snapshotFromManifest(this.readManifest(migrationId));
    const { backup, manifest } = this.readSnapshot(snapshot);
    if (manifest.state !== 'applied' || !manifest.appliedChecksum) {
      throw new Error('Credential migration rollback is unavailable');
    }
    if (!existsSync(this.file)) {
      throw new Error('Credential migration source changed');
    }
    const currentChecksum = this.checksum(readFileSync(this.file));
    if (currentChecksum !== manifest.appliedChecksum && currentChecksum !== manifest.sourceChecksum) {
      throw new Error('Credential migration source changed');
    }
    this.writePrivateFile(this.file, backup);
    this.cachedStore = null;
    this.writeManifest(this.snapshotDir(migrationId), {
      ...manifest,
      state: 'rolled_back',
      rolledBackAt: Date.now(),
    });
  }

  async getLatestMigrationStatus(): Promise<CredentialMigrationStatus | null> {
    if (!existsSync(this.migrationsDir)) return null;

    let names: string[];
    try {
      names = readdirSync(this.migrationsDir);
    } catch {
      throw new Error('Credential migration snapshot is unavailable');
    }

    const completed: CredentialMigrationManifest[] = [];
    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (!/^credential-migration-[0-9a-f-]{36}$/i.test(name)) {
        throw new Error('Credential migration snapshot is invalid');
      }
      const manifest = this.readManifest(name);
      const backupPath = join(this.snapshotDir(name), CREDENTIALS_FILE_NAME);
      let backup: Buffer;
      try {
        backup = readFileSync(backupPath);
      } catch {
        throw new Error('Credential migration snapshot is unavailable');
      }
      if (this.checksum(backup) !== manifest.sourceChecksum) {
        throw new Error('Credential migration snapshot is invalid');
      }
      if (manifest.state === 'applied' || manifest.state === 'rolled_back') {
        if (!manifest.counts || !manifest.appliedChecksum) {
          throw new Error('Credential migration snapshot is invalid');
        }
        completed.push(manifest);
      }
    }

    if (completed.length === 0) return null;
    completed.sort((a, b) => {
      const timeA = a.appliedAt ?? a.createdAt;
      const timeB = b.appliedAt ?? b.createdAt;
      if (timeA !== timeB) return timeB - timeA;
      return b.migrationId.localeCompare(a.migrationId);
    });
    const candidate = completed[0];
    if (!candidate) return null;
    return this.sanitizeStatus(candidate);
  }

  private checksum(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private snapshotDir(migrationId: string): string {
    if (!/^credential-migration-[0-9a-f-]{36}$/i.test(migrationId)) {
      throw new Error('Credential migration snapshot is invalid');
    }
    return join(this.migrationsDir, migrationId);
  }

  private readSnapshot(snapshot: CredentialMigrationSnapshot): {
    backup: Buffer;
    manifest: CredentialMigrationManifest;
  } {
    const snapshotDir = this.snapshotDir(snapshot.migrationId);
    const manifestPath = join(snapshotDir, 'manifest.json');
    const backupPath = join(snapshotDir, CREDENTIALS_FILE_NAME);
    let manifest: CredentialMigrationManifest;
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!isCredentialMigrationManifest(parsed)) throw new Error('invalid manifest');
      manifest = parsed;
    } catch {
      throw new Error('Credential migration snapshot is unavailable');
    }
    if (
      manifest.migrationId !== snapshot.migrationId ||
      manifest.createdAt !== snapshot.createdAt ||
      manifest.sourceChecksum !== snapshot.sourceChecksum
    ) {
      throw new Error('Credential migration snapshot is invalid');
    }
    let backup: Buffer;
    try {
      backup = readFileSync(backupPath);
    } catch {
      throw new Error('Credential migration snapshot is unavailable');
    }
    if (this.checksum(backup) !== snapshot.sourceChecksum) {
      throw new Error('Credential migration snapshot is invalid');
    }
    return { backup, manifest };
  }

  private readManifest(migrationId: string): CredentialMigrationManifest {
    const manifestPath = join(this.snapshotDir(migrationId), 'manifest.json');
    let raw: string;
    try {
      raw = readFileSync(manifestPath, 'utf8');
    } catch {
      throw new Error('Credential migration snapshot is unavailable');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Credential migration snapshot is invalid');
    }
    if (!isCredentialMigrationManifest(parsed) || parsed.migrationId !== migrationId) {
      throw new Error('Credential migration snapshot is invalid');
    }
    return parsed;
  }

  private snapshotFromManifest(manifest: CredentialMigrationManifest): CredentialMigrationSnapshot {
    return {
      migrationId: manifest.migrationId,
      createdAt: manifest.createdAt,
      sourceChecksum: manifest.sourceChecksum,
    };
  }

  private sanitizeStatus(manifest: CredentialMigrationManifest): CredentialMigrationStatus {
    if (!manifest.counts) {
      throw new Error('Credential migration snapshot is invalid');
    }
    let rollbackAvailable = false;
    if (manifest.state === 'applied' && manifest.appliedChecksum && existsSync(this.file)) {
      const currentChecksum = this.checksum(readFileSync(this.file));
      rollbackAvailable =
        currentChecksum === manifest.appliedChecksum || currentChecksum === manifest.sourceChecksum;
    }
    return {
      migrationId: manifest.migrationId,
      state: manifest.state === 'rolled_back' ? 'rolled_back' : 'applied',
      createdAt: manifest.createdAt,
      appliedAt: manifest.appliedAt ?? null,
      rolledBackAt: manifest.rolledBackAt ?? null,
      ready: manifest.counts.ready,
      alreadyEnvelope: manifest.counts.alreadyEnvelope,
      skipped: manifest.counts.skipped,
      invalid: manifest.counts.invalid,
      rollbackAvailable,
    };
  }

  private writeManifest(snapshotDir: string, manifest: CredentialMigrationManifest): void {
    this.writePrivateFile(join(snapshotDir, 'manifest.json'), Buffer.from(JSON.stringify(manifest), 'utf8'));
  }

  private writePrivateFile(path: string, data: Buffer): void {
    const parent = dirname(path);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      chmodSync(parent, 0o700);
    }
    const temporary = join(parent, `.${randomUUID()}.tmp`);
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    const directoryFd = openSync(parent, 'r');
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  }

  private encryptStore(store: CredentialStore): Buffer {
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    }

    const salt = this.salt || randomBytes(SALT_SIZE);
    this.salt = salt;
    const key = this.getEncryptionKey(salt);
    const plaintext = Buffer.from(JSON.stringify(store), 'utf8');
    const iv = randomBytes(IV_SIZE);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt32LE(0, MAGIC_SIZE);
    salt.copy(header, MAGIC_SIZE + FLAGS_SIZE);
    return Buffer.concat([header, iv, authTag, ciphertext]);
  }

  private decryptFileData(fileData: Buffer): CredentialStore | null {
    if (fileData.length < HEADER_SIZE + IV_SIZE + AUTH_TAG_SIZE) {
      return null;
    }
    if (!fileData.subarray(0, MAGIC_SIZE).equals(MAGIC_BYTES)) {
      return null;
    }
    const salt = fileData.subarray(MAGIC_SIZE + FLAGS_SIZE, MAGIC_SIZE + FLAGS_SIZE + SALT_SIZE);
    this.salt = salt;
    const encryptedData = fileData.subarray(HEADER_SIZE);
    const newKey = this.getEncryptionKey(salt);
    const store = this.tryDecrypt(encryptedData, newKey);
    if (store) return store;
    const legacyKey = this.getLegacyEncryptionKey(salt);
    return this.tryDecrypt(encryptedData, legacyKey);
  }

}

function sha256Hex(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
