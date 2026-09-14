import { useCallback, useEffect, useState } from 'react'
import { RPC_CHANNELS } from '../../../shared/types'
import { MeetingsPage } from './MeetingsPage'
import type { MeetingPageItem, MeetingPageState } from './meeting-page-model'

type ListResult = {
  items?: Array<{
    id: string
    title: string
    transcript?: string
    manualNotes?: string
    incomplete?: boolean
  }>
  state?: MeetingPageState
}

type CaptureStatus = {
  state: string
  error?: string
}

export type MeetingsWorkspaceProps = {
  workspaceId: string | null
}

export default function MeetingsWorkspace({ workspaceId }: MeetingsWorkspaceProps) {
  const [items, setItems] = useState<MeetingPageItem[]>([])
  const [state, setState] = useState<MeetingPageState>('empty')
  const [selected, setSelected] = useState<MeetingPageItem | undefined>()
  const [captureState, setCaptureStatus] = useState<string | undefined>()

  const load = useCallback(async () => {
    const api = window.electronAPI
    if (!workspaceId || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.LIST)) {
      setItems([])
      setState('empty')
      return
    }
    try {
      const listed = await api.listMeetings(workspaceId) as ListResult
      const nextItems = (listed.items ?? []).map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
        transcript: meeting.transcript,
        manualNotes: meeting.manualNotes,
        incomplete: meeting.incomplete,
      }))
      setItems(nextItems)
      setSelected(nextItems[0])
      setState(listed.state ?? (nextItems.length === 0 ? 'empty' : 'ready'))
    } catch {
      setItems([])
      setState('offline')
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const onStart = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.startMeetingCapture) {
      setCaptureStatus('denied')
      return
    }
    const status = await api.startMeetingCapture({ mic: true, system: false }) as CaptureStatus
    setCaptureStatus(status.state)
  }, [])

  const onSearch = useCallback(async (query: string) => {
    const api = window.electronAPI
    if (!workspaceId || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.SEARCH)) return
    const listed = await api.searchMeetings(workspaceId, query) as ListResult
    if (listed.state === 'denied') {
      setItems([])
      setState('denied')
      return
    }
    setItems((listed.items ?? []).map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      transcript: meeting.transcript,
      manualNotes: meeting.manualNotes,
      incomplete: meeting.incomplete,
    })))
  }, [workspaceId])

  return (
    <MeetingsPage
      items={items}
      state={state}
      selected={selected}
      onStart={() => { void onStart() }}
      onSearch={onSearch}
      captureState={captureState}
    />
  )
}
