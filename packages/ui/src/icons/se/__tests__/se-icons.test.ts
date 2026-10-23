import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CircleCheck,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  SE_ICON_LAYER_VERSION,
  SE_ICON_STROKE,
} from '../index'

const dir = join(import.meta.dir, '..')

describe('SE icons v2 extract (packages/ui/src/icons/se)', () => {
  it('ships layer version 2 with SE stroke 1.5', () => {
    expect(SE_ICON_LAYER_VERSION).toBe(2)
    expect(SE_ICON_STROKE).toBe(1.5)
  })

  it('exports workspace nav glyphs from spec §4', () => {
    expect(FolderGit2.displayName).toBe('SeFolderGit2')
    expect(GitBranch.displayName).toBe('SeGitBranch')
    expect(GitPullRequest.displayName).toBe('SeGitPullRequest')
    expect(CircleCheck.displayName).toBe('SeCircleCheck')
  })

  it('keeps createSeIcon default stroke at 1.5 in source', () => {
    const src = readFileSync(join(dir, 'createSeIcon.tsx'), 'utf8')
    expect(src).toContain('export const SE_ICON_STROKE = 1.5')
    expect(src).toContain('strokeWidth={strokeWidth ?? SE_ICON_STROKE}')
  })

  it('directory extract is present', () => {
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(dir, 'index.ts'))).toBe(true)
  })
})
