/**
 * Live call in a team channel / group chat over LiveKit.
 *
 * teamChat:callJoin checks channel membership on the host and returns a
 * short-lived token minted locally (the LiveKit secret never reaches the
 * renderer). Media: mic, camera, screen share. Transcription: each
 * participant transcribes *their own* microphone through the existing Rox
 * voice ASR (window.electronAPI.transcribeVoice, the user's engine + consent)
 * in short chunks and appends the segments to the call; the host folds them
 * into a transcript message and an AI summary when the last person leaves.
 */
import * as React from 'react'
import { Room, RoomEvent, Track, type Participant } from 'livekit-client'
import type { TeamCallTranscriptSegment, TeamChannelCall } from '@rox/shared/team-chat'

export const TRANSCRIBE_CHUNK_MS = 15_000

export interface CallParticipantView {
  identity: string
  name: string
  isLocal: boolean
  speaking: boolean
  micOn: boolean
  cameraOn: boolean
  screenOn: boolean
}

export interface TeamCallState {
  status: 'idle' | 'connecting' | 'connected' | 'error'
  channelId: string | null
  call: TeamChannelCall | null
  participants: CallParticipantView[]
  micOn: boolean
  cameraOn: boolean
  screenOn: boolean
  transcribing: boolean
  error: string | null
}

const IDLE: TeamCallState = { status: 'idle', channelId: null, call: null, participants: [], micOn: false, cameraOn: false, screenOn: false, transcribing: false, error: null }

function view(p: Participant, isLocal: boolean): CallParticipantView {
  const pub = (s: Track.Source) => p.getTrackPublication(s)
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isLocal,
    speaking: p.isSpeaking,
    micOn: !!pub(Track.Source.Microphone) && !pub(Track.Source.Microphone)!.isMuted,
    cameraOn: !!pub(Track.Source.Camera) && !pub(Track.Source.Camera)!.isMuted,
    screenOn: !!pub(Track.Source.ScreenShare),
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Chunked MediaRecorder over the local mic track → Rox ASR → call transcript. */
function startOwnMicTranscription(opts: {
  track: MediaStreamTrack
  callStartedAt: number
  speakerId: string
  speakerName: string
  push: (segments: TeamCallTranscriptSegment[]) => Promise<unknown>
  isMuted: () => boolean
}): () => Promise<void> {
  const pending = new Set<Promise<void>>()
  let stopped = false
  let recorder: MediaRecorder | null = null
  const stream = new MediaStream([opts.track])
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
  const cycle = () => {
    if (stopped) return
    const startedAt = Date.now()
    const chunks: Blob[] = []
    const muted = opts.isMuted()
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recorder = rec
    const timer = setTimeout(() => { if (rec.state === 'recording') rec.stop() }, TRANSCRIBE_CHUNK_MS)
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      clearTimeout(timer)
      const endedAt = Date.now()
      if (!stopped) cycle()
      if (muted || !chunks.length) return
      const job = (async () => {
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })
          const result = await window.electronAPI.transcribeVoice({ audioBase64: await blobToBase64(blob), mimeType: blob.type })
          const text = result.text?.trim()
          if (!text || result.noSpeech) return
          await opts.push([{ speakerId: opts.speakerId, speakerName: opts.speakerName, text,
            startMs: Math.max(0, startedAt - opts.callStartedAt), endMs: Math.max(0, endedAt - opts.callStartedAt) }])
        } catch {
          // ASR unavailable / consent declined: the call goes on without this chunk.
        }
      })()
      pending.add(job)
      void job.finally(() => pending.delete(job))
    }
    rec.start()
  }
  cycle()
  /** Stops recording, flushes the last chunk and waits (≤ 30 s) for in-flight ASR to land. */
  return async () => {
    stopped = true
    if (recorder?.state === 'recording') {
      const r = recorder
      await new Promise<void>(resolve => { r.addEventListener('stop', () => setTimeout(resolve, 0), { once: true }); r.stop() })
    }
    await Promise.race([Promise.allSettled([...pending]), new Promise(resolve => setTimeout(resolve, 30_000))])
  }
}

