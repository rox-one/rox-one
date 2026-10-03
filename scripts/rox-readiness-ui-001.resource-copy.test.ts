import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { copyElectronResourceTree } from './build/staged-servers'
import { assertPortableSkillResources } from './electron-build-resources'

const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-ui001-resources-'))
  roots.push(root)
  const source = join(root, 'source'), output = join(root, 'output')
  const file = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }
  file(join(source, 'skills/telegram/SKILL.md'), 'vendored ordinary skill')
  file(join(source, 'pi-agent-server/node_modules/koffi/binding.node'), 'required subprocess runtime payload')
  return { root, source, output, file }
}

test('development caches under skills cannot leak task-local modules while required subprocess modules survive', () => {
  const { root, source, output, file } = fixture()
  const external = join(root, 'development')
  file(join(external, 'marker'), 'must never enter bundled assets')
  for (const name of ['node_modules', '.build', '.swiftpm', '.git']) {
    symlinkSync(external, join(source, 'skills/telegram', name), 'dir')
    file(join(output, 'skills/telegram', name, 'stale'), 'stale generated output')
  }
  expect(() => assertPortableSkillResources(join(source, 'skills'))).not.toThrow()
  copyElectronResourceTree(source, output)
  for (const name of ['node_modules', '.build', '.swiftpm', '.git']) expect(existsSync(join(output, 'skills/telegram', name))).toBe(false)
  expect(readFileSync(join(output, 'skills/telegram/SKILL.md'), 'utf8')).toBe('vendored ordinary skill')
  expect(readFileSync(join(output, 'pi-agent-server/node_modules/koffi/binding.node'), 'utf8')).toBe('required subprocess runtime payload')
  expect(readFileSync(join(external, 'marker'), 'utf8')).toBe('must never enter bundled assets')
  expect(existsSync(join(source, 'skills/telegram/node_modules'))).toBe(true)
})

test('ordinary files named similarly are retained and genuine vendored aliases still fail portability', () => {
  const { root, source, output, file } = fixture()
  file(join(source, 'skills/telegram/node_modules-guide.md'), 'installation guide')
  file(join(root, 'external-skill.md'), 'external alias')
  symlinkSync(join(root, 'external-skill.md'), join(source, 'skills/telegram/alias.md'))
  expect(() => assertPortableSkillResources(join(source, 'skills'))).toThrow('telegram/alias.md')
  rmSync(join(source, 'skills/telegram/alias.md'))
  copyElectronResourceTree(source, output)
  expect(readFileSync(join(output, 'skills/telegram/node_modules-guide.md'), 'utf8')).toBe('installation guide')
})

test('stale generated skills symlinks are removed without pruning their external target', () => {
  const { root, source, output, file } = fixture()
  rmSync(join(source, 'skills'), { recursive: true })
  file(join(root, 'external/node_modules/keep'), 'external content survives')
  mkdirSync(output, { recursive: true })
  symlinkSync(join(root, 'external'), join(output, 'skills'), 'dir')
  copyElectronResourceTree(source, output)
  expect(existsSync(join(output, 'skills'))).toBe(false)
  expect(readFileSync(join(root, 'external/node_modules/keep'), 'utf8')).toBe('external content survives')
})
