/**
 * Audio transcript actions — shared UI contract for retrying speech-to-text on
 * a stored audio attachment.
 *
 * The UI package must not reach into the host (Electron) transport, so the
 * renderer supplies a `retry` implementation through this context. When no
 * provider is mounted (e.g. the read-only web viewer) the retry affordance is
 * hidden and only the stored transcript state is shown.
 */

import { createContext, type ReactNode } from 'react'
import type { AttachmentTranscript, StoredAttachment } from '@rox/core'

export interface AudioTranscriptContext {
  sessionId?: string
  messageId?: string
}

export type AudioTranscriptRetry = (
  attachment: StoredAttachment,
  context: AudioTranscriptContext,
) => Promise<AttachmentTranscript | null>

export interface AudioTranscriptActions {
  /** Re-run ASR for a stored audio attachment. Absent when unsupported. */
  retry?: AudioTranscriptRetry
}

const AudioTranscriptActionsContext = createContext<AudioTranscriptActions>({})

/** Consumed directly with `useContext` at the call site. */
export { AudioTranscriptActionsContext }

export function AudioTranscriptActionsProvider({
  actions,
  children,
}: {
  actions: AudioTranscriptActions
  children: ReactNode
}) {
  return (
    <AudioTranscriptActionsContext.Provider value={actions}>
      {children}
    </AudioTranscriptActionsContext.Provider>
  )
}