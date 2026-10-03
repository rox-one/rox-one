import { describe, expect, it } from 'vitest';
import { Long } from '@mtcute/node';
import { decodedOffset, encodedOffset } from './communityTools.js';

describe('invite importer cursor encoding', () => {
  it('preserves the Telegram user access hash without exposing a raw Long object', () => {
    const anchor = { date: 1_700_000_000, user: { _: 'inputUser', userId: 42,
      accessHash: Long.fromString('9007199254740993') } };
    const encoded = encodedOffset(anchor);
    expect(encoded?.user.accessHash).toBe('9007199254740993');
    const decoded = decodedOffset(encoded);
    expect(decoded?.date).toBe(1_700_000_000);
    expect(String(decoded?.user.accessHash)).toBe('9007199254740993');
  });
});
