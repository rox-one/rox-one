import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, SignJWT, type JSONWebKeySet, type JWK } from 'jose';
import { constants } from 'node:fs';
import { mkdir, lstat, open, link, unlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { AuthenticationError } from './verified-actor';

export type LocalCredentialAccount = Readonly<{
  subject: string;
  passwordHash: string;
  disabled: boolean;
}>;

export interface LocalIssuerPersistence {
  findAccount(login: string): Promise<LocalCredentialAccount | null>;
  /** Transactionally reject disabled accounts and record the issuer session. */
  createSession(input: Readonly<{
    issuer: string; subject: string; sessionId: string; tokenId: string;
    deviceId: string; expiresAt: number;
  }>): Promise<boolean>;
}

export type LocalIssuerConfig = {
  /** Explicit local-bootstrap mode; this factory is never an implicit auth fallback. */
  mode: 'local-bootstrap';
  issuer: string;
  audience: string;
  /** Absolute private state directory outside the checkout. */
  stateDirectory: string;
  checkoutDirectory: string;
  tokenLifetimeSeconds?: number;
  now?: () => Date;
};

const validString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

async function loadPrivateJwk(keyPath: string): Promise<JWK> {
  const info = await lstat(keyPath);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('Local issuer key must be an owned regular file with mode 0600');
  }
  const handle = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const checked = await handle.stat();
    if (checked.ino !== info.ino || checked.dev !== info.dev) throw new Error('Local issuer key changed during open');
    const jwk = JSON.parse(await handle.readFile('utf8')) as JWK;
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !validString(jwk.d) || !validString(jwk.x)) {
      throw new Error('Local issuer key must be Ed25519');
    }
    return jwk;
  } finally { await handle.close(); }
}

export async function createLocalIssuer(config: LocalIssuerConfig, persistence: LocalIssuerPersistence) {
  const lifetime = config.tokenLifetimeSeconds ?? 300;
  if (config.mode !== 'local-bootstrap' || !validString(config.issuer) || !validString(config.audience) ||
      !isAbsolute(config.stateDirectory) || !isAbsolute(config.checkoutDirectory) ||
      !Number.isInteger(lifetime) || lifetime < 1 || lifetime > 900) throw new Error('Invalid explicit local issuer configuration');
  const stateDirectory = resolve(config.stateDirectory);
  const checkoutDirectory = await realpath(config.checkoutDirectory);
  const isWithinCheckout = (candidate: string) => {
    const delta = relative(checkoutDirectory, candidate);
    return !delta || (delta !== '..' && !delta.startsWith('../') && !isAbsolute(delta));
  };
  if (isWithinCheckout(stateDirectory)) {
    throw new Error('Local issuer state must be outside the checkout');
  }
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  if (isWithinCheckout(await realpath(stateDirectory))) throw new Error('Local issuer state resolves inside the checkout');
  const directory = await lstat(stateDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && directory.uid !== process.getuid())) throw new Error('Local issuer directory must have mode 0700');
  const keyPath = resolve(stateDirectory, 'issuer-ed25519.private.jwk');
  try { await lstat(keyPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const privateJwk = await exportJWK(privateKey);
    const tempPath = resolve(stateDirectory, `.issuer-key-${crypto.randomUUID()}.tmp`);
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(privateJwk));
      await handle.sync();
    } finally { await handle.close(); }
    try {
      // Atomic no-overwrite publication: concurrent startup reuses the winning key.
      await link(tempPath, keyPath);
      const directoryHandle = await open(stateDirectory, constants.O_RDONLY);
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (publishError) {
      if ((publishError as NodeJS.ErrnoException).code !== 'EEXIST') throw publishError;
    } finally { await unlink(tempPath); }
  }
  const privateJwk = await loadPrivateJwk(keyPath);
  const kid = await calculateJwkThumbprint(privateJwk);
  const privateKey = await importJWK(privateJwk, 'EdDSA');
  const publicJwk: JWK = { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x, kid, alg: 'EdDSA', use: 'sig' };
  const issuer = config.issuer;
  const audience = config.audience;
  const now = config.now ?? (() => new Date());
  // Unknown-account attempts still execute real Argon2id verification.
  const timingHash = await Bun.password.hash(crypto.randomUUID(), { algorithm: 'argon2id' });

  return {
    jwks(): JSONWebKeySet { return { keys: [{ ...publicJwk }] }; },
    async authenticate(login: string, password: string): Promise<Readonly<{ token: string; expiresAt: number }>> {
      if (!validString(login) || login.length > 320 || typeof password !== 'string' || !password.length || password.length > 4096) {
        throw new AuthenticationError();
      }
      try {
        const account = await persistence.findAccount(login);
        const isArgon2id = account !== null && account.passwordHash.startsWith('$argon2id$');
        const passwordHash = account !== null && isArgon2id ? account.passwordHash : timingHash;
        const verified = await Bun.password.verify(password, passwordHash);
        if (!account || !isArgon2id || !verified || account.disabled || !validString(account.subject)) throw new AuthenticationError();
        const issuedAt = Math.floor(now().getTime() / 1000);
        const expiresAt = (issuedAt + lifetime) * 1000;
        const sessionId = crypto.randomUUID();
        const tokenId = crypto.randomUUID();
        const deviceId = crypto.randomUUID();
        const accepted = await persistence.createSession({
          issuer, subject: account.subject, sessionId, tokenId, deviceId, expiresAt,
        });
        if (!accepted) throw new AuthenticationError();
        const token = await new SignJWT({ sid: sessionId })
          .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
          .setIssuer(issuer).setAudience(audience).setSubject(account.subject)
          .setJti(tokenId).setIssuedAt(issuedAt).setNotBefore(issuedAt).setExpirationTime(issuedAt + lifetime)
          .sign(privateKey);
        return Object.freeze({ token, expiresAt });
      } catch { throw new AuthenticationError(); }
    },
  };
}

/** Provisioning code persists this hash; plaintext passwords never enter artifacts. */
export async function hashLocalAccountPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 4096) throw new Error('Account password must contain 12 to 4096 characters');
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}
