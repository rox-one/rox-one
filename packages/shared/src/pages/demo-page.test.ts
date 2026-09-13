import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPage, loadPageContent, loadWorkspacePages } from './storage.ts'
import { DEMO_PAGE_HTML, DEMO_PAGE_NAME, ensureDemoPage } from './demo-page.ts'

describe('ensureDemoPage', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'rox-demo-page-'))
  })

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('creates a Getting started page when the workspace has none', () => {
    const created = ensureDemoPage(workspaceDir)
    expect(created?.name).toBe(DEMO_PAGE_NAME)
    expect(loadWorkspacePages(workspaceDir)).toHaveLength(1)
    expect(loadPageContent(workspaceDir, created!.slug)).toBe(DEMO_PAGE_HTML)
  })

  it('does not add a second page when one already exists', () => {
    createPage(workspaceDir, { name: 'Mine', content: '<p>x</p>' })
    expect(ensureDemoPage(workspaceDir)).toBeNull()
    expect(loadWorkspacePages(workspaceDir)).toHaveLength(1)
    expect(loadWorkspacePages(workspaceDir)[0]?.config.name).toBe('Mine')
  })
})
