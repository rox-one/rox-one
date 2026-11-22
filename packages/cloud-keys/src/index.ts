/**
 * Public surface of the Rox Cloud BYOK key vault.
 *
 * There is no default master key and no built-in secret: the caller supplies a
 * 32-byte key, and every function that could touch a secret takes it explicitly.
 */

export type {
  AddCredentialInput,
  CredentialHealth,
  CredentialStatus,
  ProviderCredential,
  ProviderId,
  StoredCredential,
} from './types.ts';

export {
  MASTER_KEY_BYTES,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  lastFour,
} from './crypto.ts';
export type { EncryptedSecret } from './crypto.ts';

export {
  KeyStoreError,
  MIN_SECRET_LENGTH,
  addCredential,
  assertWithinCap,
  createMemoryKeyStore,
  disableCredential,
  listCredentials,
  markHealth,
  promoteCredential,
} from './store.ts';
export type {
  KeyStore,
  KeyStoreErrorCode,
  MemoryKeyStoreOptions,
  SpendCapErrorCode,
  SpendCapRejection,
} from './store.ts';
