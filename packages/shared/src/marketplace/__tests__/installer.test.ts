import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { marketplacePaths, type MarketplaceEntry, type MarketplaceFetch } from '../catalog.ts'
import { INSTALL_MARKER_NAME, readLock, readInstallMarker, writeInstallMarker, writeLock } from '../lock.ts'
import { installEntry, removeEntry, sha256Directory, sha256FileContent, type ExecFileFn } from '../installer.ts'

const REF = 'd'.repeat(40)

const DOC_ENTRY: MarketplaceEntry = {
  id: 'soul-pack',
  kind: 'context-doc',
  title: 'Soul Pack',
  descriptionRu: 'Тестовый документ',
  source: { type: 'github', repo: 'owner/docs', ref: REF },
  documents: [{ repoPath: 'AGENTS.md', targetName: 'agents.md' }],
}

const docFetch: MarketplaceFetch = async (url) => {
  if (!url.includes(`/${REF}/`)) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' }
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => '# Agent Doc' }
}

let home: string
let configDir: string
let skillsDir: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'craft-marketplace-install-'))
  configDir = join(home, '.craft')
  skillsDir = join(home, '.agents', 'skills')
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('installEntry (context-doc)', () => {
  it('installs documents atomically and records provenance', async () => {
    const result = await installEntry(DOC_ENTRY, { configDir, fetchFn: docFetch, now: () => 777 })
    expect(result).toEqual({
      id: 'soul-pack',
      kind: 'context-doc',
      status: 'installed',
      ref: REF,
      targets: [join(configDir, 'context', 'agents.md')],
    })

    const target = join(configDir, 'context', 'agents.md')
    expect(readFileSync(target, 'utf8')).toBe('# Agent Doc')
    // Provenance marker beside the .md file + aggregate lock record
    expect(readInstallMarker(target)?.ref).toBe(REF)
    const rec = readLock(marketplacePaths(configDir).lockFile).entries['soul-pack']
    expect(rec?.status).toBe('installed')
    expect(rec?.installedAt).toBe(777)
    expect(rec?.targets).toEqual([target])
  })

  it('fails closed when the download 404s (no lock record, no file)', async () => {
    const badFetch: MarketplaceFetch = async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => '',
    })
    await expect(installEntry(DOC_ENTRY, { configDir, fetchFn: badFetch })).rejects.toThrow('404')
    expect(readLock(marketplacePaths(configDir).lockFile).entries['soul-pack']).toBeUndefined()
    expect(existsSync(join(configDir, 'context', 'agents.md'))).toBe(false)
  })

  it('keeps a pre-existing unowned context doc (e.g. user soul.md) instead of overwriting', async () => {
    const soulEntry: MarketplaceEntry = {
      id: 'soul-pack',
      kind: 'context-doc',
      title: 'Soul Pack',
      descriptionRu: 'soul',
      source: { type: 'github', repo: 'owner/docs', ref: REF },
      documents: [{ repoPath: 'SOUL.md', targetName: 'soul.md' }],
    }
    const contextDir = join(configDir, 'context')
    mkdirSync(contextDir, { recursive: true })
    const target = join(contextDir, 'soul.md')
    writeFileSync(target, '# USER soul — must survive')

    await expect(installEntry(soulEntry, { configDir, fetchFn: docFetch })).rejects.toThrow(/unowned|no writable/)
    expect(readFileSync(target, 'utf8')).toBe('# USER soul — must survive')
    expect(readLock(marketplacePaths(configDir).lockFile).entries['soul-pack']).toBeUndefined()
    expect(readInstallMarker(target)).toBeNull()
  })

  it('reinstalls our own context-doc target (marker owner matches entry id)', async () => {
    await installEntry(DOC_ENTRY, { configDir, fetchFn: docFetch, now: () => 1 })
    const target = join(configDir, 'context', 'agents.md')
    expect(readFileSync(target, 'utf8')).toBe('# Agent Doc')

    const newerFetch: MarketplaceFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '# Agent Doc v2',
    })
    const result = await installEntry(DOC_ENTRY, { configDir, fetchFn: newerFetch, now: () => 2 })
    expect(result.status).toBe('installed')
    expect(readFileSync(target, 'utf8')).toBe('# Agent Doc v2')
    expect(readInstallMarker(target)?.id).toBe('soul-pack')
  })

  it('keeps locally-modified owned context-doc on reinstall/update', async () => {
    await installEntry(DOC_ENTRY, { configDir, fetchFn: docFetch, now: () => 1 })
    const target = join(configDir, 'context', 'agents.md')
    writeFileSync(target, '# USER edited agents.md')

    const newerFetch: MarketplaceFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '# Agent Doc v2 would overwrite',
    })
    const result = await installEntry(DOC_ENTRY, { configDir, fetchFn: newerFetch, now: () => 2 })
    const asDoc = result as { collisions?: string[]; targets: string[] }
    expect(readFileSync(target, 'utf8')).toBe('# USER edited agents.md')
    expect(asDoc.collisions?.some((c) => c.includes('locally-modified'))).toBe(true)
    expect(asDoc.targets).toEqual([target])
  })

  it('fails closed when expectedContentSha256 pin mismatches (no lock, no file)', async () => {
    const pinned: MarketplaceEntry = {
      ...DOC_ENTRY,
      expectedContentSha256: { 'agents.md': '0'.repeat(64) },
    }
    await expect(installEntry(pinned, { configDir, fetchFn: docFetch })).rejects.toThrow(/content sha256 mismatch/)
    expect(existsSync(join(configDir, 'context', 'agents.md'))).toBe(false)
    expect(readLock(marketplacePaths(configDir).lockFile).entries['soul-pack']).toBeUndefined()
  })

  it('succeeds when expectedContentSha256 pin matches document body', async () => {
    const body = '# Agent Doc'
    const pinned: MarketplaceEntry = {
      ...DOC_ENTRY,
      expectedContentSha256: { 'agents.md': sha256FileContent(body) },
    }
    const result = await installEntry(pinned, { configDir, fetchFn: docFetch })
    expect(result.status).toBe('installed')
    expect(readFileSync(join(configDir, 'context', 'agents.md'), 'utf8')).toBe(body)
    expect(readLock(marketplacePaths(configDir).lockFile).entries['soul-pack']?.status).toBe('installed')
  })
  it('rolls back replaced context documents and provenance when a later pin fails', async () => {
    const entry: MarketplaceEntry = {
      ...DOC_ENTRY,
      documents: [
        { repoPath: 'A.md', targetName: 'a.md' },
        { repoPath: 'B.md', targetName: 'b.md' },
      ],
    }
    const fetchVersion = (version: string): MarketplaceFetch => async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => (url.endsWith('/A.md') ? `# A ${version}` : `# B ${version}`),
    })
    await installEntry(entry, { configDir, fetchFn: fetchVersion('v1') })
    const a = join(configDir, 'context', 'a.md')
    const b = join(configDir, 'context', 'b.md')
    const previousLock = readLock(marketplacePaths(configDir).lockFile).entries[entry.id]

    await expect(
      installEntry(
        {
          ...entry,
          expectedContentSha256: {
            'a.md': sha256FileContent('# A v2'),
            'b.md': '0'.repeat(64),
          },
        },
        { configDir, fetchFn: fetchVersion('v2') },
      ),
    ).rejects.toThrow(/content sha256 mismatch/)

    expect(readFileSync(a, 'utf8')).toBe('# A v1')
    expect(readFileSync(b, 'utf8')).toBe('# B v1')
    expect(readInstallMarker(a)?.ref).toBe(REF)
    expect(readLock(marketplacePaths(configDir).lockFile).entries[entry.id]).toEqual(previousLock)
  })

})

