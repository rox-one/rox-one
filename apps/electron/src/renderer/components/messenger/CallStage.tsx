/** In-call strip for the open channel: video / screen tiles and mic, camera, screen, leave controls. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff, MonitorUp, PhoneOff, ScrollText, Video, VideoOff } from 'lucide-react'
import { Track } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'
import { Avatar } from './ChannelInfoPanel'
import { useCallTimer, type useTeamCall } from './use-team-call'

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}

function VideoTile({ track, name, screen }: { track: Track; name: string; screen: boolean }) {
  const ref = React.useRef<HTMLVideoElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => { track.detach(el) }
  }, [track])
  return (
    <figure className={cn('relative overflow-hidden rounded-md bg-black', screen ? 'h-48 aspect-video' : 'h-32 aspect-video')}>
      <video ref={ref} autoPlay playsInline muted className="size-full object-contain" />
      <figcaption className="absolute bottom-1 start-1 rounded bg-black/60 px-1.5 text-caption text-white">{name}</figcaption>
    </figure>
  )
}

export function CallStage({ call }: { call: ReturnType<typeof useTeamCall> }) {
  const { t } = useTranslation()
  const timer = useCallTimer(call.call?.startedAt)
  const tiles = call.videoTracks()
  return (
    <div className="shrink-0 border-b border-border/60 bg-surface-raised px-4 py-2" data-testid="messenger-call-stage">
      {tiles.length ? (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {tiles.map(v => <VideoTile key={`${v.identity}-${v.source}`} track={v.track} name={v.name} screen={v.source === Track.Source.ScreenShare} />)}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-small text-success"><span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden /><time className="tabular-nums">{timer}</time></span>
        <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {call.participants.map(p => (
            <li key={p.identity} title={p.name} className={cn('rounded-full ring-2', p.speaking ? 'ring-success' : 'ring-transparent')}>
              <Avatar name={p.name} className="size-6" />
            </li>
          ))}
        </ul>
        {call.transcribing ? <Tip label={t('messenger.calls.transcribingHint')}><span tabIndex={0} className="flex items-center gap-1 text-caption text-text-muted"><ScrollText className="icon-caption" aria-hidden />{t('messenger.calls.transcribing')}</span></Tip> : null}
        <Tip label={call.micOn ? t('messenger.calls.mute') : t('messenger.calls.unmute')}><Button size="icon" variant={call.micOn ? 'secondary' : 'destructive'} onClick={() => void call.toggle('mic')} aria-pressed={!call.micOn} aria-label={call.micOn ? t('messenger.calls.mute') : t('messenger.calls.unmute')}>
          {call.micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        </Button></Tip>
        <Tip label={t('messenger.calls.camera')}><Button size="icon" variant="secondary" onClick={() => void call.toggle('camera')} aria-pressed={call.cameraOn} aria-label={t('messenger.calls.camera')}>
          {call.cameraOn ? <Video aria-hidden /> : <VideoOff aria-hidden />}
        </Button></Tip>
        <Tip label={t('messenger.calls.screen')}><Button size="icon" variant={call.screenOn ? 'default' : 'secondary'} onClick={() => void call.toggle('screen')} aria-pressed={call.screenOn} aria-label={t('messenger.calls.screen')}>
          <MonitorUp aria-hidden />
        </Button></Tip>
        <Button size="sm" variant="destructive" onClick={() => void call.leave()}><PhoneOff aria-hidden />{t('messenger.calls.leave')}</Button>
      </div>
      {call.error ? <p className="pt-1 text-caption text-destructive" role="alert">{call.error}</p> : null}
    </div>
  )
}
