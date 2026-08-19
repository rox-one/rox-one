/**
 * Ticket 12 — OMP startup codes on the agent TypedError / ErrorCode union.
 *
 * TypedError rides on session `typed_error` events. A new OMP startup code
 * must be a member of this union (and the runtime list) so the renderer/CLI
 * can switch on it; unknown strings must be rejected rather than silently
 * accepted as a generic code.
 */
import { describe, expect, it } from 'bun:test';

import {
  AGENT_ERROR_CODES,
  isAgentErrorCode,
  type ErrorCode,
} from '../message.ts';

/** The six OMP startup codes that must live on the agent ErrorCode union. */
const OMP_STARTUP_CODES = [
  'OMP_NOT_CONFIGURED',
  'OMP_NO_MODELS',
  'OMP_AUTH_REQUIRED',
  'OMP_START_FAILED',
  'OMP_READY_TIMEOUT',
  'OMP_PROTOCOL_ERROR',
] as const satisfies readonly ErrorCode[];

describe('agent ErrorCode union — OMP startup codes', () => {
  it('lists all six OMP startup codes as ErrorCode members', () => {
    expect(OMP_STARTUP_CODES).toHaveLength(6);
    for (const code of OMP_STARTUP_CODES) {
      expect(AGENT_ERROR_CODES.includes(code)).toBe(true);
      expect(isAgentErrorCode(code)).toBe(true);
    }
  });

  it('rejects an unknown code (not silently a generic string)', () => {
    expect(isAgentErrorCode('OMP_FAKE')).toBe(false);
    expect(isAgentErrorCode('not_a_code')).toBe(false);
    expect(isAgentErrorCode('unknown_error')).toBe(true);
  });

  it('AGENT_ERROR_CODES is exhaustive for the ErrorCode union', () => {
    const asErrorCodes: readonly ErrorCode[] = AGENT_ERROR_CODES;
    expect(asErrorCodes.length).toBe(AGENT_ERROR_CODES.length);
    expect(new Set(AGENT_ERROR_CODES).size).toBe(AGENT_ERROR_CODES.length);
  });
});
