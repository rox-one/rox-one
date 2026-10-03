import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

interface CursorEnvelope<T> {
  version: number;
  kind: string;
  binding: string;
  expiresAt: number;
  state: T;
}
function keyFromSecret(secret: string) {
  return createHash("sha256")
    .update("telegram-for-agents:opaque-cursor:v1\0")
    .update(secret)
    .digest();
}

export interface OpaqueCursorCodec {
  encode<T>(kind: string, binding: string, state: T): string;
  decode<T>(cursor: string, kind: string, binding: string): T;
}

export function createOpaqueCursorCodec(
  secret: string,
  now: () => number = Date.now,
): OpaqueCursorCodec {
  if (!secret) {
    throw new Error("A non-empty cursor secret is required.");
  }

  const key = keyFromSecret(secret);

  return {
    encode<T>(kind: string, binding: string, state: T) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const envelope: CursorEnvelope<T> = {
        version: CURSOR_VERSION,
        kind,
        binding,
        expiresAt: now() + CURSOR_TTL_MS,
        state,
      };
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(envelope), "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64url");
    },

    decode<T>(cursor: string, kind: string, binding: string) {
      try {
        const packed = Buffer.from(cursor, "base64url");
        if (packed.length <= 28) {
          throw new Error("cursor payload is too short");
        }
        const iv = packed.subarray(0, 12);
        const tag = packed.subarray(12, 28);
        const encrypted = packed.subarray(28);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const decoded = Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]).toString("utf8");
        const envelope = JSON.parse(decoded) as CursorEnvelope<T>;

        if (
          envelope.version !== CURSOR_VERSION ||
          envelope.kind !== kind ||
          envelope.binding !== binding ||
          !Number.isSafeInteger(envelope.expiresAt) ||
          envelope.expiresAt <= now()
        ) {
          throw new Error("cursor context is invalid or expired");
        }

        return envelope.state;
      } catch {
        throw new Error("The cursor is invalid, expired, or belongs to another account.");
      }
    },
  };
}