export function useTeamCall(opts: { selfName: string; autoTranscribe?: boolean }) {
  const [state, setState] = React.useState<TeamCallState>(IDLE)
  const roomRef = React.useRef<Room | null>(null)
  const stopAsr = React.useRef<(() => Promise<void>) | null>(null)
  const channelRef = React.useRef<string | null>(null)
  /** Bumped by every join/leave; a join that is no longer current bails out after each await. */
  const generation = React.useRef(0)

  const refresh = React.useCallback(() => {
    const room = roomRef.current
    if (!room) return
    const local = room.localParticipant
    const participants = [view(local, true), ...[...room.remoteParticipants.values()].map(p => view(p, false))]
    setState(prev => ({ ...prev, participants, micOn: local.isMicrophoneEnabled, cameraOn: local.isCameraEnabled, screenOn: local.isScreenShareEnabled }))
  }, [])

  const leave = React.useCallback(async () => {
    generation.current++
    const channelId = channelRef.current
    const flush = stopAsr.current
    stopAsr.current = null
    const room = roomRef.current
    roomRef.current = null
    channelRef.current = null
    setState(IDLE)
    if (room) await room.disconnect().catch(() => {})
    // The last ASR chunk must land before the host closes the call and posts the transcript.
    await flush?.().catch(() => {})
    if (channelId) await window.electronAPI.teamChatCallLeave(channelId).catch(() => {})
  }, [])

  const join = React.useCallback(async (channelId: string) => {
    if (roomRef.current || channelRef.current) await leave()
    const gen = ++generation.current
    const stale = () => gen !== generation.current
    channelRef.current = channelId
    setState({ ...IDLE, status: 'connecting', channelId })
    try {
      const { call, url, token } = await window.electronAPI.teamChatCallJoin(channelId, opts.selfName)
      if (stale()) { void window.electronAPI.teamChatCallLeave(channelId).catch(() => {}); return }
      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room
      const sync = () => {
        refresh()
        const ids = [room.localParticipant.identity, ...room.remoteParticipants.keys()]
        void window.electronAPI.teamChatCallSync(channelId, ids).catch(() => {})
      }
      room
        .on(RoomEvent.ParticipantConnected, sync)
        .on(RoomEvent.ParticipantDisconnected, sync)
        .on(RoomEvent.TrackPublished, refresh)
        .on(RoomEvent.TrackUnpublished, refresh)
        .on(RoomEvent.TrackMuted, refresh)
        .on(RoomEvent.TrackUnmuted, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.LocalTrackUnpublished, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) { const el = track.attach(); el.dataset.roxCallAudio = channelId; document.body.appendChild(el) }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach(el => el.remove()) })
        .on(RoomEvent.Disconnected, () => { if (roomRef.current === room) void leave() })
      await room.connect(url, token)
      if (stale()) { await room.disconnect().catch(() => {}); return }
      await room.localParticipant.setMicrophoneEnabled(true)
      if (stale()) { await room.disconnect().catch(() => {}); return }
      setState(prev => ({ ...prev, status: 'connected', call }))
      sync()
      const micTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
      if (micTrack && opts.autoTranscribe !== false && typeof MediaRecorder !== 'undefined') {
        stopAsr.current = startOwnMicTranscription({
          track: micTrack,
          callStartedAt: call.startedAt,
          speakerId: room.localParticipant.identity,
          speakerName: opts.selfName,
          push: segments => window.electronAPI.teamChatCallTranscript(channelId, call.id, segments),
          isMuted: () => !room.localParticipant.isMicrophoneEnabled,
        })
        setState(prev => ({ ...prev, transcribing: true }))
      }
    } catch (error) {
      if (stale()) return
      roomRef.current?.disconnect().catch(() => {})
      roomRef.current = null
      setState({ ...IDLE, status: 'error', channelId, error: error instanceof Error ? error.message.replace(/^.*?Error:\s*/s, '') : String(error) })
      void window.electronAPI.teamChatCallLeave(channelId).catch(() => {})
      channelRef.current = null
    }
  }, [leave, opts.autoTranscribe, opts.selfName, refresh])

  const toggle = React.useCallback(async (what: 'mic' | 'camera' | 'screen') => {
    const lp = roomRef.current?.localParticipant
    if (!lp) return
    try {
      if (what === 'mic') await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)
      else if (what === 'camera') await lp.setCameraEnabled(!lp.isCameraEnabled)
      else await lp.setScreenShareEnabled(!lp.isScreenShareEnabled)
    } catch (error) {
      setState(prev => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
    }
    refresh()
  }, [refresh])

  React.useEffect(() => () => { void leave() }, [leave])

  const videoTracks = React.useCallback(() => {
    const room = roomRef.current
    if (!room) return []
    const all = [room.localParticipant, ...room.remoteParticipants.values()]
    return all.flatMap(p => [...p.videoTrackPublications.values()].filter(pub => pub.track).map(pub => ({ identity: p.identity, name: p.name || p.identity, source: pub.source, track: pub.track! })))
  }, [])

  return { ...state, join, leave, toggle, videoTracks }
}

/** mm:ss / h:mm:ss since `startedAt`, ticking every second. */
export function useCallTimer(startedAt: number | undefined): string {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (!startedAt) return '0:00'
  return formatCallDuration(now - startedAt)
}

export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
