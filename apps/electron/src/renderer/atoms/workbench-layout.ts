import { atomWithStorage } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'

export type SeLeftSidebarLayout = 'compact' | 'detailed'

export const seLeftSidebarLayoutAtom = atomWithStorage<SeLeftSidebarLayout>(
  getKeyString(KEYS.seLeftSidebarLayout),
  'compact',
  undefined,
  { getOnInit: true },
)

export const seAutoHideSidebarsAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.seAutoHideSidebars),
  false,
  undefined,
  { getOnInit: true },
)
