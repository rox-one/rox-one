import { createSeIcon } from './createSeIcon'

/** Workspace branch glyph (spec §4). Path geometry: Lucide git-branch (ISC). */
export const GitBranch = createSeIcon(
  'SeGitBranch',
  <>
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </>,
)
