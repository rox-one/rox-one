import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

const DEFAULT_POLICY = {
  enabled: true,
  autoCreate: 'off',
  autoImprove: 'candidate',
  minEvidence: 3,
  minConfidence: 0.85,
  requireVerification: true,
} as const

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

// getSkillsLearningPolicy() reads the on-disk config.json, and the config dir is
// captured at module load — so each scenario runs in a subprocess against a fresh
// temp config dir (same pattern as memory-config.test.ts).
function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `import { getSkillsLearningPolicy, getSkillsLearningPolicyForWorkspace } from '${STORAGE_MODULE_PATH}'; ${code}`,
    ],
    {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir, ROX_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim()
}

function setupConfigDir(skills?: unknown): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-skills-learning-'))
  tempDirs.push(configDir)
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
        activeWorkspaceId: 'ws-1',
        activeSessionId: null,
        llmConnections: [],
        ...(skills !== undefined ? { skills } : {}),
      },
      null,
      2,
    ),
    'utf-8',
  )
  return configDir
}

/** Fresh temp dir with no config.json at all. */
function setupEmptyConfigDir(): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-skills-learning-empty-'))
  tempDirs.push(configDir)
  return configDir
}

function readPolicy(configDir: string): Record<string, unknown> {
  return JSON.parse(runEval(configDir, 'console.log(JSON.stringify(getSkillsLearningPolicy()))'))
}

describe('getSkillsLearningPolicy (PRD §42/§43)', () => {
  it('falls back to the defaults when config.json is absent', () => {
    expect(readPolicy(setupEmptyConfigDir())).toEqual(DEFAULT_POLICY)
  })

  it('falls back to the defaults when the skills block is absent or empty', () => {
    expect(readPolicy(setupConfigDir())).toEqual(DEFAULT_POLICY)
    expect(readPolicy(setupConfigDir({}))).toEqual(DEFAULT_POLICY)
  })

  it('migrates the legacy autoCreateFromSessions=false to autoCreate "off"', () => {
    expect(readPolicy(setupConfigDir({ autoCreateFromSessions: false }))).toEqual(DEFAULT_POLICY)
  })

  it('migrates the legacy autoCreateFromSessions=true to autoCreate "candidate"', () => {
    expect(readPolicy(setupConfigDir({ autoCreateFromSessions: true }))).toEqual({
      ...DEFAULT_POLICY,
      autoCreate: 'candidate',
    })
  })

  it('an explicit learning block wins over the legacy boolean entirely', () => {
    expect(
      readPolicy(setupConfigDir({ autoCreateFromSessions: true, learning: { autoCreate: 'autonomous' } })),
    ).toEqual({ ...DEFAULT_POLICY, autoCreate: 'autonomous' })
    expect(
      readPolicy(setupConfigDir({ autoCreateFromSessions: false, learning: { autoCreate: 'candidate' } })),
    ).toEqual({ ...DEFAULT_POLICY, autoCreate: 'candidate' })
    // Even an empty explicit object wins: the legacy true must not leak through.
    expect(readPolicy(setupConfigDir({ autoCreateFromSessions: true, learning: {} }))).toEqual(DEFAULT_POLICY)
  })

  it('merges valid learning fields over the defaults', () => {
    expect(
      readPolicy(
        setupConfigDir({
          learning: {
            enabled: false,
            autoCreate: 'autonomous',
            autoImprove: 'off',
            minEvidence: 7,
            minConfidence: 0.5,
            requireVerification: false,
          },
        }),
      ),
    ).toEqual({
      enabled: false,
      autoCreate: 'autonomous',
      autoImprove: 'off',
      minEvidence: 7,
      minConfidence: 0.5,
      requireVerification: false,
    })
  })

  it('rejects invalid values and falls back field-by-field', () => {
    const policy = readPolicy(
      setupConfigDir({ learning: { autoCreate: 'sometimes', autoImprove: 'whenever', minEvidence: '3', minConfidence: 2 } }),
    )
    expect(policy).toEqual(DEFAULT_POLICY)
  })

  it('treats defined non-boolean flags as false (repo === true convention)', () => {
    expect(readPolicy(setupConfigDir({ learning: { enabled: 1 } })).enabled).toBe(false)
    expect(readPolicy(setupConfigDir({ learning: { requireVerification: 'yes' } })).requireVerification).toBe(false)
  })

  it('rejects minEvidence outside 1..20 and non-integers', () => {
    expect(readPolicy(setupConfigDir({ learning: { minEvidence: 0 } })).minEvidence).toBe(3)
    expect(readPolicy(setupConfigDir({ learning: { minEvidence: -1 } })).minEvidence).toBe(3)
    expect(readPolicy(setupConfigDir({ learning: { minEvidence: 21 } })).minEvidence).toBe(3)
    expect(readPolicy(setupConfigDir({ learning: { minEvidence: 3.5 } })).minEvidence).toBe(3)
  })

  it('accepts minEvidence/minConfidence boundary values', () => {
    expect(readPolicy(setupConfigDir({ learning: { minEvidence: 1, minConfidence: 0 } }))).toEqual({
      ...DEFAULT_POLICY,
      minEvidence: 1,
      minConfidence: 0,
    })
    expect(readPolicy(setupConfigDir({ learning: { minEvidence: 20, minConfidence: 1 } }))).toEqual({
      ...DEFAULT_POLICY,
      minEvidence: 20,
      minConfidence: 1,
    })
  })

  it('rejects out-of-range minConfidence', () => {
    expect(readPolicy(setupConfigDir({ learning: { minConfidence: -0.1 } })).minConfidence).toBe(0.85)
    expect(readPolicy(setupConfigDir({ learning: { minConfidence: 1.5 } })).minConfidence).toBe(0.85)
  })

  it('a non-object learning block falls back to the legacy migration', () => {
    expect(readPolicy(setupConfigDir({ autoCreateFromSessions: true, learning: 'yes' }))).toEqual({
      ...DEFAULT_POLICY,
      autoCreate: 'candidate',
    })
  })

  it('getSkillsLearningPolicyForWorkspace resolves identically to the global policy', () => {
    const out = runEval(
      setupConfigDir({ learning: { autoCreate: 'autonomous' } }),
      'console.log(JSON.stringify([getSkillsLearningPolicy(), getSkillsLearningPolicyForWorkspace("/tmp/ws")]))',
    )
    const [globalPolicy, workspacePolicy] = JSON.parse(out)
    expect(workspacePolicy).toEqual(globalPolicy)
    expect(workspacePolicy).toEqual({ ...DEFAULT_POLICY, autoCreate: 'autonomous' })
  })
})