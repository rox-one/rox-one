import { useCallback, useEffect, useState } from 'react'
import { meetingCaptureCapability } from '@craft-agent/shared/meeting-agents'
import { RPC_CHANNELS } from '../../../shared/types'
import { MeetingsPage } from './MeetingsPage'
import type { ProposalInboxItem } from './proposal-inbox-model'
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

type ExportBundle = {
  title?: string
  transcript?: string
  notes?: Array<{ audience?: string; text?: string }>
}

export type MeetingsWorkspaceProps = {
  workspaceId: string | null
}

function formatExport(bundle: ExportBundle, format: 'json' | 'markdown'): string {
  if (format === 'json') return JSON.stringify(bundle, null, 2)
  const notes = (bundle.notes ?? []).map((note) => `- ${note.text ?? ''}`).join('\n')
  return [`# ${bundle.title ?? ''}`, bundle.transcript ?? '', notes].filter(Boolean).join('\n')
}

export default function MeetingsWorkspace({ workspaceId }: MeetingsWorkspaceProps) {
  const [items, setItems] = useState<MeetingPageItem[]>([])
  const [state, setState] = useState<MeetingPageState>('empty')
  const [selected, setSelected] = useState<MeetingPageItem | undefined>()
  const [captureState, setCaptureStatus] = useState<string | undefined>()
  const [proposals, setProposals] = useState<ProposalInboxItem[]>([])
  const [actionStatus, setActionStatus] = useState<'deleted' | 'exported' | 'shared' | 'revoked' | 'denied' | 'private-excluded' | undefined>()

  const applyList = useCallback((listed: ListResult) => {
    const nextItems = (listed.items ?? []).map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      transcript: meeting.transcript,
      manualNotes: meeting.manualNotes,
      incomplete: meeting.incomplete,
    }))
    setItems(nextItems)
    setSelected((current) => nextItems.find((item) => item.id === current?.id) ?? nextItems[0])
    setState(listed.state ?? (nextItems.length === 0 ? 'empty' : 'ready'))
  }, [])

  const load = useCallback(async () => {
    const api = window.electronAPI
    if (!workspaceId || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.LIST)) {
      setItems([])
      setState('empty')
      return
    }
    try {
      const listed = await api.listMeetings(workspaceId) as ListResult
      applyList(listed)
      if (api.isChannelAvailable?.(RPC_CHANNELS.meetingProposals.LIST)) {
        const listedProposals = await api.listMeetingProposals(workspaceId) as { items?: ProposalInboxItem[] }
        setProposals(listedProposals.items ?? [])
      }
    } catch {
      setItems([])
      setState('offline')
    }
  }, [workspaceId, applyList])

  useEffect(() => {
    void load()
  }, [load])

  const onStart = useCallback(async () => {
    const api = window.electronAPI
    const webui = Boolean((import.meta as { env?: { IS_WEBUI?: boolean } }).env?.IS_WEBUI)
    const capability = meetingCaptureCapability({
      isWebui: webui,
      hasDeviceIpc: Boolean(api?.startMeetingCapture),
    })
    if (!capability.supported) {
      setCaptureStatus('unsupported')
      if (workspaceId && selected && api?.isChannelAvailable?.(RPC_CHANNELS.meetings.START)) {
        await api.startMeeting(workspaceId, selected.id, { capture: 'web-unsupported' })
      }
      return
    }
    if (!api?.startMeetingCapture) {
      setCaptureStatus('denied')
      return
    }
    const status = await api.startMeetingCapture({ mic: true, system: false }) as CaptureStatus
    setCaptureStatus(status.state)
    if (workspaceId && selected && api.isChannelAvailable?.(RPC_CHANNELS.meetings.START)) {
      await api.startMeeting(workspaceId, selected.id, { capture: 'device-ipc' })
    }
  }, [workspaceId, selected])

  const onSearch = useCallback(async (query: string) => {
    const api = window.electronAPI
    if (!workspaceId || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.SEARCH)) return
    const listed = await api.searchMeetings(workspaceId, query) as ListResult
    if (listed.state === 'denied') {
      setItems([])
      setState('denied')
      setActionStatus('denied')
      return
    }
    applyList(listed)
  }, [workspaceId, applyList])

  const onDelete = useCallback(async () => {
    const api = window.electronAPI
    if (!workspaceId || !selected || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.DELETE)) return
    await api.deleteMeeting(workspaceId, selected.id)
    setActionStatus('deleted')
    await load()
  }, [workspaceId, selected, load])

  const onExport = useCallback(async (format: 'json' | 'markdown') => {
    const api = window.electronAPI
    if (!workspaceId || !selected || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.EXPORT)) return
    const bundle = await api.exportMeeting(workspaceId, selected.id, { format, audience: 'shared' }) as ExportBundle
    const text = formatExport(bundle, format)
    if (bundle.notes?.some((note) => note.audience === 'private')) {
      setActionStatus('private-excluded')
    } else {
      setActionStatus('exported')
    }
    await navigator.clipboard?.writeText(text).catch(() => {})
  }, [workspaceId, selected])

  const onShare = useCallback(async (accountId: string) => {
    const api = window.electronAPI
    if (!workspaceId || !selected || !accountId || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.SHARE)) return
    await api.shareMeeting(workspaceId, selected.id, { accountId })
    setActionStatus('shared')
  }, [workspaceId, selected])

  const onRevokeShare = useCallback(async (accountId: string) => {
    const api = window.electronAPI
    if (!workspaceId || !selected || !accountId || !api?.isChannelAvailable?.(RPC_CHANNELS.meetings.REVOKE_SHARE)) return
    await api.revokeMeetingShare(workspaceId, selected.id, { accountId })
    setActionStatus('revoked')
  }, [workspaceId, selected])

  const proposalHandlers = workspaceId ? {
    onApprove: (request: { proposalId: string; payloadHash: string; baseRevision: number }) => {
      void window.electronAPI.approveMeetingProposal(workspaceId, {
        proposalId: request.proposalId,
        payloadHash: request.payloadHash,
        expectedRevision: request.baseRevision,
      }).then(() => load())
    },
    onReject: (proposalId: string) => {
      void window.electronAPI.rejectMeetingProposal(workspaceId, { proposalId }).then(() => load())
    },
    onEdit: (_proposalId: string, _payload: Record<string, unknown>) => {},
    onClarify: (proposalId: string) => {
      void window.electronAPI.clarifyMeetingProposal(workspaceId, { proposalId }).then(() => load())
    },
  } : undefined

  return (
    <MeetingsPage
      items={items}
      state={state}
      selected={selected}
      proposals={proposals}
      proposalHandlers={proposalHandlers}
      onStart={() => { void onStart() }}
      onSearch={onSearch}
      onSelect={(id) => setSelected(items.find((item) => item.id === id))}
      onDelete={() => { void onDelete() }}
      onExport={(format) => { void onExport(format) }}
      onShare={(accountId) => { void onShare(accountId) }}
      onRevokeShare={(accountId) => { void onRevokeShare(accountId) }}
      actionStatus={actionStatus}
      captureState={captureState}
    />
  )
}
