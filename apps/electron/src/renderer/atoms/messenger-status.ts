import { atom } from 'jotai'

/** Open team-messenger channel for the status bar; null when the messenger is not mounted. */
export interface MessengerStatus {
  channelLabel: string
  unreadTotal: number
  callLive: boolean
}

export const messengerStatusAtom = atom<MessengerStatus | null>(null)
