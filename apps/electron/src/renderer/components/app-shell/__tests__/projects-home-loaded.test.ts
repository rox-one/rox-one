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

function renderProjects(projects: LoadedProject[]): string {
  const store = createStore()
  store.set(projectsAtom, projects)
  return renderToStaticMarkup(createElement(
    Provider,
    { store },
    createElement(I18nextProvider, { i18n },
      createElement(ModalProvider, null,
        createElement(ProjectsHomeInMain, { workspaceId: 'projects-test-workspace' }),
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
