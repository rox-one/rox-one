import { useEffect, useState } from 'react'

/**
 * Real microphone loudness (0..1, smoothed) for an active capture stream.
 *
 * Mirrors the meeting recorder meter: RMS over the time domain mapped through a
 * perceptual -60..0 dB window. The audio graph is created per capture and torn
 * down on stop; a missing WebAudio API degrades to a flat level instead of
 * breaking the recording flow.
 */
export function useMicrophoneLevel(stream: MediaStream | null, active: boolean): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!stream || !active) {
      setLevel(0)
      return
    }
    let ctx: AudioContext | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      let smooth = 0
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i += 1) sum += buf[i]! * buf[i]!
        const rms = Math.sqrt(sum / buf.length)
        const db = 20 * Math.log10(Math.max(rms, 1e-6))
        const value = Math.min(1, Math.max(0, (db + 60) / 60))
        smooth = value > smooth ? value : smooth * 0.8 + value * 0.2
        const rounded = Math.round(smooth * 100) / 100
        setLevel(rounded)
        // Fan the same real level out to the mini-overlay wave (~10 Hz). The
        // host drops it unless its own capture is recording.
        void window.electronAPI.sendVoiceLevel?.({ level: rounded })?.catch(() => {})
      }, 100)
    } catch {
      // The meter is an indicator only; keep dictation working without it.
      setLevel(0)
    }
    return () => {
      clearInterval(timer)
      void ctx?.close().catch(() => {})
    }
  }, [stream, active])

  return level
}