/** Canonical service plus copy-only compatibility with already encrypted stores. */
export const ROX_CREDENTIAL_KEYCHAIN_SERVICE = 'rox.credentials';
export const LEGACY_CREDENTIAL_KEYCHAIN_SERVICE = 'craft-agent.credentials';
const KEY_HEX = /^[0-9a-f]{64}$/i;

export function readOrMigrateKeychainMasterKey(
  read: (service: string) => string | null,
  write: (service: string, key: string) => boolean,
): string | null {
  const canonical = read(ROX_CREDENTIAL_KEYCHAIN_SERVICE);
  if (canonical && KEY_HEX.test(canonical)) return canonical.toLowerCase();
  const legacy = read(LEGACY_CREDENTIAL_KEYCHAIN_SERVICE);
  if (!legacy || !KEY_HEX.test(legacy)) return null;
  const key = legacy.toLowerCase();
  // Migration is best effort: read access to the preserved legacy key remains
  // sufficient when the user or OS denies creation of the new keychain entry.
  try { write(ROX_CREDENTIAL_KEYCHAIN_SERVICE, key); } catch { /* preserve readable legacy fallback */ }
  return key;
}
