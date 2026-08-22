/**
 * Secure Storage Backend
 *
 * Stores credentials in an encrypted file at ~/.craft-agent/credentials.enc
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Encryption key (v3) is derived from a random 32-byte master key using PBKDF2.
 * The master key is generated once and persisted in the OS keychain via
 * non-interactive CLI (`security` on macOS, `secret-tool` on Linux), with a
 * credentials.key fallback file at mode 0600 next to the store.
 *
 * Legacy derivations remain read-only for migration: v2 = OS hardware UUID
 * (macOS IOPlatformUUID, Windows MachineGuid, Linux machine-id), v1 =
 * hostname-based. Cutover to the master key happens only through an explicit
 * commitLegacyMigration() call.
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
} from 'crypto';
import { execSync, spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { hostname, userInfo, homedir } from 'os';
import { join } from 'path';

import type { CredentialBackend } from './types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialIdToAccount, accountToCredentialId } from '../types.ts';
import { resolveConfigDir } from "../../config/paths.ts"

const STORE_NAME = 'credentials.enc';
const BACKUP_NAME = 'credentials.enc.bak';
const KEY_FILE_NAME = 'credentials.key';
const KEYCHAIN_SERVICE = 'craft-agent.credentials';
const KEYCHAIN_ACCOUNT = 'master';
const MASTER_KEY_HEX = /^[0-9a-f]{64}$/i;

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
  readonly keyVersion?: 'v1' | 'v2' | 'v3';
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
 * Мастер-ключ шифрования (RX-TSK-0300 / RX-SEC-0001).
 *
 * Случайные 32 байта генерируются один раз и хранятся:
 *   1. В OS-keychain через CLI без интерактивных промптов
 *      (macOS: `security`, Linux: `secret-tool`/libsecret).
 *   2. Фолбэк: файл credentials.key рядом с credentials.enc, режим 0600.
 *
 * Вывод из machine-id/hostname (v2/v1) остаётся ТОЛЬКО для чтения старых
 * хранилищ; перевод на мастер-ключ — явный commitLegacyMigration().
 */
const masterKeyMemo = new Map<string, Buffer>();

function keychainReadHex(): string | null {
  try {
    if (process.platform === 'darwin') {
      const res = spawnSync(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8' },
      );
      const value = res.status === 0 ? (res.stdout ?? '').trim() : '';
      return MASTER_KEY_HEX.test(value) ? value.toLowerCase() : null;
    }
    if (process.platform === 'linux') {
      const res = spawnSync(
        'secret-tool',
        ['lookup', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT],
        { encoding: 'utf8' },
      );
      const value = res.status === 0 ? (res.stdout ?? '').trim() : '';
      return MASTER_KEY_HEX.test(value) ? value.toLowerCase() : null;
    }
  } catch {
    // Ключница недоступна — переходим к файловому фолбэку.
  }
  return null;
}

function keychainWriteHex(hex: string): boolean {
  try {
    if (process.platform === 'darwin') {
      const res = spawnSync(
        'security',
        ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', hex],
        { encoding: 'utf8' },
      );
      return res.status === 0;
    }
    if (process.platform === 'linux') {
      const res = spawnSync(
        'secret-tool',
        ['store', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT],
        { input: hex },
      );
      return res.status === 0;
    }
  } catch {
    // Запись в ключницу недоступна — используем файловый фолбэк.
  }
  return false;
}

function readMasterKeyFile(directory: string): Buffer | null {
  const path = join(directory, KEY_FILE_NAME);
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf8').trim();
    if (!MASTER_KEY_HEX.test(value)) return null;
    try {
      chmodSync(path, 0o600);
    } catch {
      // На экзотических ФС chmod может не поддерживаться — ключ уже прочитан.
    }
    return Buffer.from(value.toLowerCase(), 'hex');
  } catch {
    return null;
  }
}

