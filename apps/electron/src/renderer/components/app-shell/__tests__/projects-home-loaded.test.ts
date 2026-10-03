import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore, Provider } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { LoadedProject } from '@craft-agent/shared/projects/types'
import { projectsAtom } from '../../../atoms/projects'
import { ModalProvider } from '../../../context/ModalContext'
import { ProjectsHomeInMain } from '../ProjectsHomeInMain'

const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } })

function renderProjects(projects: LoadedProject[], suppliedProjects?: LoadedProject[], workspaceId = 'projects-test-workspace'): string {
  const store = createStore()
  store.set(projectsAtom, projects)
  return renderToStaticMarkup(createElement(
    Provider,
    { store },
    createElement(I18nextProvider, { i18n },
      createElement(ModalProvider, null,
        createElement(ProjectsHomeInMain, { workspaceId, projects: suppliedProjects }),
      ),
    ),
  ))
}

describe('Projects home loaded DTO boundary', () => {
  test('renders the loaded project store without the session-picker projection', () => {
    const project: LoadedProject = {
      config: {
        id: 'loaded-project', slug: 'loaded-project', name: 'Loaded project title',
        description: 'Loaded project description', createdAt: 1, updatedAt: 1,
      },
      folderPath: '/fixture/projects/loaded-project',
      assetsPath: '/fixture/projects/loaded-project/assets',
      workspaceRootPath: '/fixture', workspaceId: 'projects-test-workspace',
    }
    const html = renderProjects([project])
    expect(html).toContain('Loaded project title')
    expect(html).toContain('Loaded project description')
    expect(html).toContain('data-list-role="projects"')
  })

  test('renders an empty loaded store without inventing a project DTO', () => {
    expect(renderProjects([])).not.toContain('data-list-role="projects"')
  })
})

function loadedProject(name: string, workspaceId = 'projects-test-workspace'): LoadedProject {
  return {
    config: { id: name, slug: name, name, description: name + ' description', createdAt: 1, updatedAt: 1 },
    folderPath: '/fixture/projects/' + name, assetsPath: '/fixture/projects/' + name + '/assets',
    workspaceRootPath: '/fixture', workspaceId,
  }
}

describe('Projects home current workspace and explicit source', () => {
  test('explicit loaded DTOs take precedence over the isolated atom source', () => {
    const html = renderProjects([loadedProject('Atom title')], [loadedProject('Explicit title')])
    expect(html).toContain('Explicit title')
    expect(html).toContain('Explicit title description')
    expect(html).not.toContain('Atom title')
  })

  test('an explicit empty result remains empty even when the atom has projects', () => {
    const html = renderProjects([loadedProject('Obsolete atom title')], [])
    expect(html).not.toContain('Obsolete atom title')
    expect(html).not.toContain('data-list-role="projects"')
  })

  test('atom fallback rejects another workspace before rendering the list', () => {
    const html = renderProjects([loadedProject('Other workspace title', 'other'), loadedProject('Current title')])
    expect(html).toContain('Current title')
    expect(html).not.toContain('Other workspace title')
  })

  test('explicit input also rejects previous workspace rows', () => {
    const html = renderProjects([], [loadedProject('Previous workspace title', 'other'), loadedProject('Current explicit title')])
    expect(html).toContain('Current explicit title')
    expect(html).not.toContain('Previous workspace title')
  })

  test('an absent active workspace renders no previously loaded project', () => {
    const html = renderProjects([loadedProject('Previous title')], undefined, '')
    expect(html).not.toContain('Previous title')
    expect(html).not.toContain('data-list-role="projects"')
  })
})
