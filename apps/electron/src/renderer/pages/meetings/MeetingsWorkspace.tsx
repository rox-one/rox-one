import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { meetingCaptureCapability, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { RPC_CHANNELS } from '../../../shared/types'
import { isWebUI } from '../../lib/platform'
import { buildMeetingCaptureGrant } from './capture-rpc'
import {
  listStateFromResult,
  toMeetingPageItems,
  type MeetingListResult,
  type MeetingPageItem,
  type MeetingPageState,
} from './meeting-page-model'

const START_CHANNEL = 'meetings:start'

type CaptureStatus = {
  state?: string
  error?: string
}

type MeetingsElectronApi = {
  isChannelAvailable?: (channel: string) => boolean
  listMeetings?: (workspaceId: string) => Promise<MeetingListResult>
  searchMeetings?: (workspaceId: string, query: string) => Promise<MeetingListResult>
  deleteMeeting?: (workspaceId: string, meetingId: string) => Promise<unknown>
  startMeeting?: (workspaceId: string, id: string, opts?: { capture?: string }) => Promise<unknown>
  startCapture?: (
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
  ) => Promise<{ meeting?: { status?: string } | null; error?: { code?: string } }>
  startMeetingCapture?: (input?: { mic?: boolean; system?: boolean }) => Promise<CaptureStatus>
}

function channelOpen(api: MeetingsElectronApi | undefined, channel: string): boolean {
  if (!api) return false
  if (!api.isChannelAvailable) return true
  return api.isChannelAvailable(channel)
}

async function writeCaptureFlag(
  api: MeetingsElectronApi | undefined,
  workspaceId: string | null,
  meetingId: string | undefined,
  capture: string,
): Promise<void> {
  if (!workspaceId || !meetingId || !api?.startMeeting) return
  if (!channelOpen(api, START_CHANNEL)) return
  await api.startMeeting(workspaceId, meetingId, { capture })
}

export type MeetingsWorkspaceProps = {
  workspaceId: string | null
  actorId?: string
}

export default function MeetingsWorkspace({
  workspaceId,
  actorId = 'local-actor',
}: MeetingsWorkspaceProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<MeetingPageItem[]>([])
  const [state, setState] = useState<MeetingPageState>('empty')
  const [selected, setSelected] = useState<MeetingPageItem | undefined>()
  const [captureState, setCaptureStatus] = useState<string | undefined>()

  const load = useCallback(async () => {
    const api = window.electronAPI as MeetingsElectronApi | undefined
    if (!workspaceId || !api?.listMeetings || !channelOpen(api, RPC_CHANNELS.meetings.LIST)) {
      setItems([])
      setState('empty')
      return
    }
    try {
      const listed = await api.listMeetings(workspaceId)
      const nextItems = toMeetingPageItems(listed)
      setItems(nextItems)
      setSelected(nextItems[0])
      setState(listStateFromResult(listed, nextItems.length))
    } catch {
      setItems([])
      setState('offline')
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const onStart = useCallback(async () => {
    const api = window.electronAPI as MeetingsElectronApi | undefined
    const capability = meetingCaptureCapability({
      isWebui: isWebUI,
      hasDeviceIpc: Boolean(api?.startCapture ?? api?.startMeetingCapture),
    })
    if (!capability.supported) {
      if (capability.code === 'web-unsupported') {
        setCaptureStatus('unsupported')
        await writeCaptureFlag(api, workspaceId, selected?.id, 'web-unsupported')
        return
      }
      setCaptureStatus('denied')
      return
    }
    if (!api?.startCapture && !api?.startMeetingCapture) {
      setCaptureStatus('denied')
      return
    }
    if (api.startCapture) {
      if (!workspaceId || !selected) return
      const grant = buildMeetingCaptureGrant({ workspaceId, actorId })
      const result = await api.startCapture(workspaceId, selected.id, actorId, grant)
      setCaptureStatus(result.error?.code ?? result.meeting?.status ?? 'ok')
      await writeCaptureFlag(api, workspaceId, selected.id, 'device-ipc')
      return
    }
    const status = await api.startMeetingCapture?.({ mic: true, system: false })
    setCaptureStatus(status?.state)
    await writeCaptureFlag(api, workspaceId, selected?.id, 'device-ipc')
  }, [actorId, selected, workspaceId])

  const onSearch = useCallback(async (query: string) => {
    const api = window.electronAPI as MeetingsElectronApi | undefined
    if (!workspaceId || !api?.searchMeetings || !channelOpen(api, RPC_CHANNELS.meetings.SEARCH)) return
    const listed = await api.searchMeetings(workspaceId, query)
    if (listed.state === 'denied' || listed.denied) {
      setItems([])
      setState('denied')
      return
    }
    const nextItems = toMeetingPageItems(listed)
    setItems(nextItems)
    setSelected(nextItems[0])
  }, [workspaceId])

  const onDelete = useCallback(async () => {
    const api = window.electronAPI as MeetingsElectronApi | undefined
    if (!workspaceId || !selected || !api?.deleteMeeting || !channelOpen(api, RPC_CHANNELS.meetings.DELETE)) return
    await api.deleteMeeting(workspaceId, selected.id)
    await load()
  }, [load, selected, workspaceId])

  return (
    <div className="flex min-h-0 flex-col" data-testid="meetings-workspace">
      <header className="flex items-center gap-2 px-3 py-2">
        <input
          data-testid="meetings-search"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder={t('meetings.search')}
          onChange={(event) => {
            void onSearch(event.target.value)
          }}
        />
        <button
          type="button"
          data-testid="meetings-start"
          className="rounded-md border border-border px-2 py-1 text-xs"
          onClick={() => { void onStart() }}
        >
          {t('meetings.start')}
        </button>
        {captureState ? (
          <p className="text-xs" data-testid="meetings-capture-status">
            {captureState}
          </p>
        ) : null}
        {selected ? (
          <button
            type="button"
            data-testid="meetings-delete"
            className="rounded-md border border-border px-2 py-1 text-xs"
            onClick={() => { void onDelete() }}
          >
            delete
          </button>
        ) : null}
      </header>
      {state === 'denied' ? (
        <p className="p-3 text-sm" data-testid="meetings-denied">denied</p>
      ) : state === 'offline' ? (
        <p className="p-3 text-sm" data-testid="meetings-offline">offline</p>
      ) : state === 'empty' ? (
        <p className="p-3 text-sm text-muted-foreground" data-testid="meetings-empty">{t('meetings.empty')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <ul className="text-sm">
            {items.map((meeting) => (
              <li key={meeting.id} data-testid="meeting-row">{meeting.title}</li>
            ))}
          </ul>
          {selected?.incomplete ? (
            <p data-testid="meetings-incomplete">incomplete</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
