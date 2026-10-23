import { createSeIcon } from './createSeIcon'

/** Workspace checks glyph (spec §4). Path geometry: Lucide circle-check (ISC). */
export const CircleCheck = createSeIcon(
  'SeCircleCheck',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </>,
)
