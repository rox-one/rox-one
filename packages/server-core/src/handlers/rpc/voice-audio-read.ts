import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { VoiceRecording } from '@rox/shared/voice/history'

const CHUNK_BYTES = 192 * 1024
const MAX_BYTES = 200 * 1024 * 1024

/** Read only an actor-owned original in transport-sized frames; paths stay on the server. */
export function readVoiceAudioChunk(root: string, recording: VoiceRecording, body: Record<string, unknown>) {
  if (!/^[a-f0-9-]{36}$/.test(recording.id) || !/^[a-f0-9]{64}$/.test(recording.hash)) throw new Error('Recording audio is unavailable')
  const offset = body.offset
  if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) % CHUNK_BYTES !== 0) throw new Error('Invalid audio offset')
  let fd: number | undefined
  try {
    const file = join(root, 'voice', 'recordings', recording.id, 'original.bin')
    const directories = [root, join(root, 'voice'), join(root, 'voice', 'recordings'), dirname(file)]
    const ancestors = directories.map(path => {
      const stat = lstatSync(path, { bigint: true })
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Recording audio is unavailable')
      return { path: realpathSync(path), dev: stat.dev, ino: stat.ino }
    })
    const canonical = ancestors.map(item => item.path)
    const assertAncestors = () => {
      for (let index = 0; index < directories.length; index++) {
        const stat = lstatSync(directories[index]!, { bigint: true }), ancestor = ancestors[index]!
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== ancestor.dev || stat.ino !== ancestor.ino
          || realpathSync(directories[index]!) !== ancestor.path) throw new Error('Recording audio changed')
      }
    }
    if (canonical.some((path, index) => path !== (index === 0 ? canonical[0] : join(canonical[0]!, ...['voice', 'recordings', recording.id].slice(0, index))))) throw new Error('Recording audio is unavailable')
    assertAncestors()
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const opened = fstatSync(fd, { bigint: true })
    if (!opened.isFile() || opened.size <= 0n || opened.size > BigInt(MAX_BYTES)) throw new Error('Recording audio is unavailable')
    const named = lstatSync(file, { bigint: true })
    const token = createHash('sha256').update([recording.hash, opened.dev, opened.ino, opened.size, opened.mtimeNs, opened.ctimeNs].join(':')).digest('hex')
    const same = (stat: typeof named) => stat.isFile() && !stat.isSymbolicLink() && stat.dev === opened.dev && stat.ino === opened.ino
      && stat.size === opened.size && stat.mtimeNs === opened.mtimeNs && stat.ctimeNs === opened.ctimeNs
    if (!same(named) || (offset as number) >= Number(opened.size) || ((offset as number) > 0 && body.token !== token)) throw new Error('Recording audio changed')
    // Bind the opened leaf to every prechecked ancestor before reading bytes.
    assertAncestors()
    const bytes = Buffer.alloc(Math.min(CHUNK_BYTES, Number(opened.size) - (offset as number)))
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, (offset as number) + length)
      if (!count) break
      length += count
    }
    if (length !== bytes.length || !same(fstatSync(fd, { bigint: true })) || !same(lstatSync(file, { bigint: true }))) throw new Error('Recording audio changed')
    assertAncestors()
    const formats: Record<string, string> = { wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4' }
    const mimeType = formats[recording.format.toLowerCase().split(';')[0]!.replace('audio/', '')]
    if (!mimeType) throw new Error('Recording audio format is unavailable')
    return { audioBase64: bytes.toString('base64'), offset: offset as number, totalBytes: Number(opened.size), token, hash: recording.hash, mimeType }
  } catch { throw new Error('Recording audio is unavailable or changed') }
  finally { if (fd !== undefined) closeSync(fd) }
}
