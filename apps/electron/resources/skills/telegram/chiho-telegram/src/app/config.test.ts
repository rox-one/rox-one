import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSessionDir, loadConfig } from './config.js';
import { CliError } from './errors.js';

const ENV_KEYS = ['AI_MODE', 'GEMINI_API_KEY', 'OPENCLAW_BASE_URL'] as const;
const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe('loadConfig', () => {
  it('uses a stable code for missing Gemini configuration', () => {
    process.env.AI_MODE = 'gemini';
    process.env.GEMINI_API_KEY = '';
    process.env.OPENCLAW_BASE_URL = '';

    expect(() => loadConfig(['--json'])).toThrowError(
      new CliError('AI_MODE=gemini requires GEMINI_API_KEY.', 'AI_NOT_CONFIGURED'),
    );
  });

  it('uses a stable code for invalid AI mode', () => {
    process.env.AI_MODE = 'invalid';
    process.env.GEMINI_API_KEY = '';
    process.env.OPENCLAW_BASE_URL = '';

    expect(() => loadConfig(['--json'])).toThrowError(
      new CliError('AI_MODE must be one of: gemini, openclaw.', 'AI_MODE_INVALID'),
    );
  });
});

describe('ensureSessionDir', () => {
  it('uses a stable storage code when the session directory cannot be created', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tgchats-config-test-'));
    const filePath = join(dir, 'not-a-directory');
    writeFileSync(filePath, 'x');

    try {
      expect(() => ensureSessionDir(join(filePath, 'session.sqlite'))).toThrowError(
        new CliError(
          'Telegram session storage directory could not be created. Check TELEGRAM_SESSION_PATH and local filesystem permissions.',
          'TELEGRAM_SESSION_STORAGE_OPEN_FAILED',
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
