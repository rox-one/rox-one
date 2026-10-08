import { atom } from 'jotai'
export const windowWorkspaceIdAtom = atom<string | null>(null)
export const sessionMetaMapAtom = atom(new Map<string, { id: string; workspaceId: string; name: string; hasUnread: boolean; lastFinalMessageId: string; lastMessageAt: number; lastMessageRole: 'assistant' }>())
