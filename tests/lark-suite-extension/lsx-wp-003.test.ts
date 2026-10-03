import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarkdownCommitStore, markdownRevision, type MarkdownCommitOwner } from '../../packages/server-core/src/docs/markdown-commit.ts'
import { decodeMarkdownCommitCommand } from '../../packages/core/src/docs/command-envelope.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const original = '\uFEFF---\r\ntitle: "Лиссабон" # untouched\r\ncustom: { value: yes }\r\n---\r\n\r\n# Поездка\r\n- item ^abc\r\n'
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rox-markdown-'))
  roots.push(root)
  await writeFile(join(root, 'trip.md'), original)
  let allowed = true, epoch = 1
  const owner: MarkdownCommitOwner = { authorize: async actor => allowed && actor === 'local-user', authorityEpoch: async () => epoch }
  const command = (operationId = 'first', content = original + '\r\nДальше\r\n') => ({ workspaceId: 'ws', noteId: 'trip', expectedRevision: markdownRevision(original), authorityEpoch: 1, operationId, content })
  return { root, owner, command, revoke: () => { allowed = false }, migrate: () => { epoch = 2 } }
}

describe('native Markdown command authority', () => {
  test('rejects a metadata symlink before writing outside the native vault', async () => {
    const f = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rox-outside-'))
    roots.push(outside)
    await symlink(outside, join(f.root, '.rox-docs'))
    await expect(new MarkdownCommitStore(f.root, f.owner).commit('local-user', f.command())).rejects.toThrow('metadata path')
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(original)
  })

  test('recovers a WAL operation after an actual writer process is killed', async () => {
    const f = await fixture()
    const modulePath = join(import.meta.dir, '../../packages/server-core/src/docs/markdown-commit.ts')
    const child = Bun.spawn([process.execPath, '-e', `import {MarkdownCommitStore} from ${JSON.stringify(modulePath)}; const store = new MarkdownCommitStore(${JSON.stringify(f.root)}, {authorize:async()=>true,authorityEpoch:async()=>1}, async point=>{if(point==='afterJournalSync') process.kill(process.pid,'SIGKILL')}); await store.commit('local-user',${JSON.stringify(f.command('hard-crash'))});`], { stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).not.toBe(0)
    const recovered = await new MarkdownCommitStore(f.root, f.owner).commit('local-user', f.command('hard-crash'))
    expect(recovered.operationId).toBe('hard-crash')
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(f.command('hard-crash').content)
  })
  test('preserves raw Markdown bytes and returns a durable replay receipt after restart', async () => {
    const f = await fixture()
    const cmd = f.command()
    const receipt = await new MarkdownCommitStore(f.root, f.owner).commit('local-user', cmd)
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(cmd.content)
    expect(receipt.revision).toBe(markdownRevision(cmd.content))
    const restarted = new MarkdownCommitStore(f.root, f.owner)
    expect(await restarted.commit('local-user', cmd)).toEqual(receipt)
    expect(await restarted.getReceipt('local-user', 'ws', 'trip', cmd.operationId)).toEqual(receipt)
    await expect(restarted.commit('local-user', { ...cmd, content: 'different' })).rejects.toThrow('different inputs')
  })

  test('two independent store instances with the same base revision commit exactly once', async () => {
    const f = await fixture()
    const a = f.command('A', 'first writer'), b = f.command('B', 'second writer')
    const results = await Promise.allSettled([
      new MarkdownCommitStore(f.root, f.owner).commit('local-user', a),
      new MarkdownCommitStore(f.root, f.owner).commit('local-user', b),
    ])
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const loser = results.find(x => x.status === 'rejected') as PromiseRejectedResult
    expect(loser.reason.kind).toBe('conflict')
    const winner = results.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<MarkdownCommitStore['commit']>>>
    expect(markdownRevision(await readFile(join(f.root, 'trip.md'), 'utf8'))).toBe(winner.value.revision)
  })

  test('rejects a committed journal copied into another workspace receipt directory', async () => {
    const f = await fixture()
    const store = new MarkdownCommitStore(f.root, f.owner)
    const command = f.command('copied-receipt')
    const receipt = await store.commit('local-user', command)
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const journalName = `${digest(`local-user\0${command.operationId}`)}.json`
    const commits = join(f.root, '.rox-docs', 'commits')
    const sourceDirectory = join(commits, digest('ws\0trip'))
    const foreignDirectory = join(commits, digest('another-workspace\0trip'))
    await mkdir(foreignDirectory)
    await copyFile(join(sourceDirectory, journalName), join(foreignDirectory, journalName))
    await expect(store.getReceipt('local-user', 'another-workspace', 'trip', command.operationId)).rejects.toThrow('another request')
    expect(await store.getReceipt('local-user', 'ws', 'trip', command.operationId)).toEqual(receipt)
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(command.content)
  })

  test('two authorized workspaces sharing one native vault still have one physical writer', async () => {
    const f = await fixture()
    const ownerFor = (workspaceId: string): MarkdownCommitOwner => ({
      authorize: async (actor, command) => actor === 'local-user' && command.workspaceId === workspaceId,
      authorityEpoch: async () => 1,
    })
    const a = { ...f.command('shared-vault-A', 'workspace A wins'), workspaceId: 'workspace-A' }
    const b = { ...f.command('shared-vault-B', 'workspace B wins'), workspaceId: 'workspace-B' }
    const first = new MarkdownCommitStore(f.root, ownerFor(a.workspaceId))
    const second = new MarkdownCommitStore(f.root, ownerFor(b.workspaceId))
    const results = await Promise.allSettled([first.commit('local-user', a), second.commit('local-user', b)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const winner = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<MarkdownCommitStore['commit']>>>
    const loser = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(loser.reason.kind).toBe('conflict')
    expect(markdownRevision(await readFile(join(f.root, 'trip.md'), 'utf8'))).toBe(winner.value.revision)
    const winnerStore = winner.value.workspaceId === a.workspaceId ? first : second
    expect(await winnerStore.getReceipt('local-user', winner.value.workspaceId, 'trip', winner.value.operationId)).toEqual(winner.value)
  })

  test('a strict native owner aborts an older unbound prepared journal before publishing', async () => {
    const f = await fixture()
    const oldCommand = f.command('unbound-before-cutover', 'unbound bytes must never publish')
    const interrupted = new MarkdownCommitStore(f.root, f.owner, async point => {
      if (point === 'afterJournalSync') throw new Error('stop before publication')
    })
    await expect(interrupted.commit('local-user', oldCommand)).rejects.toThrow('stop before publication')
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(original)
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const oldJournalPath = join(f.root, '.rox-docs', 'commits', digest('ws\0trip'), `${digest(`local-user\0${oldCommand.operationId}`)}.json`)
    expect(JSON.parse(await readFile(oldJournalPath, 'utf8')).phase).toBe('prepared')

    const sourceStoreId = 'native-notes:ws:current-source'
    const strictOwner: MarkdownCommitOwner = { ...f.owner, requireSourceBinding: true, sourceStoreId: async () => sourceStoreId }
    const strictStore = new MarkdownCommitStore(f.root, strictOwner)
    await expect(strictStore.commit('local-user', oldCommand)).rejects.toThrow('source binding is required')
    await expect(strictStore.commit('local-user', { ...f.command('wrong-source'), sourceStoreId: 'native-notes:ws:old-source' })).rejects.toThrow('source binding changed')
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(oldJournalPath, 'utf8')).phase).toBe('prepared')

    const boundCommand = { ...f.command('bound-after-cutover', 'new bound native content'), sourceStoreId }
    const receipt = await strictStore.commit('local-user', boundCommand)
    expect(receipt.sourceStoreId).toBe(sourceStoreId)
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(boundCommand.content)
    expect(JSON.parse(await readFile(oldJournalPath, 'utf8')).phase).toBe('aborted')
    await expect(strictStore.getReceipt('local-user', 'ws', 'trip', oldCommand.operationId)).rejects.toThrow('source binding is required')
    expect(await strictStore.getReceipt('local-user', 'ws', 'trip', boundCommand.operationId)).toEqual(receipt)
    expect(await strictStore.getReceipt('local-user', 'ws', 'trip', 'never-submitted')).toBeNull()
    expect(await strictStore.commit('local-user', boundCommand)).toEqual(receipt)
  })

  test('a legacy unbound committed receipt stays readable only to compatibility owners', async () => {
    const f = await fixture()
    const command = f.command('legacy-committed-receipt')
    const receipt = await new MarkdownCommitStore(f.root, f.owner).commit('local-user', command)
    expect(await new MarkdownCommitStore(f.root, f.owner).getReceipt('local-user', 'ws', 'trip', command.operationId)).toEqual(receipt)
    const strictOwner: MarkdownCommitOwner = { ...f.owner, requireSourceBinding: true, sourceStoreId: async () => 'native-notes:ws:current-source' }
    await expect(new MarkdownCommitStore(f.root, strictOwner).getReceipt('local-user', 'ws', 'trip', command.operationId)).rejects.toThrow('source binding is required')
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(command.content)
  })

  test('receipt authorization checks the source token persisted in a copied committed journal', async () => {
    const source = await fixture()
    const destination = await fixture()
    let currentSource = 'native-notes:ws:old-source'
    const owner: MarkdownCommitOwner = { ...source.owner, requireSourceBinding: true, sourceStoreId: async () => currentSource }
    const command = { ...source.command('copied-source-receipt', 'committed bytes from the old source'), sourceStoreId: currentSource }
    const receipt = await new MarkdownCommitStore(source.root, owner).commit('local-user', command)
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const journalName = `${digest(`local-user\0${command.operationId}`)}.json`
    const sourceDirectory = join(source.root, '.rox-docs', 'commits', digest('ws\0trip'))
    const destinationDirectory = join(destination.root, '.rox-docs', 'commits', digest('ws\0trip'))
    await mkdir(destinationDirectory, { recursive: true })
    await copyFile(join(sourceDirectory, journalName), join(destinationDirectory, journalName))
    await writeFile(join(destination.root, 'trip.md'), command.content)
    const restored = new MarkdownCommitStore(destination.root, owner)
    expect(await restored.getReceipt('local-user', 'ws', 'trip', command.operationId)).toEqual(receipt)

    currentSource = 'native-notes:ws:new-source'
    await expect(restored.getReceipt('local-user', 'ws', 'trip', command.operationId)).rejects.toThrow('source binding changed')
    await expect(restored.commit('local-user', command)).rejects.toThrow('source binding changed')
    expect(await readFile(join(destination.root, 'trip.md'), 'utf8')).toBe(command.content)
    expect(JSON.parse(await readFile(join(destinationDirectory, journalName), 'utf8')).phase).toBe('committed')
  })

  for (const fault of ['afterJournalSync', 'afterContentRename', 'afterReceiptSync'] as const) {
    test(`recovers acknowledged identity after interrupted ${fault}`, async () => {
      const f = await fixture()
      const cmd = f.command(fault)
      const interrupted = new MarkdownCommitStore(f.root, f.owner, async point => { if (point === fault) throw new Error('injected interruption') })
      await expect(interrupted.commit('local-user', cmd)).rejects.toThrow('injected interruption')
      const recovered = await new MarkdownCommitStore(f.root, f.owner).commit('local-user', cmd)
      expect(recovered.operationId).toBe(fault)
      expect(recovered.revision).toBe(markdownRevision(cmd.content))
      expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(cmd.content)
    })
  }

  test('does not overwrite an external edit before publication or during recovery', async () => {
    const f = await fixture()
    const store = new MarkdownCommitStore(f.root, f.owner, async point => {
      if (point === 'beforeContentRename') await writeFile(join(f.root, 'trip.md'), 'external edit')
    })
    await expect(store.commit('local-user', f.command())).rejects.toThrow('revision conflict')
    await expect(new MarkdownCommitStore(f.root, f.owner).commit('local-user', f.command())).rejects.toThrow('could not be committed')
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe('external edit')
  })

  test('revocation and epoch cutover reject pending content before replay', async () => {
    const f = await fixture()
    await expect(new MarkdownCommitStore(f.root, f.owner, async point => { if (point === 'afterJournalSync') { f.migrate(); throw new Error('stop') } }).commit('local-user', f.command())).rejects.toThrow('stop')
    await expect(new MarkdownCommitStore(f.root, f.owner).commit('local-user', f.command())).rejects.toThrow('could not be committed')
    expect(await readFile(join(f.root, 'trip.md'), 'utf8')).toBe(original)
    f.revoke()
    await expect(new MarkdownCommitStore(f.root, f.owner).getReceipt('local-user', 'ws', 'trip', 'first')).rejects.toThrow('denied')
  })

  test('rejects lossy Unicode conversion before publishing', async () => {
    const f = await fixture()
    expect(() => decodeMarkdownCommitCommand({ ...f.command(), content: 'bad\ud800text' })).toThrow('Invalid or oversized')
    expect(() => decodeMarkdownCommitCommand({ ...f.command(), content: 'bad\udc00text' })).toThrow('Invalid or oversized')
    expect(decodeMarkdownCommitCommand({ ...f.command(), content: 'valid 🧠' }).content).toBe('valid 🧠')
    const invalid = Buffer.from([0x23, 0x20, 0xc3, 0x28])
    await writeFile(join(f.root, 'trip.md'), invalid)
    await expect(new MarkdownCommitStore(f.root, f.owner).commit('local-user', f.command())).rejects.toThrow('Invalid UTF-8')
    expect(await readFile(join(f.root, 'trip.md'))).toEqual(invalid)
  })

  test('rejects denied, missing, traversal, symlink and malformed commands', async () => {
    const f = await fixture(), store = new MarkdownCommitStore(f.root, f.owner)
    await expect(store.commit('someone-else', f.command())).rejects.toThrow('denied')
    await expect(store.commit('local-user', { ...f.command(), noteId: '../escape' })).rejects.toThrow('Invalid note ID')
    await expect(store.commit('local-user', { ...f.command(), noteId: 'missing' })).rejects.toThrow('no longer exists')
    await symlink(join(f.root, 'trip.md'), join(f.root, 'alias.md'))
    await expect(store.commit('local-user', { ...f.command(), noteId: 'alias' })).rejects.toThrow('symlink')
    expect(() => decodeMarkdownCommitCommand({ ...f.command(), expectedRevision: undefined })).toThrow('revision is required')
    expect(() => decodeMarkdownCommitCommand({ ...f.command(), authorityEpoch: 0 })).toThrow('epoch')
  })
})
