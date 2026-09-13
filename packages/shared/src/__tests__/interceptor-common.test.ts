import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CONFIG_FILE,
  _resetConfigCacheForTesting,
  getLastApiError,
  isExtendedPromptCacheEnabled,
  setStoredError,
  toolMetadataStore,
} from '../interceptor-common.ts';

describe('interceptor-common', () => {
  let sessionDirA: string;
  let sessionDirB: string;

  beforeEach(() => {
    sessionDirA = mkdtempSync(join(tmpdir(), 'interceptor-a-'));
    sessionDirB = mkdtempSync(join(tmpdir(), 'interceptor-b-'));
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDirA, { recursive: true, force: true });
    rmSync(sessionDirB, { recursive: true, force: true });
  });

  it('keeps API errors session-scoped when session dir is switched', () => {
    toolMetadataStore.setSessionDir(sessionDirA);
    setStoredError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'Session A auth failed',
      timestamp: Date.now(),
    });

    toolMetadataStore.setSessionDir(sessionDirB);
    setStoredError({
      status: 429,
      statusText: 'Too Many Requests',
      message: 'Session B rate limit',
      timestamp: Date.now(),
    });

    toolMetadataStore.setSessionDir(sessionDirA);
    const errA = getLastApiError();
    expect(errA?.status).toBe(401);

    toolMetadataStore.setSessionDir(sessionDirB);
    const errB = getLastApiError();
    expect(errB?.status).toBe(429);
  });

  it('merges new metadata with existing on-disk entries', () => {
    const existing = {
      existingTool: {
        intent: 'Existing',
        displayName: 'Existing Tool',
        timestamp: Date.now() - 1000,
      },
    };

    writeFileSync(join(sessionDirA, 'tool-metadata.json'), JSON.stringify(existing), 'utf-8');
    toolMetadataStore.setSessionDir(sessionDirA);

    toolMetadataStore.set('newTool', {
      intent: 'New intent',
      displayName: 'New Tool',
      timestamp: Date.now(),
    });

    const persisted = JSON.parse(readFileSync(join(sessionDirA, 'tool-metadata.json'), 'utf-8')) as Record<string, unknown>;
    expect(persisted.existingTool).toBeDefined();
    expect(persisted.newTool).toBeDefined();
  });
});

describe('isExtendedPromptCacheEnabled', () => {
  let originalConfig: string | null = null;

  beforeEach(() => {
    try {
      originalConfig = readFileSync(CONFIG_FILE, 'utf-8');
    } catch {
      originalConfig = null;
    }
  });

  afterEach(() => {
    if (originalConfig !== null) {
      writeFileSync(CONFIG_FILE, originalConfig);
    } else {
      try { unlinkSync(CONFIG_FILE); } catch { /* ignore */ }
    }
    _resetConfigCacheForTesting();
  });

  function writeConfig(payload: Record<string, unknown>): void {
    mkdirSync(dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(payload));
    _resetConfigCacheForTesting();
  }

  it('defaults on when the field is missing or config is unreadable', () => {
    writeConfig({});
    expect(isExtendedPromptCacheEnabled()).toBe(true);

    try { unlinkSync(CONFIG_FILE); } catch { /* ignore */ }
    _resetConfigCacheForTesting();
    expect(isExtendedPromptCacheEnabled()).toBe(true);
  });

  it('honors an explicit off toggle', () => {
    writeConfig({ extendedPromptCache: false });
    expect(isExtendedPromptCacheEnabled()).toBe(false);
  });
});
