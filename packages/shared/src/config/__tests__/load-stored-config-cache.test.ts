/**
 * loadStoredConfig caches the parsed config.json keyed by mtime/size/inode.
 * CONFIG_FILE is captured at module load → the scenario runs in a subprocess.
 */
import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

const SCENARIO = `
import { readFileSync, renameSync, utimesSync, writeFileSync } from 'fs';
import { loadStoredConfig, saveConfig, setStoredConfigFileIoForTests } from '${STORAGE_MODULE_PATH}';
const configPath = process.env.CACHE_TEST_CONFIG_PATH;
const counts = { reads: 0, parses: 0 };
setStoredConfigFileIoForTests({
  read: (path) => { counts.reads++; return readFileSync(path, 'utf-8'); },
  parse: (contents) => { counts.parses++; return JSON.parse(contents); },
});
const steps = {};
const record = (name, config) => { steps[name] = { ...counts, colorTheme: config?.colorTheme ?? null }; };

const first = loadStoredConfig();
record('first', first);
first.colorTheme = 'mutated-by-caller';
record('second', loadStoredConfig());

writeFileSync(configPath, readFileSync(configPath, 'utf-8').replace('"activeSessionId"', '"colorTheme": "aaaa", "activeSessionId"'));
record('externalSizeChange', loadStoredConfig());

writeFileSync(configPath, readFileSync(configPath, 'utf-8').replace('"aaaa"', '"bbbb"'));
utimesSync(configPath, 1000000000, 1000000000);
record('externalMtimeChange', loadStoredConfig());

const toSave = loadStoredConfig();
toSave.colorTheme = 'cccc';
saveConfig(toSave);
record('afterOwnWrite', loadStoredConfig());

utimesSync(configPath, 1100000000, 1100000000);
record('pinnedMtime', loadStoredConfig());
const replacement = configPath + '.replacement';
writeFileSync(replacement, readFileSync(configPath, 'utf-8').replace('"cccc"', '"dddd"'));
utimesSync(replacement, 1100000000, 1100000000);
renameSync(replacement, configPath);
record('externalInodeChange', loadStoredConfig());

console.log(JSON.stringify(steps));
`

function setupConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'rox-config-cache-'))
  const workspaceRoot = join(configDir, 'workspaces', 'cache-ws')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({ id: 'ws-cache-1', name: 'Cache WS', slug: 'cache-ws', createdAt: 1, updatedAt: 1 }, null, 2),
    'utf-8',
  )
  const configPath = join(configDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaces: [
          { id: 'ws-cache-1', name: 'Cache WS', slug: 'cache-ws', rootPath: workspaceRoot, kind: 'personal', createdAt: 1 },
        ],
        activeWorkspaceId: 'ws-cache-1',
        activeSessionId: null,
        llmConnections: [],
        cloudRuns: { enabled: false, provider: 'local' },
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
  return { configDir, configPath }
}

describe('loadStoredConfig read cache', () => {
  it('skips read and parse while config.json is unchanged and picks up every change', () => {
    const { configDir, configPath } = setupConfigDir()
    try {
      const run = Bun.spawnSync([process.execPath, '--eval', SCENARIO], {
        env: {
          ...process.env,
          CRAFT_CONFIG_DIR: configDir,
          ROX_CONFIG_DIR: configDir,
          CACHE_TEST_CONFIG_PATH: configPath,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (run.exitCode !== 0) {
        throw new Error(run.stderr.toString() || `exit ${run.exitCode}`)
      }
      const steps = JSON.parse(run.stdout.toString().trim().split('\n').at(-1)!)

      expect(steps.first).toEqual({ reads: 1, parses: 1, colorTheme: null })
      expect(steps.second).toEqual({ reads: 1, parses: 1, colorTheme: null })
      expect(steps.externalSizeChange).toEqual({ reads: 2, parses: 2, colorTheme: 'aaaa' })
      expect(steps.externalMtimeChange).toEqual({ reads: 3, parses: 3, colorTheme: 'bbbb' })
      expect(steps.afterOwnWrite).toEqual({ reads: 3, parses: 3, colorTheme: 'cccc' })
      expect(steps.pinnedMtime).toEqual({ reads: 4, parses: 4, colorTheme: 'cccc' })
      expect(steps.externalInodeChange).toEqual({ reads: 5, parses: 5, colorTheme: 'dddd' })
      expect(JSON.parse(readFileSync(configPath, 'utf-8')).colorTheme).toBe('dddd')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
