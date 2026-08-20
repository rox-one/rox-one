import { describe, expect, test } from 'bun:test';
import {
  parseSessionMapPin,
  pruneSessionMapPin,
  serializeSessionMapPin,
  sessionMapPinStorageKey,
  type SessionMapPin,
} from '../session-map-pin.ts';

const SESSION = 'abc';

const validPin: SessionMapPin = {
  v: 1,
  sessionId: SESSION,
  camera: 'map',
  viewport: { x: 10, y: 20, zoom: 1.5 },
  nodes: {
    scn_a: { x: 1, y: 2 },
    scn_b: { x: 3, y: 4 },
  },
};

describe('sessionMapPinStorageKey', () => {
  test('uses rox.sessionMap.layout prefix', () => {
    expect(sessionMapPinStorageKey('abc')).toBe('rox.sessionMap.layout.abc');
  });
});

describe('parseSessionMapPin', () => {
  test('returns null for missing or empty raw', () => {
    expect(parseSessionMapPin(null, SESSION)).toBeNull();
    expect(parseSessionMapPin(undefined, SESSION)).toBeNull();
    expect(parseSessionMapPin('', SESSION)).toBeNull();
  });

  test('returns null for non-JSON', () => {
    expect(parseSessionMapPin('not-json', SESSION)).toBeNull();
  });

  test('returns null for array', () => {
    expect(parseSessionMapPin('[]', SESSION)).toBeNull();
  });

  test('returns null for wrong version', () => {
    expect(parseSessionMapPin(JSON.stringify({ v: 2 }), SESSION)).toBeNull();
  });

  test('returns null when sessionId is missing', () => {
    expect(
      parseSessionMapPin(
        JSON.stringify({ v: 1, camera: 'map', nodes: {} }),
        SESSION,
      ),
    ).toBeNull();
  });

  test('returns null on sessionId mismatch', () => {
    expect(
      parseSessionMapPin(
        JSON.stringify({ ...validPin, sessionId: 'other' }),
        SESSION,
      ),
    ).toBeNull();
  });

  test('returns null when nodes is not an object', () => {
    expect(
      parseSessionMapPin(
        JSON.stringify({ v: 1, sessionId: SESSION, camera: 'map', nodes: [] }),
        SESSION,
      ),
    ).toBeNull();
    expect(
      parseSessionMapPin(
        JSON.stringify({ v: 1, sessionId: SESSION, camera: 'map', nodes: 'nope' }),
        SESSION,
      ),
    ).toBeNull();
  });
});

describe('serializeSessionMapPin / parseSessionMapPin', () => {
  test('valid pin round-trips and keeps optional viewport', () => {
    const raw = serializeSessionMapPin(validPin);
    expect(parseSessionMapPin(raw, SESSION)).toEqual(validPin);
  });

  test('round-trips without viewport', () => {
    const pin: SessionMapPin = {
      v: 1,
      sessionId: SESSION,
      camera: 'flow',
      nodes: { scn_a: { x: 0, y: 0 } },
    };
    expect(parseSessionMapPin(serializeSessionMapPin(pin), SESSION)).toEqual(pin);
  });
});

describe('pruneSessionMapPin', () => {
  test('drops unknown node ids and keeps known nodes, viewport, camera, sessionId', () => {
    const pruned = pruneSessionMapPin(validPin, new Set(['scn_a']));
    expect(pruned).toEqual({
      v: 1,
      sessionId: SESSION,
      camera: 'map',
      viewport: { x: 10, y: 20, zoom: 1.5 },
      nodes: { scn_a: { x: 1, y: 2 } },
    });
  });
});
