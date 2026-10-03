import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigValidator } from '../config-validator.ts';
import { PathProcessor } from '../path-processor.ts';
import { getAppPermissionsDir } from '../../permissions-config.ts';
import { getPathHint } from '../../mode-manager.ts';
const roxEnv = process.env.ROX_CONFIG_DIR;
const legacyEnv = process.env.CRAFT_CONFIG_DIR;
afterEach(() => {
  if (roxEnv === undefined) delete process.env.ROX_CONFIG_DIR; else process.env.ROX_CONFIG_DIR = roxEnv;
  if (legacyEnv === undefined) delete process.env.CRAFT_CONFIG_DIR; else process.env.CRAFT_CONFIG_DIR = legacyEnv;
});
describe('ROX runtime config paths', () => {
  it('resolves permissions through the canonical explicit root', () => {
    process.env.ROX_CONFIG_DIR = '/tmp/rox-custom-config';
    process.env.CRAFT_CONFIG_DIR = '/tmp/ignored-legacy';
    expect(getAppPermissionsDir().replace(/\\/g, '/')).toBe('/tmp/rox-custom-config/permissions');
  });
  it('detects configured, canonical and legacy config paths without matching siblings', () => {
    process.env.ROX_CONFIG_DIR = '/tmp/rox-custom-config';
    const validator = new ConfigValidator();
    const processor = new PathProcessor();
    for (const root of ['/tmp/rox-custom-config', '/home/u/.rox', '/home/u/.craft-agent', '/home/u/.craft-agents']) {
      expect(validator.isCraftAgentConfig(root + '/config.json')).toBe(true);
      expect(validator.isCraftAgentConfig(root + '/workspaces/ws/sources/github/config.json')).toBe(true);
      expect(processor.isConfigFile(root + '/workspaces/ws/permissions.json')).toBe(true);
      expect(processor.isConfigFile(root + '/workspaces/ws/skills/example/SKILL.md')).toBe(true);
    }
    expect(validator.isCraftAgentConfig('/tmp/rox-custom-config-other/config.json')).toBe(false);
    expect(processor.isConfigFile('/tmp/rox-custom-config-other/preferences.json')).toBe(false);
  });
  it('uses actual workspace paths for safe-mode guidance', () => {
    process.env.ROX_CONFIG_DIR = '/tmp/custom-root';
    expect(getPathHint('/tmp/custom-root/workspaces/ws/notes.txt', '/tmp/custom-root/workspaces/ws/sessions/s1/plans')).toContain('workspace root');
    expect(getPathHint('/tmp/custom-root-other/out.txt', '/tmp/custom-root/workspaces/ws/sessions/s1/plans')).toContain('session plans or data folder');
    expect(getPathHint('/tmp/custom-root/theme.json', '/tmp/custom-root/workspaces/ws/sessions/s1/plans')).toBeNull();
  });
});