function writeMasterKeyFile(directory: string, key: Buffer): boolean {
  try {
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const path = join(directory, KEY_FILE_NAME);
    writeFileSync(path, key.toString('hex'), { mode: 0o600, flag: 'wx' });
    chmodSync(path, 0o600);
    return true;
  } catch {
    return false;
  }
}

function getOrCreateMasterKey(directory: string): Buffer {
  const memo = masterKeyMemo.get(directory);
  if (memo) return memo;

  const keychainHex = keychainReadHex();
  if (keychainHex) {
    const key = Buffer.from(keychainHex, 'hex');
    masterKeyMemo.set(directory, key);
    return key;
  }

  const fromFile = readMasterKeyFile(directory);
  if (fromFile) {
    // Подтягиваем файловый ключ в ключницу, если она стала доступна.
    keychainWriteHex(fromFile.toString('hex'));
    masterKeyMemo.set(directory, fromFile);
    return fromFile;
  }

  const fresh = randomBytes(KEY_SIZE);
  if (keychainWriteHex(fresh.toString('hex')) || writeMasterKeyFile(directory, fresh)) {
    masterKeyMemo.set(directory, fresh);
    return fresh;
  }

  throw new CredentialStoreError(
    'PROVIDER_UNAVAILABLE',
    'cannot persist credential master key (keychain and file both unavailable)',
  );
}

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

export class SecureStorageBackend implements CredentialBackend {
  readonly name = 'secure-storage';
  readonly priority = 100;

  private readonly directory: string;
  private readonly file: string;
  private readonly backupFile: string;
  private readonly writeKeyVersion: 'v1' | 'v2' | 'v3';
  private cachedStore: CredentialStore | null = null;
  private encryptionKey: Buffer | null = null;
  private salt: Buffer | null = null;
  private repairState: RepairState = { status: 'ok' };

  constructor(options: SecureStorageOptions = {}) {
    this.directory = options.directory ?? resolveConfigDir();
    this.file = join(this.directory, STORE_NAME);
    this.backupFile = join(this.directory, BACKUP_NAME);
    this.writeKeyVersion = options.keyVersion ?? 'v3';
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

    // Текущий ключ: случайный мастер-ключ (v3, RX-TSK-0300).
    let store = this.tryDecrypt(encryptedData, this.getEncryptionKey(salt, 'v3'));

    if (store) {
      this.cachedStore = store;
      return store;
    }

    // Легаси v2: вывод из machine-id (публично читаемые идентификаторы).
    store = this.tryDecrypt(encryptedData, this.getEncryptionKey(salt, 'v2'));

    if (store) {
      // Dual-read: do not rewrite on get. Cutover is commitLegacyMigration().
      this.cachedStore = store;
      return store;
    }

    // Легаси v1: вывод из hostname+username+homedir.
    store = this.tryDecrypt(encryptedData, this.getLegacyEncryptionKey(salt));

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
    // Бэкап содержит те же секреты, что и основной файл — режим обязателен (RX-TSK-0301).
    try {
      chmodSync(this.backupFile, 0o600);
    } catch {
      // Экзотическая ФС без поддержки chmod: каталог уже 0700.
    }
    this.cachedStore = store;
  }

  private getEncryptionKey(salt: Buffer, version: 'v1' | 'v2' | 'v3' = 'v3'): Buffer {
    if (version === 'v3') {
      if (!this.encryptionKey) {
        this.encryptionKey = pbkdf2Sync(
          getOrCreateMasterKey(this.directory),
          salt,
          PBKDF2_ITERATIONS,
          KEY_SIZE,
          'sha256',
        );
      }
      return this.encryptionKey;
    }

    if (version === 'v2') {
      // Легаси-чтение: machine-id публично читаем, для записи не используется.
      const stableMachineId = createHash('sha256')
        .update(getStableMachineId())
        .update('craft-agent-v2')
        .digest();
      return pbkdf2Sync(stableMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
    }

    return this.getLegacyEncryptionKey(salt);
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
}

function sha256Hex(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
