import { atomWithStorage } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'

/** Floating SE chat surface (in-app PiP); opt-in via View action. */
export const seChatPipOpenAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.seChatPipOpen),
  false,
)
