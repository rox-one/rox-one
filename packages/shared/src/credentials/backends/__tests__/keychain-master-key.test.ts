import { describe, expect, it } from 'bun:test';
import { readOrMigrateKeychainMasterKey, ROX_CREDENTIAL_KEYCHAIN_SERVICE as ROX, LEGACY_CREDENTIAL_KEYCHAIN_SERVICE as LEGACY } from '../keychain-master-key.ts';
const syntheticKey = 'ab'.repeat(32);
describe('credential keychain service migration', () => {
  it('copies the same validated legacy key and preserves the legacy entry', () => {
    const entries = new Map([[LEGACY, syntheticKey]]);
    const resolved = readOrMigrateKeychainMasterKey(s => entries.get(s) ?? null, (s,k) => { entries.set(s,k); return true; });
    expect(resolved === syntheticKey).toBe(true);
    expect(entries.get(ROX) === entries.get(LEGACY)).toBe(true);
    expect(entries.has(LEGACY)).toBe(true);
  });
  it('prefers canonical entries without reading or rewriting the legacy key', () => {
    const reads: string[] = []; let writes = 0;
    readOrMigrateKeychainMasterKey(s => { reads.push(s); return syntheticKey; }, () => { writes++; return true; });
    expect(reads).toEqual([ROX]); expect(writes).toBe(0);
  });
  it('retains readable legacy fallback when canonical writes are denied', () => {
    expect(readOrMigrateKeychainMasterKey(s => s === LEGACY ? syntheticKey : null, () => false) === syntheticKey).toBe(true);
    expect(readOrMigrateKeychainMasterKey(s => s === LEGACY ? syntheticKey : null, () => { throw new Error('denied'); }) === syntheticKey).toBe(true);
  });
  it('rejects invalid key material and never copies it', () => {
    let writes = 0;
    expect(readOrMigrateKeychainMasterKey(() => 'invalid', () => { writes++; return true; })).toBeNull();
    expect(writes).toBe(0);
  });
});
