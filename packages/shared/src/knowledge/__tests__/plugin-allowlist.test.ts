import { afterEach, describe, expect, it } from 'bun:test'
import { filterBazaarPackages, OEM_PLUGIN_ALLOWLIST } from '../plugin-allowlist'

describe('OEM_PLUGIN_ALLOWLIST', () => {
  it('starts empty so marketplace installs are denied', () => {
    expect(OEM_PLUGIN_ALLOWLIST).toEqual([])
  })
})

describe('filterBazaarPackages', () => {
  afterEach(() => {
    OEM_PLUGIN_ALLOWLIST.length = 0
  })

  it('drops every package when the allowlist is empty', () => {
    const packages = [
      { name: 'siyuan-plugin-calendar' },
      { name: 'siyuan-plugin-markdown' },
    ]
    expect(filterBazaarPackages(packages)).toEqual([])
  })

  it('keeps only names on the allowlist and preserves extra fields', () => {
    OEM_PLUGIN_ALLOWLIST.push('siyuan-plugin-calendar')
    const packages = [
      { name: 'siyuan-plugin-calendar', version: '1.0.0' },
      { name: 'siyuan-plugin-markdown', version: '2.0.0' },
      { name: 'other', version: '0.1.0' },
    ]
    expect(filterBazaarPackages(packages)).toEqual([
      { name: 'siyuan-plugin-calendar', version: '1.0.0' },
    ])
  })

  it('never installs names outside the list', () => {
    OEM_PLUGIN_ALLOWLIST.push('allowed-a', 'allowed-b')
    const filtered = filterBazaarPackages([
      { name: 'allowed-b' },
      { name: 'not-allowed' },
      { name: 'allowed-a' },
      { name: 'also-not-allowed' },
    ])
    expect(filtered.map((p) => p.name)).toEqual(['allowed-b', 'allowed-a'])
    expect(filtered.every((p) => OEM_PLUGIN_ALLOWLIST.includes(p.name))).toBe(true)
  })
})
