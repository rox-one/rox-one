import { describe, expect, test } from 'bun:test'
import { newProjectNoteFolder, noteCreationFolder, noteInProjectScope, projectNoteScope } from '../project-note-scope'

const projects = [{ id: 'a', slug: 'research', name: 'Research' }, { id: 'b', slug: 'research-next', name: 'Next' }]

describe('notes workspace project scope', () => {
  test('all-project scope includes workspace notes; a selected project uses its real folder path', () => {
    const all = projectNoteScope(undefined, projects)
    const selected = projectNoteScope('a', projects)
    expect(noteInProjectScope('daily/2026-10-04', all)).toBe(true)
    expect(noteInProjectScope('projects/research/plan', selected)).toBe(true)
    expect(noteInProjectScope('projects/research/subfolder/plan', selected)).toBe(true)
    expect(noteInProjectScope('projects/research-next/plan', selected)).toBe(false)
    expect(noteInProjectScope('daily/2026-10-04', selected)).toBe(false)
  })

  test('unavailable or malformed projects fail closed during loading or deletion', () => {
    for (const scope of [projectNoteScope('deleted', projects), projectNoteScope('a', []), projectNoteScope('a', [{ id: 'a', slug: '../other', name: 'Invalid' }])]) {
      expect(scope.kind).toBe('unavailable')
      expect(noteInProjectScope('projects/research/plan', scope)).toBe(false)
      expect(noteCreationFolder(scope).allowed).toBe(false)
      expect(newProjectNoteFolder(scope, 'new').allowed).toBe(false)
    }
  })

  test('new notes default to the selected project and never silently relocate explicit destinations', () => {
    const scope = projectNoteScope('a', projects)
    expect(noteCreationFolder(scope)).toEqual({ allowed: true, folder: 'projects/research' })
    expect(noteCreationFolder(scope, 'projects/research/nested')).toEqual({ allowed: true, folder: 'projects/research/nested' })
    expect(noteCreationFolder(scope, 'projects/research-next')).toEqual({ allowed: false })
    expect(noteCreationFolder(scope, 'projects')).toEqual({ allowed: false })
    expect(noteCreationFolder(scope, 'projects/research/../other')).toEqual({ allowed: false })
  })

  test('relative new folders belong to the selected project while all-project folders remain explicit', () => {
    expect(newProjectNoteFolder(projectNoteScope('a', projects), 'nested/review')).toEqual({ allowed: true, folder: 'projects/research/nested/review' })
    expect(newProjectNoteFolder(projectNoteScope('a', projects), 'projects/research/nested')).toEqual({ allowed: true, folder: 'projects/research/nested' })
    expect(newProjectNoteFolder(projectNoteScope('a', projects), 'projects/research-next')).toEqual({ allowed: false })
    expect(newProjectNoteFolder(projectNoteScope(undefined, projects), 'reference')).toEqual({ allowed: true, folder: 'reference' })
  })
})
