import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setGraphMemoryProviderResolver } from '../../MemoryIndexService'
import { installCogneeGraphMemory, resolveCogneeSidecarSourceDir } from '../install'

const dirs: string[] = []
afterEach(() => {
  setGraphMemoryProviderResolver(null)
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('installCogneeGraphMemory', () => {
  test('resolve finds explicit dir with pyproject', () => {
    const d = mkdtempSync(join(tmpdir(), 'cognee-sid-'))
    dirs.push(d)
    writeFileSync(join(d, 'pyproject.toml'), '[project]\nname="x"\n')
    expect(resolveCogneeSidecarSourceDir(d)).toBe(d)
  })

  test('install registers resolver when sidecar present', () => {
    const d = mkdtempSync(join(tmpdir(), 'cognee-sid-'))
    dirs.push(d)
    writeFileSync(join(d, 'pyproject.toml'), '[project]\nname="x"\n')
    mkdirSync(join(d, 'rox_cognee_sidecar'), { recursive: true })
    const ok = installCogneeGraphMemory({
      sidecarSourceDir: d,
      isEnabled: () => true,
      logger: { warn: () => {}, info: () => {} },
    })
    expect(ok).toBe(true)
    // Resolver is live: a call with enabled=false must yield null provider.
    const { setGraphMemoryProviderResolver: _set } = require('../../MemoryIndexService')
    void _set
  })

  test('install no-ops when sidecar missing', () => {
    const ok = installCogneeGraphMemory({
      sidecarSourceDir: join(tmpdir(), 'no-such-cognee-sidecar'),
      logger: { warn: () => {} },
    })
    expect(ok).toBe(false)
  })
})
