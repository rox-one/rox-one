import { describe, it, expect } from 'bun:test'
import {
  permissionModeI18nKey,
  statusBarRuntimeKind,
  statusBarTransportKind,
} from '../status-bar-model'

describe('statusBarTransportKind', () => {
  it('treats local and missing state as ready-local', () => {
    expect(statusBarTransportKind(null)).toBe('local')
    expect(statusBarTransportKind({ mode: 'local', status: 'idle' })).toBe('local')
  })

  it('shows connected remotes and hides intervening failures', () => {
    expect(statusBarTransportKind({ mode: 'remote', status: 'connected' })).toBe('connected')
    expect(statusBarTransportKind({ mode: 'remote', status: 'failed' })).toBe('hidden')
    expect(statusBarTransportKind({ mode: 'remote', status: 'reconnecting' })).toBe('hidden')
  })
})

describe('statusBarRuntimeKind', () => {
  it('surfaces ready/outdated and hides download/error phases', () => {
    expect(statusBarRuntimeKind({ phase: 'ready' })).toBe('ready')
    expect(statusBarRuntimeKind({ phase: 'outdated' })).toBe('ready')
    expect(statusBarRuntimeKind({ phase: 'downloading' })).toBe('hidden')
    expect(statusBarRuntimeKind({ phase: 'error' })).toBe('hidden')
    expect(statusBarRuntimeKind(undefined)).toBe('hidden')
  })
})

describe('permissionModeI18nKey', () => {
  it('maps every permission mode to an existing mode.* key', () => {
    expect(permissionModeI18nKey('safe')).toBe('mode.safe')
    expect(permissionModeI18nKey('ask')).toBe('mode.ask')
    expect(permissionModeI18nKey('allow-all')).toBe('mode.allow-all')
  })
})
