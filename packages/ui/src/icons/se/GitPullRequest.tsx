import { createSeIcon } from './createSeIcon'

/** Workspace PR / dirty glyph (spec §4). Path geometry: Lucide git-pull-request (ISC). */
export const GitPullRequest = createSeIcon(
  'SeGitPullRequest',
  <>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <line x1="6" x2="6" y1="9" y2="21" />
  </>,
)
