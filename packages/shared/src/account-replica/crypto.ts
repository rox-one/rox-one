import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { ReplicaEnvelope } from './types.ts';

const KEY_LEN = 32;
const IV_LEN = 12;
const PBKDF2_ITERS = 120_000;

export function generateAccountKey(): Buffer {
  return randomBytes(KEY_LEN);
}

export function deriveKey(secret: string, salt: Buffer): Buffer {
  return pbkdf2Sync(secret, salt, PBKDF2_ITERS, KEY_LEN, 'sha256');
}

export function encryptBytes(key: Buffer, plaintext: Buffer): ReplicaEnvelope {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptBytes(key: Buffer, envelope: ReplicaEnvelope): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

export function wrapAccountKey(accountKey: Buffer, wrappingSecret: string, salt: Buffer): ReplicaEnvelope {
  return encryptBytes(deriveKey(wrappingSecret, salt), accountKey);
}

export function unwrapAccountKey(envelope: ReplicaEnvelope, wrappingSecret: string, salt: Buffer): Buffer {
  return decryptBytes(deriveKey(wrappingSecret, salt), envelope);
}
