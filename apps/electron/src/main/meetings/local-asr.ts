/**
 * Local ASR for meeting recordings: whisper.cpp (`whisper-cli`) + a ggml model
 * from ~/.rox/models, ffmpeg for decoding. Everything runs as local child
 * processes — no audio is uploaded anywhere. Sequential queue; progress is
 * parsed from `-pp` output.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { cpus, homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { LocalAsrEngine } from '../../shared/meetings-local'
import { modelLabel, parseWhisperProgress, pickWhisperModel } from './local-model'

const BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin']

export function findBinary(names: readonly string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = [...BIN_DIRS, ...(env.PATH ?? '').split(delimiter).filter(Boolean)]
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name)
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
      } catch {
        // unreadable dir
      }
    }
  }
  return null
}

export function modelDirs(configDir: string): string[] {
  const dirs = [join(configDir, 'models'), join(homedir(), '.rox', 'models')]
  return [...new Set(dirs)]
}

export function detectEngine(configDir: string): LocalAsrEngine {
  const binary = findBinary(['whisper-cli', 'whisper-cpp'])
  const ffmpeg = findBinary(['ffmpeg'])
  let modelPath: string | null = null
  for (const dir of modelDirs(configDir)) {
    try {
      const pick = pickWhisperModel(readdirSync(dir))
      if (pick) {
        modelPath = join(dir, pick)
        break
      }
    } catch {
      // no dir
    }
  }
  const missing: string[] = []
  if (!binary) missing.push('no-whisper')
  if (!modelPath) missing.push('no-model')
  if (!ffmpeg) missing.push('no-ffmpeg')
  return {
    ready: missing.length === 0,
    engine: binary ? 'whisper.cpp' : null,
    binary,
    model: modelPath ? modelLabel(modelPath.split('/').pop() ?? modelPath) : null,
    modelPath,
    ffmpeg,
    missing,
  }
}

export type RunResult = { code: number | null; stdout: string; stderr: string }

export function run(
  cmd: string,
  args: readonly string[],
  options: { onOutput?: (chunk: string) => void; signal?: AbortSignal } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const onAbort = () => child.kill('SIGTERM')
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      if (stdout.length < 2_000_000) stdout += s
      options.onOutput?.(s)
    })
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      stderr = (stderr + s).slice(-20_000)
      options.onOutput?.(s)
    })
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }))
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr })
    })
  })
}

/** Duration in ms via ffprobe (next to ffmpeg); null when unknown. */
export async function probeDurationMs(ffmpeg: string | null, file: string): Promise<number | null> {
  if (!ffmpeg) return null
  const ffprobe = join(ffmpeg, '..', 'ffprobe')
  if (!existsSync(ffprobe)) return null
  const res = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  const seconds = Number.parseFloat(res.stdout.trim())
  return res.code === 0 && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
}

/** Remux a MediaRecorder stream so the container carries a duration and cues. */
export async function remuxAudio(ffmpeg: string | null, input: string, output: string): Promise<boolean> {
  if (!ffmpeg) return false
  const res = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-c', 'copy', output])
  return res.code === 0 && existsSync(output) && statSync(output).size > 0
}

export async function decodeToWav(ffmpeg: string, input: string, output: string): Promise<RunResult> {
  return run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output])
}

export async function runWhisper(
  engine: LocalAsrEngine,
  wav: string,
  outBase: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<RunResult> {
  const threads = String(Math.max(2, Math.min(8, cpus().length - 2)))
  const args = ['-m', engine.modelPath!, '-f', wav, '-l', 'auto', '-t', threads, '-oj', '-of', outBase, '-pp']
  return run(engine.binary!, args, {
    signal,
    onOutput: (chunk) => {
      const pct = parseWhisperProgress(chunk)
      if (pct != null) onProgress(pct)
    },
  })
}
