import { describe, expect, it } from 'bun:test'
import { requestOpenNotebook, takeOpenNotebookIntent } from '../notebook-store'

describe('notebook open intent', () => {
  it('is one-shot', () => {
    requestOpenNotebook('a')
    expect(takeOpenNotebookIntent()).toBe('a')
    expect(takeOpenNotebookIntent()).toBeNull()
  })
})
