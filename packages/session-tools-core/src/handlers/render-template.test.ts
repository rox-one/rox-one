import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionToolContext } from '../context.ts'
import { handleRenderTemplate } from './render-template.ts'

describe('render_template path containment', () => {
  let rootDir: string
  let sessionDir: string
  let dataDir: string
  let sourceDir: string

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'render-template-'))
    sessionDir = join(rootDir, 'session')
    dataDir = join(sessionDir, 'data')
    sourceDir = join(rootDir, 'sources', 'linear')
    mkdirSync(join(sourceDir, 'templates'), { recursive: true })
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(
      join(sourceDir, 'templates', 'issue.html'),
      '<!--\n  @template issue\n  @name Issue\n  @description x\n-->\n<p>{{title}}</p>\n',
    )
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  function ctx(): SessionToolContext {
    return {
      sessionId: 'test-session',
      workspacePath: rootDir,
      sourcesPath: join(rootDir, 'sources'),
      skillsPath: join(rootDir, 'skills'),
      plansFolderPath: join(sessionDir, 'plans'),
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
      },
      fs: {
        exists: () => false,
        readFile: () => '',
        readFileBuffer: () => Buffer.from(''),
        writeFile: () => {},
        isDirectory: () => false,
        readdir: () => [],
        stat: () => ({ size: 0, isDirectory: () => false }),
      },
      loadSourceConfig: () => null,
      sessionPath: sessionDir,
      dataPath: dataDir,
    }
  }

  it('rejects source identifiers that escape the sources directory', async () => {
    const result = await handleRenderTemplate(ctx(), {
      source: '../../../etc',
      template: 'passwd',
      data: {},
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Invalid source identifier')
  })

  it('rejects template ids that traverse', async () => {
    const result = await handleRenderTemplate(ctx(), {
      source: 'linear',
      template: '../../../secret',
      data: { title: 'x' },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not found')
  })

  it('renders a valid source/template pair', async () => {
    const result = await handleRenderTemplate(ctx(), {
      source: 'linear',
      template: 'issue',
      data: { title: 'Hello' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]?.text).toContain('Output:')
  })
})
