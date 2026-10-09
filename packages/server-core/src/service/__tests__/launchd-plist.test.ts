import { describe, expect, it } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildLaunchAgentFiles,
  buildServiceEnvFile,
  buildServiceWrapper,
  SERVICE_ENV_FILE_MODE,
  SERVICE_WRAPPER_MODE,
  sha256Hex,
} from '../launchd-plist.ts'

const baseInput = {
  label: 'com.rox.service',
  executable: '/Applications/Rox.app/Contents/MacOS/Rox',
  args: ['--service'],
  environment: { ROX_CONFIG_DIR: '/Users/x/rox', ROX_SERVICE_MANAGED: '1', CRAFT_SERVER_TOKEN: "a'b" },
  serviceDirectory: '/Users/x/rox/service',
  launchAgentsDirectory: '/Users/x/Library/LaunchAgents',
  workingDirectory: '/Users/x/rox',
  logDirectory: '/Users/x/rox/logs',
}

describe('launchd plist/env/wrapper builder', () => {
  it('writes a deterministic 0600 env file with single-quoted values and SHA-256', () => {
    const content = buildServiceEnvFile({ B: '2', A: "a'b" })
    expect(content).toBe(
      '# ROX managed service environment (mode 0600). Generated; do not edit.\n'
      + "A='a'\\''b'\n"
      + "B='2'\n",
    )
    expect(sha256Hex(content)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('emits the exact plist bytes with a fixed key order and the wrapper as the program', () => {
    const files = buildLaunchAgentFiles(baseInput)
    expect(files.plistPath).toBe('/Users/x/Library/LaunchAgents/com.rox.service.plist')
    expect(files.envFile.path).toBe('/Users/x/rox/service/service.env')
    expect(files.wrapper.path).toBe('/Users/x/rox/service/service-wrapper.sh')
    expect(files.envFile.mode).toBe(SERVICE_ENV_FILE_MODE)
    expect(files.wrapper.mode).toBe(SERVICE_WRAPPER_MODE)
    expect(files.plist).toBe([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      '  <string>com.rox.service</string>',
      '  <key>ProgramArguments</key>',
      '  <array>',
      '    <string>/Users/x/rox/service/service-wrapper.sh</string>',
      '  </array>',
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <true/>',
      '  <key>ThrottleInterval</key>',
      '  <integer>10</integer>',
      '  <key>WorkingDirectory</key>',
      '  <string>/Users/x/rox</string>',
      '  <key>StandardOutPath</key>',
      '  <string>/Users/x/rox/logs/com.rox.service.out.log</string>',
      '  <key>StandardErrorPath</key>',
      '  <string>/Users/x/rox/logs/com.rox.service.err.log</string>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n'))
  })

  it('keeps secrets out of the world-readable plist and pins the env digest in the wrapper', () => {
    const files = buildLaunchAgentFiles(baseInput)
    expect(files.plist).not.toContain('a\'b')
    expect(files.plist).not.toContain('CRAFT_SERVER_TOKEN')
    expect(files.envFile.content).toContain("CRAFT_SERVER_TOKEN='a'\\''b'")
    expect(files.wrapper.content).toContain(`EXPECTED_SHA256='${sha256Hex(files.envFile.content)}'`)
    expect(files.wrapper.content).toContain('#!/bin/sh')
    expect(files.wrapper.content).toContain('exit 78')
    expect(files.wrapper.content).toContain('exec \'/Applications/Rox.app/Contents/MacOS/Rox\' \'--service\'')
  })

  it('rejects a relative executable or label that could escape the launchd target', () => {
    expect(() => buildLaunchAgentFiles({ ...baseInput, executable: 'bin/rox' })).toThrow('INVALID_DEFINITION')
    expect(() => buildLaunchAgentFiles({ ...baseInput, label: '../evil' })).toThrow('INVALID_DEFINITION')
  })

  it('runs the real wrapper: untampered env execs the target, tampered/missing env exits 78', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'rox-service-wrapper-'))
    try {
      const target = join(dir, 'target.sh')
      const marker = join(dir, 'marker.txt')
      await writeFile(target, `#!/bin/sh\necho "$ROX_SERVICE_MANAGED" > '${marker}'\n`, 'utf8')
      await chmod(target, 0o700)

      const envContent = buildServiceEnvFile({ ROX_SERVICE_MANAGED: '1' })
      const envPath = join(dir, 'service.env')
      await writeFile(envPath, envContent, 'utf8')
      await chmod(envPath, 0o600)
      const wrapperPath = join(dir, 'wrapper.sh')
      await writeFile(wrapperPath, buildServiceWrapper({
        envFilePath: envPath,
        envSha256: sha256Hex(envContent),
        executable: target,
        args: [],
      }), 'utf8')
      await chmod(wrapperPath, 0o700)

      const ok = spawnSync('/bin/sh', [wrapperPath], { encoding: 'utf8' })
      expect(ok.status).toBe(0)
      expect((await readFile(marker, 'utf8')).trim()).toBe('1')

      await writeFile(envPath, buildServiceEnvFile({ ROX_SERVICE_MANAGED: '0' }), 'utf8')
      const tampered = spawnSync('/bin/sh', [wrapperPath], { encoding: 'utf8' })
      expect(tampered.status).toBe(78)
      expect(tampered.stderr).toContain('integrity check failed')

      await rm(envPath)
      const missing = spawnSync('/bin/sh', [wrapperPath], { encoding: 'utf8' })
      expect(missing.status).toBe(78)
      expect(missing.stderr).toContain('environment file missing')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})