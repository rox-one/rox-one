/**
 * Secret protection for the BYOK vault.
 *
 * AES-256-GCM (authenticated encryption) with a 32-byte master key supplied by
 * the caller. Nothing here caches, logs or otherwise retains a plaintext secret;
 * a wrong key or a modified tag/ciphertext fails the GCM check and throws.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Required master key length: AES-256. */
export const MASTER_KEY_BYTES = 32;

/** GCM nonce length recommended by NIST SP 800-38D for AES-GCM. */
const IV_BYTES = 12;
/** GCM authentication tag length in bytes (128 bits). */
const TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';
const ENCODING = 'base64';

/** Encrypted payload of one secret, every field base64. */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

function assertMasterKey(masterKey: Uint8Array): void {
  if (!(masterKey instanceof Uint8Array) || masterKey.byteLength !== MASTER_KEY_BYTES) {
    throw new Error(`Master key must be ${MASTER_KEY_BYTES} bytes (AES-256-GCM)`);
  }
}

/** Encrypt a plaintext secret. A fresh random IV is generated per call. */
export function encryptSecret(plain: string, masterKey: Uint8Array): EncryptedSecret {
  assertMasterKey(masterKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString(ENCODING),
    iv: iv.toString(ENCODING),
    tag: cipher.getAuthTag().toString(ENCODING),
  };
}

/**
 * Decrypt a stored secret.
 *
 * Throws when the master key differs from the one used to encrypt, or when the
 * IV, tag or ciphertext was modified — GCM refuses to authenticate.
 */
export function decryptSecret(stored: EncryptedSecret, masterKey: Uint8Array): string {
  assertMasterKey(masterKey);
  const iv = Buffer.from(stored.iv, ENCODING);
  const tag = Buffer.from(stored.tag, ENCODING);
  if (iv.byteLength !== IV_BYTES) {
    throw new Error('Stored credential iv is invalid');
  }
  if (tag.byteLength !== TAG_BYTES) {
    throw new Error('Stored credential tag is invalid');
  }
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(stored.ciphertext, ENCODING)),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Stable, non-reversible identity of a secret: SHA-256 hex. */
export function fingerprintSecret(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/** Last four characters of the secret, for the panel's recognition hint. */
export function lastFour(plain: string): string {
  return plain.slice(-4);
}
