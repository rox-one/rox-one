import { getServerServiceKey } from '@rox/shared/config/server-services'
/**
 * Meeting ASR: configured Deepgram Nova for cloud transcription after consent;
 * whisper.cpp remains available for an explicitly selected local engine.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { cpus, homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { LocalAsrEngine } from '../../shared/meetings-local'
import { modelLabel, parseWhisperProgress, pickWhisperModel } from './local-model'
import { DEEPGRAM_TRANSCRIPTION_MODEL } from '@rox/shared/voice'
import { ROX_HIDDEN_HOME_LINK_NAME } from '@rox/shared/identity'
import { loadVoicePrefs } from '@rox/shared/voice'

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

export function modelDirs(configDir: string, homeDir: string = homedir()): string[] {
  // W1-13: the resolved config dir first, then the legacy hidden-home models
  // dir (models downloaded there before a ROX_CONFIG_DIR override or a
  // pre-existing ~/rox keep being detected — same list as before W1-13).
  const dirs = [join(configDir, 'models'), join(homeDir, ROX_HIDDEN_HOME_LINK_NAME, 'models')]
  return [...new Set(dirs)]
}

export function detectEngine(configDir: string): LocalAsrEngine {
  const prefs = loadVoicePrefs(configDir)
  if (prefs.sttEngine === 'cloud-rox') {
    const configured = Boolean(getServerServiceKey('DEEPGRAM_API_KEY'))
    const missing = [!configured && 'deepgram-not-configured', (!prefs.cloudAsrConsent || prefs.privacyMigrationPending) && 'cloud-consent'].filter((value): value is string => Boolean(value))
    return { ready: missing.length === 0, engine: 'deepgram', model: process.env.DEEPGRAM_MODEL?.trim() || DEEPGRAM_TRANSCRIPTION_MODEL,
      binary: null, modelPath: null, ffmpeg: findBinary(['ffmpeg']), missing, cloudAvailable: configured }
  }
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
  const { promise, resolve } = Promise.withResolvers<RunResult>()
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let settled = false
  const onAbort = () => {
    if (!settled) child.kill('SIGTERM')
  }
  const finish = (result: RunResult) => {
    if (settled) return
    settled = true
    options.signal?.removeEventListener('abort', onAbort)
    resolve(result)
  }
  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener('abort', onAbort, { once: true })
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
  child.on('error', (error) => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }))
  child.on('close', (code) => finish({ code, stdout, stderr }))
  return promise
}

/** Duration in ms via ffprobe (next to ffmpeg); null when unknown. */
export async function probeDurationMs(ffmpeg: string | null, file: string, signal?: AbortSignal): Promise<number | null> {
  if (!ffmpeg) return null
  const ffprobe = join(ffmpeg, '..', 'ffprobe')
  if (!existsSync(ffprobe)) return null
  const res = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { signal })
  const seconds = Number.parseFloat(res.stdout.trim())
  return res.code === 0 && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
}

/** Remux a MediaRecorder stream so the container carries a duration and cues. */
export async function remuxAudio(ffmpeg: string | null, input: string, output: string): Promise<boolean> {
  if (!ffmpeg) return false
  const res = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-c', 'copy', output])
  return res.code === 0 && existsSync(output) && statSync(output).size > 0
}

export async function decodeToWav(ffmpeg: string, input: string, output: string, signal?: AbortSignal): Promise<RunResult> {
  return run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output], { signal })
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