describe('removeEntry (soft-clean)', () => {
  it('removes owned artifacts; reports not-installed for unknown ids', async () => {
    await installEntry(DOC_ENTRY, { configDir, fetchFn: docFetch })
    const result = removeEntry('soul-pack', { configDir })
    expect(result.status).toBe('removed')
    expect(result.removed).toEqual([join(configDir, 'context', 'agents.md')])
    expect(existsSync(join(configDir, 'context', 'agents.md'))).toBe(false)
    expect(readInstallMarker(join(configDir, 'context', 'agents.md'))).toBeNull()
    expect(readLock(marketplacePaths(configDir).lockFile).entries).toEqual({})

    expect(removeEntry('soul-pack', { configDir }).status).toBe('not-installed')
  })

  it('keeps locally-modified targets instead of deleting user edits', async () => {
    await installEntry(DOC_ENTRY, { configDir, fetchFn: docFetch })
    const target = join(configDir, 'context', 'agents.md')
    writeFileSync(target, '# Locally edited')

    const result = removeEntry('soul-pack', { configDir })
    expect(result.status).toBe('partial')
    expect(result.kept).toEqual([{ path: target, reason: 'locally-modified' }])
    expect(readFileSync(target, 'utf8')).toBe('# Locally edited')
    expect(readLock(marketplacePaths(configDir).lockFile).entries).toEqual({})
  })

  it('keeps targets when contentSha256 is missing (fail-closed)', async () => {
    await installEntry(DOC_ENTRY, { configDir, fetchFn: docFetch })
    const lockPath = marketplacePaths(configDir).lockFile
    const lock = readLock(lockPath)
    const rec = lock.entries['soul-pack']!
    delete rec.contentSha256
    writeLock(lockPath, lock)

    const target = join(configDir, 'context', 'agents.md')
    writeFileSync(target, '# still here')
    const result = removeEntry('soul-pack', { configDir })
    expect(result.status).toBe('partial')
    expect(result.kept.some((k) => k.path === target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('# still here')
  })
})

describe('installEntry (skillpack, directory mode)', () => {
  const PACK_ENTRY: MarketplaceEntry = {
    id: 'mega-pack',
    kind: 'skillpack',
    title: 'Mega Pack',
    descriptionRu: 'Тестовый пакет скиллов',
    source: { type: 'github', repo: 'owner/pack', ref: REF },
    installMode: 'directory',
  }

  /** Fake git: synthesizes the repo contents at FETCH_HEAD checkout time. */
  const fakeGit: ExecFileFn = async (_file, args, options) => {
    if (args.includes('checkout')) {
      writeFileSync(join(options.cwd!, 'SKILL.md'), '# Mega Skill')
      mkdirSync(join(options.cwd!, 'docs'), { recursive: true })
      writeFileSync(join(options.cwd!, 'docs', 'GUIDE.md'), 'guide')
    }
    return { stdout: args[0] === 'rev-parse' ? `${REF}\n` : '', stderr: '' }
  }

  it('clones pinned, verifies HEAD, installs the whole repo as one skill dir', async () => {
    const result = await installEntry(PACK_ENTRY, { configDir, skillsDir, execFileFn: fakeGit })
    expect(result).toEqual({
      id: 'mega-pack',
      kind: 'skillpack',
      status: 'installed',
      ref: REF,
      skills: ['mega-pack'],
      targets: [join(skillsDir, 'mega-pack')],
    })

    const target = join(skillsDir, 'mega-pack')
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('# Mega Skill')
    expect(readFileSync(join(target, 'docs', 'GUIDE.md'), 'utf8')).toBe('guide')
    expect(existsSync(join(target, INSTALL_MARKER_NAME))).toBe(true)
    expect(readLock(marketplacePaths(configDir).lockFile).entries['mega-pack']?.status).toBe('installed')
    // staging area cleaned up (no leftover clone-*/stage-* dirs)
    const tmpDir = marketplacePaths(configDir).tmpDir
    expect(existsSync(tmpDir) ? readdirSync(tmpDir) : []).toEqual([])
  })

  it('rejects a HEAD that does not match the pinned ref', async () => {
    const wrongHead: ExecFileFn = async (_file, args, options) => {
      if (args.includes('checkout')) writeFileSync(join(options.cwd!, 'SKILL.md'), '# x')
      return { stdout: args[0] === 'rev-parse' ? `${'e'.repeat(40)}\n` : '', stderr: '' }
    }
    await expect(installEntry(PACK_ENTRY, { configDir, skillsDir, execFileFn: wrongHead })).rejects.toThrow('ref mismatch')
    expect(existsSync(join(skillsDir, 'mega-pack'))).toBe(false)
    expect(readLock(marketplacePaths(configDir).lockFile).entries).toEqual({})
  })

  it('installs a directory pack under a qualified name when another pack owns its name', async () => {
    // Пред-существующий пакет «foreign-pack» уже владеет директорией mega-pack.
    const target = join(skillsDir, 'mega-pack')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# FOREIGN content')
    writeInstallMarker(target, {
      id: 'foreign-pack',
      kind: 'skillpack',
      repo: 'owner/foreign',
      ref: REF,
      installedAt: Date.now(),
      status: 'installed',
      targets: [target],
      skills: ['mega-pack'],
      contentSha256: {},
    })

    const result = await installEntry(PACK_ENTRY, { configDir, skillsDir, execFileFn: fakeGit })
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('# FOREIGN content')
    expect(result.kind === 'skillpack' && result.targets).toEqual([join(skillsDir, 'mega-pack--mega-pack')])
    expect(readFileSync(join(skillsDir, 'mega-pack--mega-pack', 'SKILL.md'), 'utf8')).toBe('# Mega Skill')
  })
})

describe('installEntry (skillpack content pin)', () => {
  const PACK_ENTRY: MarketplaceEntry = {
    id: 'mega-pack',
    kind: 'skillpack',
    title: 'Mega Pack',
    descriptionRu: 'Тестовый пакет скиллов',
    source: { type: 'github', repo: 'owner/pack', ref: REF },
    installMode: 'directory',
  }

  const fakeGit: ExecFileFn = async (_file, args, options) => {
    if (args.includes('checkout')) {
      writeFileSync(join(options.cwd!, 'SKILL.md'), '# Mega Skill')
      mkdirSync(join(options.cwd!, 'docs'), { recursive: true })
      writeFileSync(join(options.cwd!, 'docs', 'GUIDE.md'), 'guide')
    }
    return { stdout: args[0] === 'rev-parse' ? `${REF}\n` : '', stderr: '' }
  }

  it('fails closed when expectedContentSha256 pin mismatches (no lock, no target)', async () => {
    const pinned: MarketplaceEntry = {
      ...PACK_ENTRY,
      expectedContentSha256: { 'mega-pack': 'f'.repeat(64) },
    }
    await expect(installEntry(pinned, { configDir, skillsDir, execFileFn: fakeGit })).rejects.toThrow(
      /content sha256 mismatch/,
    )
    expect(existsSync(join(skillsDir, 'mega-pack'))).toBe(false)
    expect(readLock(marketplacePaths(configDir).lockFile).entries['mega-pack']).toBeUndefined()
  })

  it('succeeds when expectedContentSha256 pin matches installed directory', async () => {
    // First install without pin to discover the content hash of this fake tree.
    await installEntry(PACK_ENTRY, { configDir, skillsDir, execFileFn: fakeGit })
    const target = join(skillsDir, 'mega-pack')
    const pin = sha256Directory(target)
    removeEntry('mega-pack', { configDir })

    const pinned: MarketplaceEntry = {
      ...PACK_ENTRY,
      expectedContentSha256: { 'mega-pack': pin },
    }
    const result = await installEntry(pinned, { configDir, skillsDir, execFileFn: fakeGit })
    expect(result.status).toBe('installed')
    expect(existsSync(join(skillsDir, 'mega-pack', 'SKILL.md'))).toBe(true)
    expect(readLock(marketplacePaths(configDir).lockFile).entries['mega-pack']?.status).toBe('installed')
    expect(readLock(marketplacePaths(configDir).lockFile).entries['mega-pack']?.contentSha256?.[target]).toBe(pin)
  })
})

describe('cross-pack name collisions (skills mode)', () => {
  const makeEntry = (id: string): MarketplaceEntry => ({
    id,
    kind: 'skillpack',
    title: id,
    descriptionRu: id,
    source: { type: 'github', repo: 'owner/' + id, ref: REF },
  })

  const packGit: ExecFileFn = async (_file, args, options) => {
    if (args.includes('checkout')) {
      mkdirSync(join(options.cwd!, 'review'), { recursive: true })
      writeFileSync(join(options.cwd!, 'review', 'SKILL.md'), '# pack review')
    }
    return { stdout: args[0] === 'rev-parse' ? `${REF}\n` : '', stderr: '' }
  }

  it('namespaces the colliding skill from the second pack without touching the first', async () => {
    const a = await installEntry(makeEntry('pack-a'), { configDir, skillsDir, execFileFn: packGit })
    expect(a.status).toBe('installed')
    expect(existsSync(join(skillsDir, 'review', 'SKILL.md'))).toBe(true)

    const b = await installEntry(makeEntry('pack-b'), { configDir, skillsDir, execFileFn: packGit })
    const bAsSkill = b as { collisions?: string[]; skills: string[]; targets: string[] }
    // Первый пакет цел, второй получил namespaced-имя:
    expect(existsSync(join(skillsDir, 'review', 'SKILL.md'))).toBe(true)
    expect(bAsSkill.skills).toEqual(['pack-b--review'])
    expect(bAsSkill.targets).toEqual([join(skillsDir, 'pack-b--review')])
    expect(bAsSkill.collisions?.some((c) => c.includes('renamed to pack-b--review'))).toBe(true)
    // И в registry обе цели видных у pack-b:
    const recB = readLock(marketplacePaths(configDir).lockFile).entries['pack-b']
    expect(recB?.targets).toEqual([join(skillsDir, 'pack-b--review')])
    // marker в новой директории — pack-b:
    expect(readInstallMarker(join(skillsDir, 'pack-b--review'))?.id).toBe('pack-b')
  })

  it('module mutex serializes direct installs of the same entry id', async () => {
    const [r1, r2] = await Promise.all([
      installEntry(makeEntry('mutex-pack'), { configDir, skillsDir, execFileFn: packGit }),
      installEntry(makeEntry('mutex-pack'), { configDir, skillsDir, execFileFn: packGit }),
    ])
    expect(r1.status).toBe('installed')
    expect(r2.status).toBe('installed')
    // конечный registry-вид консистентен: одна запись, одна цель:
    const entries = readLock(marketplacePaths(configDir).lockFile).entries
    expect(Object.keys(entries)).toEqual(['mutex-pack'])
    expect(entries['mutex-pack']?.targets).toEqual([join(skillsDir, 'review')])
  })
})

describe('installEntry (unowned target guard)', () => {
  const GUARD_ENTRY: MarketplaceEntry = {
    id: 'guard-pack',
    kind: 'skillpack',
    title: 'Guard Pack',
    descriptionRu: 'Пак со скиллами, один из которых конфликтует с юзерским',
    source: { type: 'github', repo: 'owner/guard', ref: REF },
  }

  const guardGit: ExecFileFn = async (_file, args, options) => {
    if (args.includes('checkout')) {
      mkdirSync(join(options.cwd!, 'review'), { recursive: true })
      writeFileSync(join(options.cwd!, 'review', 'SKILL.md'), '# Pack Review')
      mkdirSync(join(options.cwd!, 'deploy'), { recursive: true })
      writeFileSync(join(options.cwd!, 'deploy', 'SKILL.md'), '# Pack Deploy')
    }
    return { stdout: args[0] === 'rev-parse' ? `${REF}\n` : '', stderr: '' }
  }

  it('keeps a pre-existing unowned skill dir instead of overwriting it', async () => {
    const userSkill = join(skillsDir, 'review')
    mkdirSync(userSkill, { recursive: true })
    writeFileSync(join(userSkill, 'SKILL.md'), '# USER content — must survive')

    const result = await installEntry(GUARD_ENTRY, { configDir, skillsDir, execFileFn: guardGit })
    const skillResult = result as { collisions?: string[]; skills: string[] }

    // Юзерская директория не тронута и в collision-списке:
    expect(readFileSync(join(userSkill, 'SKILL.md'), 'utf8')).toBe('# USER content — must survive')
    expect(skillResult.collisions?.some((c) => c.includes(userSkill))).toBe(true)
    // Both skills install, and the user's original name remains intact.
    expect(skillResult.skills).toEqual(['deploy', 'guard-pack--review'])
    expect(readFileSync(join(skillsDir, 'guard-pack--review', 'SKILL.md'), 'utf8')).toBe('# Pack Review')
    expect(existsSync(join(skillsDir, 'deploy', 'SKILL.md'))).toBe(true)
    // В lock попала только наша цель:
    const record = readLock(marketplacePaths(configDir).lockFile).entries['guard-pack']
    expect(record?.targets).toEqual([join(skillsDir, 'deploy'), join(skillsDir, 'guard-pack--review')])
  })


  it('keeps locally-modified owned skill on reinstall/update', async () => {
    await installEntry(GUARD_ENTRY, { configDir, skillsDir, execFileFn: guardGit })
    const deploy = join(skillsDir, 'deploy')
    writeFileSync(join(deploy, 'SKILL.md'), '# USER edited deploy')

    const result = await installEntry(GUARD_ENTRY, { configDir, skillsDir, execFileFn: guardGit })
    const skillResult = result as { collisions?: string[]; skills: string[] }
    expect(readFileSync(join(deploy, 'SKILL.md'), 'utf8')).toBe('# USER edited deploy')
    expect(skillResult.collisions?.some((c) => c.includes('locally-modified'))).toBe(true)
    expect(skillResult.skills).toContain('deploy')
  })

  it('restores every previous skill target when a later target fails its content pin', async () => {
    await installEntry(GUARD_ENTRY, { configDir, skillsDir, execFileFn: guardGit })
    const priorLock = readLock(marketplacePaths(configDir).lockFile).entries['guard-pack']
    const expectedDir = join(home, 'expected-review')
    mkdirSync(expectedDir, { recursive: true })
    writeFileSync(join(expectedDir, 'SKILL.md'), '# Pack Review v2')
    const updatedGit: ExecFileFn = async (_file, args, options) => {
      if (args.includes('checkout')) {
        mkdirSync(join(options.cwd!, 'review'), { recursive: true })
        writeFileSync(join(options.cwd!, 'review', 'SKILL.md'), '# Pack Review v2')
        mkdirSync(join(options.cwd!, 'deploy'), { recursive: true })
        writeFileSync(join(options.cwd!, 'deploy', 'SKILL.md'), '# Pack Deploy v2')
      }
      return { stdout: args[0] === 'rev-parse' ? `${REF}\n` : '', stderr: '' }
    }

    await expect(
      installEntry(
        { ...GUARD_ENTRY, expectedContentSha256: { review: sha256Directory(expectedDir), deploy: '0'.repeat(64) } },
        { configDir, skillsDir, execFileFn: updatedGit, now: () => 100 },
      ),
    ).rejects.toThrow(/content sha256 mismatch/)

    expect(readFileSync(join(skillsDir, 'review', 'SKILL.md'), 'utf8')).toBe('# Pack Review')
    expect(readFileSync(join(skillsDir, 'deploy', 'SKILL.md'), 'utf8')).toBe('# Pack Deploy')
    const lock = readLock(marketplacePaths(configDir).lockFile).entries['guard-pack']
    expect(lock).toEqual(priorLock)
    expect(readInstallMarker(join(skillsDir, 'review'))?.ref).toBe(REF)
  })

  it('installs every skill with an alias when all original names belong to the user', async () => {
    // Both review and deploy already exist as unowned user dirs.
    for (const name of ['review', 'deploy']) {
      const dir = join(skillsDir, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), `# USER ${name}`)
    }
    const result = await installEntry(GUARD_ENTRY, { configDir, skillsDir, execFileFn: guardGit })
    expect(result.kind === 'skillpack' && result.skills).toEqual(['guard-pack--deploy', 'guard-pack--review'])
    expect(readLock(marketplacePaths(configDir).lockFile).entries['guard-pack']?.targets).toHaveLength(2)
    expect(readFileSync(join(skillsDir, 'review', 'SKILL.md'), 'utf8')).toBe('# USER review')
    expect(readFileSync(join(skillsDir, 'deploy', 'SKILL.md'), 'utf8')).toBe('# USER deploy')
  })

  it('directory mode preserves an unowned existing dir and installs an alias', async () => {
    const userPack = join(skillsDir, 'mega-pack')
    mkdirSync(userPack, { recursive: true })
    writeFileSync(join(userPack, 'SKILL.md'), '# USER pack')

    const result = await installEntry(
        { ...GUARD_ENTRY, id: 'mega-pack', installMode: 'directory' as const },
        { configDir, skillsDir, execFileFn: guardGit },
      )
    expect(readFileSync(join(userPack, 'SKILL.md'), 'utf8')).toBe('# USER pack')
    expect(result.kind === 'skillpack' && result.targets).toEqual([join(skillsDir, 'mega-pack--mega-pack')])
  })
})

describe('installEntry (kind:tool)', () => {
  it('rejects tools missing from the toolchain manifest', async () => {
    const entry: MarketplaceEntry = {
      id: 'unknown-tool',
      kind: 'tool',
      title: 'Unknown Tool',
      descriptionRu: 'Инструмент вне манифеста',
      source: { type: 'github', repo: 'owner/tool', ref: REF },
      toolName: 'definitely-not-a-real-tool',
    }
    const error = await installEntry(entry, { configDir }).catch((err: unknown) => err)
    expect((error as { code?: string }).code).toBe('TOOL_NOT_IN_MANIFEST')
    expect(readLock(marketplacePaths(configDir).lockFile).entries).toEqual({})
  })
})
