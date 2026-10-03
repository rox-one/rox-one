import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBackendFixture } from './backend-fixture'

const fixture = await createBackendFixture()
afterAll(() => fixture.dispose())
const detailChannel = 'skills:getDetails'
const read = (slug: string, workingDirectory?: string) => fixture.invoke(detailChannel, 'fixture', slug, workingDirectory)

describe('selected skill details through the registered RPC with real disposable files', () => {
  for (const position of ['first', 'middle']) for (const failure of ['denial', 'EACCES']) {
    test(`listing isolates ${failure} in a ${position} craft entry without concealing selected-read errors`, async () => {
      const skillsRoot = join(fixture.workspace, 'skills')
      const badSlug = position === 'first' ? 'aa-list-bad' : 'bb-list-bad'
      const healthy = position === 'first' ? ['bb-list-good', 'cc-list-good'] : ['aa-list-good', 'cc-list-good']
      const created = [fixture.skill(skillsRoot, badSlug, '# Unsafe candidate')]
      for (const slug of healthy) created.push(fixture.skill(skillsRoot, slug, `# Healthy ${slug}`))
      // A lower-priority candidate must not conceal the selected craft denial.
      created.push(fixture.skill(fixture.runtimeRoot, badSlug, '# Lower runtime fallback'))
      const outside = fixture.skill(join(fixture.root, 'listing-outside'), badSlug, '# Synthetic external body')
      const fs = await import('fs')
      const asyncFs = await import('fs/promises')
      const originalPath = fs.realpathSync
      const originalDirectory = fs.readdirSync
      const badFile = join(originalPath(created[0]!), 'SKILL.md')
      const outsideFile = join(originalPath(outside), 'SKILL.md')
      const canonical = spyOn(fs, 'realpathSync').mockImplementation(((path: any) => {
        if (resolve(String(path)) === resolve(badFile)) {
          if (failure === 'EACCES') throw Object.assign(new Error('Controlled access denied'), { code: 'EACCES' })
          return outsideFile
        }
        return originalPath(path)
      }) as typeof fs.realpathSync)
      const enumeration = spyOn(fs, 'readdirSync').mockImplementation(((path: any, options: any) => {
        const entries = originalDirectory(path, options)
        return resolve(String(path)) === resolve(skillsRoot)
          ? entries.sort((a: any, b: any) => a.name.localeCompare(b.name)) : entries
      }) as typeof fs.readdirSync)
      const syncRead = spyOn(fs, 'readFileSync')
      const asyncRead = spyOn(asyncFs, 'readFile')
      try {
        fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
        const list = await fixture.invoke(fixture.RPC_CHANNELS.skills.GET, 'fixture')
        expect(syncRead.mock.calls.filter(call => [badFile, outsideFile].includes(String(call[0])))).toHaveLength(0)
        for (const slug of healthy) expect(list.some((skill: any) => skill.source === 'workspace' && skill.slug === slug)).toBe(true)
        await expect(read(badSlug)).rejects.toThrow(failure === 'denial' ? 'Skill instructions path denied' : 'Controlled access denied')
        expect(syncRead.mock.calls.filter(call => [badFile, outsideFile].includes(String(call[0])))).toHaveLength(0)
        expect(asyncRead.mock.calls).toHaveLength(0)
      } finally {
        canonical.mockRestore(); enumeration.mockRestore(); syncRead.mockRestore(); asyncRead.mockRestore()
        for (const directory of created) rmSync(directory, { recursive: true, force: true })
        fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
      }
    })
  }
  // Real files and filesystem calls; one canonical target is redirected to a
  // real regular file outside the selected directory. Windows may deny creation
  // of a file symlink (EPERM); this probe does not pretend the OS created one.
  for (const tier of ['project', 'workspace', 'global-shared', 'application', 'runtime-workspace', 'runtime-global']) {
    test(`O3 ${tier}: reject an escaping instructions-file canonical target before any body read`, async () => {
      const slug = `o3-${tier}`
      const project = join(fixture.root, 'o3-project')
      const roots: Record<string, string> = {
        project: join(project, '.agents', 'skills'), workspace: join(fixture.workspace, 'skills'),
        'global-shared': join(fixture.home, '.agents', 'skills'), application: fixture.skillsApi.APP_MANAGED_SKILLS_DIR,
        'runtime-workspace': fixture.runtimeRoot, 'runtime-global': join(fixture.home, '.omp', 'agent', 'skills'),
      }
      const directory = fixture.skill(roots[tier]!, slug, '# Safe original body')
      if (tier === 'project') fixture.sessions.push({ workspaceId: 'fixture', workingDirectory: project })
      const external = fixture.skill(join(fixture.root, 'outside'), slug, '# Synthetic private body')
      const fs = await import('fs')
      const asyncFs = await import('fs/promises')
      const original = fs.realpathSync
      const selectedFile = join(original(directory), 'SKILL.md')
      const externalFile = join(original(external), 'SKILL.md')
      let redirectedChecks = 0
      const canonical = spyOn(fs, 'realpathSync').mockImplementation(((path: any) => {
        if (resolve(String(path)) === resolve(selectedFile)) { redirectedChecks++; return externalFile }
        return original(path)
      }) as typeof fs.realpathSync)
      const syncRead = spyOn(fs, 'readFileSync')
      const asyncRead = spyOn(asyncFs, 'readFile')
      try {
        await expect(read(slug, tier === 'project' ? project : undefined)).rejects.toThrow('Skill instructions path denied')
        expect(redirectedChecks).toBeGreaterThan(0)
        expect(syncRead.mock.calls.filter(call => String(call[0]).endsWith('SKILL.md'))).toHaveLength(0)
        expect(asyncRead.mock.calls).toHaveLength(0)
        console.log(`O3 ${tier}: canonical target rejected; synchronous/asynchronous body reads = 0/0`)
      } finally {
        console.log(`O3 ${tier} probe: canonical redirects=${redirectedChecks}, sync bodies=${syncRead.mock.calls.filter(call => String(call[0]).endsWith('SKILL.md')).length}, async bodies=${asyncRead.mock.calls.length}`)
        canonical.mockRestore(); syncRead.mockRestore(); asyncRead.mockRestore()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
  for (const tier of ['project', 'workspace', 'global-shared', 'application', 'runtime']) {
    test(`O3 ${tier}: a legitimate skill-directory junction remains readable`, async () => {
      const slug = `linked-${tier}`
      const project = join(fixture.root, 'linked-project')
      const roots: Record<string, string> = {
        project: join(project, '.agents', 'skills'), workspace: join(fixture.workspace, 'skills'),
        'global-shared': join(fixture.home, '.agents', 'skills'), application: fixture.skillsApi.APP_MANAGED_SKILLS_DIR,
        runtime: fixture.runtimeRoot,
      }
      const root = roots[tier]!
      const target = fixture.skill(join(fixture.root, 'junction-hub'), slug, `# Legitimate ${tier} body`)
      mkdirSync(root, { recursive: true })
      const link = join(root, slug)
      symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
      if (tier === 'project') fixture.sessions.push({ workspaceId: 'fixture', workingDirectory: project })
      try { expect((await read(slug, tier === 'project' ? project : undefined)).content).toContain(`Legitimate ${tier} body`) }
      finally { rmSync(link, { recursive: true, force: true }) }
    })
  }
  test('production list omits all runtime bodies; selected read returns unicode body without populating list', async () => {
    const list = await fixture.invoke(fixture.RPC_CHANNELS.skills.GET, 'fixture')
    expect(list).toHaveLength(2216)
    expect(list.filter((s: any) => s.source === 'omp').every((s: any) => s.content === '')).toBe(true)
    const selected = await read('md-slides')
    expect(selected.source).toBe('omp')
    expect(selected.content).toContain('Привет, 世界 — café')
    expect(selected.metadata.name).toBe('Slides display name')
    expect(list.find((s: any) => s.slug === 'md-slides').content).toBe('')
    expect((await fixture.invoke(fixture.RPC_CHANNELS.skills.GET, 'fixture')).find((s: any) => s.slug === 'md-slides').content).toBe('')
    expect(fixture.options.get(detailChannel)).toEqual({ nativeAction: 'read' })
  })
  test('rejects other workspace and path arguments; a workspace-qualified read uses that workspace', async () => {
    const handler = fixture.handlers.get(detailChannel)!
    await expect(handler(fixture.context(), 'fixture-b', 'md-slides')).rejects.toThrow('Workspace access denied')
    await expect(handler({ ...fixture.context(), principal: { issuer: 'native', subject: 'fixture', credentialId: 'fixture', credentialVersion: 1 } }, 'fixture-b', 'md-slides')).rejects.toThrow('Workspace access denied')
    expect((await fixture.invoke(detailChannel, 'fixture-b', 'md-slides')).content).toContain('Workspace B')
    for (const slug of ['../md-slides', 'a\\b', 'C:\\secrets', '.pending']) expect(await read(slug)).toBeNull()
    const foreign = join(fixture.root, 'foreign-project')
    fixture.skill(join(foreign, '.agents', 'skills'), 'md-slides', '# Not workspace authorized')
    await expect(read('md-slides', foreign)).rejects.toThrow()
  })
  test('a warm 2216-entry list triggers exactly one asynchronous body read for the selected runtime skill', async () => {
    await fixture.invoke(fixture.RPC_CHANNELS.skills.GET, 'fixture')
    const fs = await import('fs/promises')
    const bodyRead = spyOn(fs, 'readFile')
    try {
      expect((await read('tool-prompt-optimization')).content).toContain('Instructions for tool-prompt-optimization')
      expect(bodyRead.mock.calls).toHaveLength(1)
      expect(String(bodyRead.mock.calls[0]![0])).toContain(join('tool-prompt-optimization', 'SKILL.md'))
    } finally { bodyRead.mockRestore() }
  })
  test('cold selected read does not rescan/read other runtime bodies', async () => {
    fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
    const fs = await import('fs')
    const asyncFs = await import('fs/promises')
    const metadataRead = spyOn(fs, 'readFileSync')
    const bodyRead = spyOn(asyncFs, 'readFile')
    try {
      expect((await read('md-slides')).content).toContain('Привет')
      expect(metadataRead.mock.calls.filter(call => String(call[0]).endsWith('SKILL.md'))).toHaveLength(0)
      expect(bodyRead.mock.calls).toHaveLength(1)
    } finally { metadataRead.mockRestore(); bodyRead.mockRestore() }
  })
  test('craft/project precedence and configured session directory are preserved', async () => {
    expect((await read('duplicate')).source).toBe('workspace')
    const project = join(fixture.root, 'session-project')
    fixture.skill(join(project, '.agents', 'skills'), 'md-slides', '# Project winner')
    fixture.sessions.push({ workspaceId: 'fixture', workingDirectory: project })
    expect((await read('md-slides', project)).source).toBe('project')
    expect((await read('md-slides', project)).content).toContain('Project winner')
    const configured = join(fixture.root, 'registered-project')
    fixture.skill(join(configured, '.agents', 'skills'), 'md-slides', '# Registered project winner')
    const folder = join(fixture.workspace, 'projects', 'registered')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'config.json'), JSON.stringify({ id: 'project-fixture', slug: 'registered', name: 'Fixture project', workingDirectory: configured, createdAt: 1, updatedAt: 1 }))
    expect((await read('md-slides', configured)).content).toContain('Registered project winner')
  })
  test('unicode directory names and global/runtime precedence use server-discovered paths', async () => {
    fixture.skill(fixture.runtimeRoot, 'урок-世界', '# Unicode directory body')
    fixture.skill(join(fixture.home, '.omp', 'agent', 'skills'), 'global-runtime', '# Global runtime body')
    fixture.skill(join(fixture.home, '.omp', 'agent', 'skills'), 'md-slides', '# Lower priority global runtime body')
    fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
    expect((await read('урок-世界')).content).toContain('Unicode directory body')
    expect((await read('global-runtime')).content).toContain('Global runtime body')
    expect((await read('md-slides')).content).toContain('Привет')
  })
  test('missing selected file is null; malformed selected frontmatter errors instead of empty success', async () => {
    const missing = fixture.skill(fixture.runtimeRoot, 'removed', '# Will disappear')
    fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
    await fixture.invoke(fixture.RPC_CHANNELS.skills.GET, 'fixture')
    rmSync(join(missing, 'SKILL.md'))
    expect(await read('removed')).toBeNull()
    const malformed = fixture.skill(fixture.runtimeRoot, 'malformed', '# Valid initially')
    fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
    await fixture.invoke(fixture.RPC_CHANNELS.skills.GET, 'fixture')
    writeFileSync(join(malformed, 'SKILL.md'), '---\nname: [invalid\n---\nbody')
    await expect(read('malformed')).rejects.toThrow()
  })
  test('SKILL.md symlink cannot read an unrelated file; explicitly discovered directory junction is supported', async () => {
    const directory = fixture.skill(fixture.runtimeRoot, 'escaping', '# Safe initially')
    const outside = join(fixture.root, 'outside.txt')
    writeFileSync(outside, 'synthetic-private-marker')
    rmSync(join(directory, 'SKILL.md'))
    // Windows file symlinks need privilege. A directory junction needs none and
    // still exercises an escaping SKILL.md canonical target before any read.
    symlinkSync(fixture.root, join(directory, 'SKILL.md'), 'junction')
    fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
    const fs = await import('fs/promises')
    const bodyRead = spyOn(fs, 'readFile')
    try {
      await expect(read('escaping')).rejects.toThrow('Skill instructions path denied')
      expect(bodyRead.mock.calls).toHaveLength(0)
    } finally { bodyRead.mockRestore() }
    const hub = join(fixture.root, 'hub')
    const target = fixture.skill(hub, 'linked', '# Linked body')
    symlinkSync(target, join(fixture.runtimeRoot, 'linked'), 'junction')
    fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
    expect((await read('linked')).content).toContain('Linked body')
  })
  test('current-main managed collision aliases preserve both skill identities', async () => {
    const managed = fixture.skill(fixture.skillsApi.APP_MANAGED_SKILLS_DIR, 'collision', '# Application body', 'Same name')
    fixture.skill(join(fixture.workspace, 'skills'), 'collision', '# Workspace body', 'Same name')
    fixture.skillsApi.invalidateSkillsCache(); fixture.skillsApi.invalidateOmpSkillsCache()
    try {
      const list = await fixture.invoke(fixture.RPC_CHANNELS.skills.GET, 'fixture')
      expect(list.some((skill: any) => skill.slug === 'collision')).toBe(true)
      expect(list.some((skill: any) => skill.slug === 'rox--collision')).toBe(true)
      expect((await read('collision')).content).toContain('Workspace body')
      expect((await read('rox--collision')).content).toContain('Application body')
    } finally { rmSync(managed, { recursive: true, force: true }) }
  })
})
