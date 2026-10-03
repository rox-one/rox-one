import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveNumberedUserDataDir } from '../numbered-user-data'
import { IMPORT_LEGACY_INSTALL_COMMAND, buildRestartCommand, REMOTE_INSTALL_DIR } from '../ssh-tunnel/server-bootstrap'
import { remoteTokenCandidatePaths, remoteReadTokenCommand, extractToken } from '../ssh-tunnel/ssh-tunnel-manager'

function temporary(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'rox-paths-'))
  try { run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('ROX path migration', () => {
  it('copies a legacy remote installation without overwriting or deleting files', () => temporary(root => {
    const legacy = join(root, '.craft-agent/remote-server')
    const canonical = join(root, '.rox/remote-server')
    mkdirSync(legacy, { recursive: true }); mkdirSync(canonical, { recursive: true })
    writeFileSync(join(legacy, 'start.sh'), '#!/bin/sh\n', { mode: 0o755 })
    mkdirSync(join(legacy, 'config')); writeFileSync(join(legacy, 'config/settings'), 'settings')
    writeFileSync(join(legacy, 'conflict'), 'legacy'); writeFileSync(join(canonical, 'conflict'), 'rox')
    const result = spawnSync('/bin/sh', ['-c', IMPORT_LEGACY_INSTALL_COMMAND], { env: { ...process.env, HOME: root } })
    expect(result.status).toBe(0)
    expect(existsSync(join(canonical, 'start.sh'))).toBe(true)
    expect(readFileSync(join(canonical, 'config/settings'), 'utf8')).toBe('settings')
    expect(readFileSync(join(canonical, 'conflict'), 'utf8')).toBe('rox')
    expect(readFileSync(join(legacy, 'conflict'), 'utf8')).toBe('legacy')
    expect(existsSync(join(canonical, '.legacy-env-compat'))).toBe(true)
  }))
  it('fails with an actionable error if a legacy installation disappeared', () => temporary(root => {
    const result = spawnSync('/bin/sh', ['-c', IMPORT_LEGACY_INSTALL_COMMAND], { env: { ...process.env, HOME: root } })
    expect(result.status).not.toBe(0)
    expect(result.stderr.toString()).toContain('reinstall the managed ROX server')
    expect(existsSync(join(root, '.rox'))).toBe(false)
  }))
  it('uses ROX only for new launchers and shared canonical state for imported ones', () => {
    expect(REMOTE_INSTALL_DIR).toBe('~/.rox/remote-server')
    expect(buildRestartCommand(9200)).not.toContain('CRAFT_')
    const imported = buildRestartCommand(9200, true)
    expect(imported).toContain('ROX_CONFIG_DIR=~/.rox/remote-server/config')
    expect(imported).toContain('CRAFT_CONFIG_DIR=~/.rox/remote-server/config')
  })
  it('reads canonical tokens first with explicit legacy fallback and safely quoted overrides', () => {
    const candidates = remoteTokenCandidatePaths()
    expect(candidates[0]).toBe('~/.rox/remote-server/.token')
    expect(candidates[3]).toBe('~/.craft-agent/remote-server/.token')
    expect(remoteTokenCandidatePaths('/custom/token')).toEqual(['/custom/token'])
    expect(remoteReadTokenCommand('~/token; echo bad')).toBe('cat "$HOME"/\'token; echo bad\' 2>/dev/null || true')
    expect(extractToken('ROX_SERVER_TOKEN=canonical_token_1234')).toBe('canonical_token_1234')
    expect(extractToken('CRAFT_SERVER_TOKEN=legacy_token_123456')).toBe('legacy_token_123456')
    expect(extractToken('CRAFT_SERVER_TOKEN=legacy_token_123456\nROX_SERVER_TOKEN=canonical_token_1234')).toBe('canonical_token_1234')
  })
  it('imports numbered profile data, preserves conflicts and skips Chromium locks', () => temporary(root => {
    const legacy = join(root, 'craft-agent-2'); const canonical = join(root, 'rox-2')
    mkdirSync(legacy); mkdirSync(canonical)
    writeFileSync(join(legacy, 'new'), 'old data'); writeFileSync(join(legacy, 'conflict'), 'old')
    writeFileSync(join(canonical, 'conflict'), 'new'); writeFileSync(join(legacy, 'SingletonCookie'), 'lock')
    expect(resolveNumberedUserDataDir(root, '2')).toBe(canonical)
    expect(readFileSync(join(canonical, 'new'), 'utf8')).toBe('old data')
    expect(readFileSync(join(canonical, 'conflict'), 'utf8')).toBe('new')
    expect(existsSync(join(canonical, 'SingletonCookie'))).toBe(false)
    expect(existsSync(join(legacy, 'new'))).toBe(true)
    expect(() => resolveNumberedUserDataDir(root, '../x')).toThrow('digits only')
  }))
  it('does not copy a profile held by a live legacy instance', () => temporary(root => {
    const legacy = join(root, 'craft-agent-3'); mkdirSync(legacy)
    symlinkSync(`localhost-${process.pid}`, join(legacy, 'SingletonLock'))
    expect(() => resolveNumberedUserDataDir(root, '3')).toThrow('Close legacy numbered')
    expect(existsSync(join(root, 'rox-3'))).toBe(false)
  }))
})
