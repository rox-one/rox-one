import { mock } from 'bun:test'
import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const original = { ...fs }
const root = original.mkdtempSync(join(tmpdir(), 'rox-audio-ancestor-race-'))
const id = randomUUID(), directory = join(root, 'voice', 'recordings', id), foreign = join(root, 'foreign')
original.mkdirSync(directory, { recursive: true }); original.mkdirSync(foreign)
const owned = Buffer.from('OWNED-SYNTHETIC-AUDIO'), foreignBytes = Buffer.from('FOREIGN-SYNTHETIC-AUDIO')
const file = join(directory, 'original.bin')
original.writeFileSync(file, owned); original.writeFileSync(join(foreign, 'original.bin'), foreignBytes)
const foreignInode = original.lstatSync(join(foreign, 'original.bin'), { bigint: true }).ino
let replaced = false, foreignReads = 0, returnedFrame = false, rejected = false
mock.module('node:fs', () => ({ ...original,
  lstatSync(path: fs.PathLike, options?: fs.StatOptions) {
    if (String(path) === file && !replaced) {
      replaced = true
      // Real directories, identical canonical pathname, no symbolic link.
      original.renameSync(directory, directory + '.saved'); original.renameSync(foreign, directory)
    }
    return original.lstatSync(path, options as never)
  },
  readSync(...args: Parameters<typeof fs.readSync>) {
    if (original.fstatSync(args[0], { bigint: true }).ino === foreignInode) foreignReads++
    return original.readSync(...args)
  },
}))
try {
  const { readVoiceAudioChunk } = await import(process.env.VOICE_AUDIO_READER_MODULE ?? '../voice-audio-read')
  try {
    const frame = readVoiceAudioChunk(root, { id, createdAt: 1, audioPath: '/ignored', durationMs: 0,
      hash: createHash('sha256').update(owned).digest('hex'), format: 'wav', state: 'finalized', favorite: false }, { offset: 0 })
    returnedFrame = Boolean(frame?.audioBase64)
  } catch { rejected = true }
  console.log(JSON.stringify({ replaced, rejected, foreignReads, returnedFrame }))
} finally { mock.restore(); original.rmSync(root, { recursive: true, force: true }) }
