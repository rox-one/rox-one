import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Run only in an explicitly isolated acceptance profile. No credentials or
// provider fixtures: the real Electron app and its real storage own all writes.
const root = process.env.ROX_CONFIG_DIR
if (!root || !root.includes('rox-compound-e2e-')) throw new Error('Isolated profile required')
const config = await import('@craft-agent/shared/config')
const workspaces = await import('@craft-agent/shared/workspaces')
const projects = await import('@craft-agent/shared/projects')
const workspaceRoot = join(root, 'workspaces', 'acceptance')
config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, setupDeferred: true, defaultZoomLevel: 100, notificationsEnabled: false, memory: { enabled: false, semantic: false } })
const folder = workspaces.createWorkspaceAtPath(workspaceRoot, 'Приёмка Docs', { workingDirectory: workspaceRoot }, { id: 'ws_compound_acceptance', slug: 'acceptance', kind: 'personal' })
const notesRoot = join(root, 'native-notes')
await mkdir(notesRoot, { recursive: true })
await workspaces.saveWorkspaceConfig(workspaceRoot, { ...folder, notesPath: notesRoot })
const canonicalWorkspace = config.addWorkspace({ name: folder.name, rootPath: workspaceRoot, kind: 'personal' })
const stored = config.loadStoredConfig()!
stored.activeWorkspaceId = canonicalWorkspace.id
stored.setupDeferred = true
config.saveConfig(stored)
await writeFile(join(notesRoot, 'acceptance.md'), '---\ntitle: Проверка документа\ntags: []\n---\n\n# Проверка документа\n\nИсходный текст.\n\n- [ ] Задача приёмки\n')
await writeFile(join(notesRoot, 'navigation.md'), '---\ntitle: Навигационная заметка\ntags: []\n---\n\n# Навигационная заметка\n\nТекст второго документа.\n')
const propertiesSource = [
  '---',
  'title: Типизированные свойства',
  '# Комментарий и оформление должны сохраниться при скалярном изменении.',
  'empty: null # keep-null',
  "digits: '001' # keep-leading-zero",
  "truth: 'true' # keep-string-boolean",
  "comma: 'a,b' # keep-comma",
  'amount: 7 # keep-number-comment',
  'enabled: true # keep-boolean-comment',
  'tags: []',
  '---', '', '# Типизированные свойства', '',
  'Неизменяемый текст с кириллицей, эмодзи 🧭 и `inline code`.', '',
].join('\n')
await writeFile(join(notesRoot, 'properties.md'), propertiesSource)
const unsupportedSource = '---\ntitle: Неподдерживаемые свойства\nshared: &shared anchor-value\nalias: *shared\ntagged: !custom opaque-value\nmultiline: |\n  первая строка\n  вторая строка\nsequence: [one, two]\n---\n\n# Неподдерживаемые свойства\n\nНативный исходный текст сохраняется.\n'
await writeFile(join(notesRoot, 'unsupported.md'), unsupportedSource)
const malformedSource = '---\ntitle: Некорректные свойства\nbroken: [one, two\n---\n\n# Некорректные свойства\n\nНе исправлять автоматически.\n'
await writeFile(join(notesRoot, 'malformed.md'), malformedSource)
const structureSource = '---\ntitle: Структура документа\ntags: []\n---\n\n# Структура документа\n\n- Родитель ^existing-parent\n  - Дочерний блок ^existing-child\n- [ ] Новый блок без маркера\n\nОтдельный текст вне дерева.\n\n```md\n- Это код, не узел дерева ^code-only\n```\n'
await writeFile(join(notesRoot, 'structure.md'), structureSource)
const repositoryRoot = join(root, 'source-repository')
await mkdir(repositoryRoot, { recursive: true })
await writeFile(join(repositoryRoot, 'README.md'), '# Acceptance repository\n\nOriginal source line.\n')
for (const args of [['init', '-q'], ['add', 'README.md'], ['-c', 'user.name=Acceptance', '-c', 'user.email=acceptance@example.invalid', 'commit', '-qm', 'Acceptance fixture']]) {
  const process = Bun.spawn(['git', ...args], { cwd: repositoryRoot, stdout: 'pipe', stderr: 'pipe' })
  if (await process.exited !== 0) throw new Error(await new Response(process.stderr).text())
}
const project = projects.createProject(workspaceRoot, { name: 'Проверка репозитория', workingDirectory: repositoryRoot })
console.log(JSON.stringify({ workspaceId: canonicalWorkspace.id, workspaceRoot, notesRoot, noteId: 'acceptance', navigationNoteId: 'navigation',
  propertiesNoteId: 'properties', propertiesSource, unsupportedNoteId: 'unsupported', unsupportedSource,
  malformedNoteId: 'malformed', malformedSource, structureNoteId: 'structure', structureSource,
  repositoryRoot, projectId: project.id, projectSlug: project.slug }))
