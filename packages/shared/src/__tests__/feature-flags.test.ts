import { describe, it, expect, afterEach } from 'bun:test';
import { isDevRuntime, isDeveloperFeedbackEnabled, isCraftAgentsCliEnabled, isEmbeddedServerEnabled, isNativeSidecarEnabled, isNativeIndexPrimaryEnabled } from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  CRAFT_DEBUG: process.env.CRAFT_DEBUG,
  CRAFT_FEATURE_DEVELOPER_FEEDBACK: process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK,
  CRAFT_FEATURE_CRAFT_AGENTS_CLI: process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI,
  CRAFT_FEATURE_EMBEDDED_SERVER: process.env.CRAFT_FEATURE_EMBEDDED_SERVER,
  CRAFT_FEATURE_NATIVE_SIDECAR: process.env.CRAFT_FEATURE_NATIVE_SIDECAR,
  CRAFT_FEATURE_NATIVE_INDEX_PRIMARY: process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.CRAFT_DEBUG === undefined) delete process.env.CRAFT_DEBUG;
  else process.env.CRAFT_DEBUG = ORIGINAL_ENV.CRAFT_DEBUG;

  if (ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.CRAFT_FEATURE_CRAFT_AGENTS_CLI === undefined) delete process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI;
  else process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = ORIGINAL_ENV.CRAFT_FEATURE_CRAFT_AGENTS_CLI;

  if (ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.CRAFT_FEATURE_EMBEDDED_SERVER;
  else process.env.CRAFT_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER;

  if (ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_SIDECAR === undefined) delete process.env.CRAFT_FEATURE_NATIVE_SIDECAR;
  else process.env.CRAFT_FEATURE_NATIVE_SIDECAR = ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_SIDECAR;

  if (ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY === undefined) delete process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY;
  else process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY;
});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CRAFT_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for CRAFT_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRAFT_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CRAFT_DEBUG;
    process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRAFT_DEBUG = '1';
    delete process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled defaults to false when no override is set', () => {
    delete process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI;

    expect(isCraftAgentsCliEnabled()).toBe(false);
  });

  it('isCraftAgentsCliEnabled honors explicit override true', () => {
    process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = '1';

    expect(isCraftAgentsCliEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled honors explicit override false', () => {
    process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = '0';

    expect(isCraftAgentsCliEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled defaults to false when no override is set', () => {
    delete process.env.CRAFT_FEATURE_EMBEDDED_SERVER;

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled honors explicit override true', () => {
    process.env.CRAFT_FEATURE_EMBEDDED_SERVER = '1';

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override false', () => {
    process.env.CRAFT_FEATURE_EMBEDDED_SERVER = '0';

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isNativeSidecarEnabled defaults to false', () => {
    delete process.env.CRAFT_FEATURE_NATIVE_SIDECAR;

    expect(isNativeSidecarEnabled()).toBe(false);
  });

  it('isNativeSidecarEnabled honors explicit override true', () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1';

    expect(isNativeSidecarEnabled()).toBe(true);
  });

  it('isNativeSidecarEnabled honors explicit override false', () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '0';

    expect(isNativeSidecarEnabled()).toBe(false);
  });

  it('isNativeIndexPrimaryEnabled defaults to false', () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1';
    delete process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY;

    expect(isNativeIndexPrimaryEnabled()).toBe(false);
  });

  it('isNativeIndexPrimaryEnabled requires the sidecar flag', () => {
    delete process.env.CRAFT_FEATURE_NATIVE_SIDECAR;
    process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = '1';

    expect(isNativeIndexPrimaryEnabled()).toBe(false);
  });

  it('isNativeIndexPrimaryEnabled honors sidecar + primary', () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1';
    process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = '1';

    expect(isNativeIndexPrimaryEnabled()).toBe(true);
  });
});
