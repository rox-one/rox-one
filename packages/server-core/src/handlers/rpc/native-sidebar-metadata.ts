import { CodedError } from '@rox/shared/protocol'
import { isValidEntityColor } from '@rox/shared/colors/validate'
import { isEmoji } from '@rox/shared/utils/icon-constants'
import { getDefaultStatusConfig } from '@rox/shared/statuses'
import { getDefaultLabelConfig } from '@rox/shared/labels/storage'
import { getDefaultViews, getDefaultKnowledgeViews } from '@rox/shared/views'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { StatusConfig } from '@rox/shared/statuses'
import type { LabelConfig } from '@rox/shared/labels'
import type { ViewConfig } from '@rox/shared/views'
import type { LoadedProject } from '@rox/shared/projects'
import type { EntityColor } from '@rox/shared/colors'
import type { RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { readNativeWorkspaceRegistry } from './native-workspace-registry'

export function assertNativeMetadataRead(ctx: RequestContext, deps: HandlerDeps, server: RpcServer, workspaceId: string, capturedRoot?: string): { id: string; rootPath: string } | undefined {
  if (!ctx.principal) return
  // getWorkspaceByNameOrId performs legacy folder migrations. A native read may
  // only inspect the canonical registry and independently verify its registered root.
  const workspace = readNativeWorkspaceRegistry(workspaceId)
  const rootPath = workspace?.rootPath ?? ''
  if (ctx.workspaceId !== workspaceId || !workspace
    || !deps.nativeData?.authority.authorize(ctx.principal, workspaceId, 'read', rootPath)) {
    throw new CodedError('FORBIDDEN', 'Workspace access denied')
  }
  if (!server.isRequestContextCurrent?.(ctx, 'read') || capturedRoot && rootPath !== capturedRoot) {
    throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
  }
  return { id: workspaceId, rootPath }
}

const text = (value: unknown, max = 512): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, max) : ''
const id = (value: unknown): string | undefined => typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u.test(value) ? value : undefined
const color = (value: unknown): EntityColor | undefined => {
  if (!isValidEntityColor(value)) return undefined
  if (typeof value === 'string') return value as EntityColor
  const custom = value as { light: string; dark?: string }
  return { light: custom.light, ...(custom.dark ? { dark: custom.dark } : {}) }
}
const stockIcons: Record<string, string> = { backlog: '📥', todo: '📋', 'in-progress': '🔄', 'needs-review': '👀', done: '✅', cancelled: '⛔' }

const records = <T>(value: unknown): T[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as T[] : []
const missing = (error: unknown): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'

/** Native read grants must never run local self-healing loaders or follow host symlinks. */
function metadataDirectory(root: string, segments: string[]): string | null {
  let path = root
  for (const segment of segments) {
    path = join(path, segment)
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CodedError('FORBIDDEN', 'Workspace metadata path denied')
    } catch (error) { if (missing(error)) return null; throw error }
  }
  return path
}

function metadataConfig(root: string, segments: string[], filename: string): Record<string, unknown> | null {
  const directory = metadataDirectory(root, segments)
  if (!directory) return null
  let descriptor: number, expected: ReturnType<typeof lstatSync>
  try {
    const path = join(directory, filename)
    expected = lstatSync(path)
    if (expected.isSymbolicLink()) throw new CodedError('FORBIDDEN', 'Workspace metadata path denied')
    if (!expected.isFile() || expected.size > 1024 * 1024) return null
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  }
  catch (error) { if (missing(error)) return null; throw new CodedError('FORBIDDEN', 'Workspace metadata path denied') }
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino || stat.size > 1024 * 1024) return null
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
  finally { closeSync(descriptor) }
}

export function readNativeStatuses(root: string): StatusConfig[] {
  const defaults = getDefaultStatusConfig().statuses
  const config = metadataConfig(root, ['statuses'], 'config.json')
  const statuses = config && Array.isArray(config.statuses) ? records<StatusConfig>(config.statuses) : defaults
  const ids = new Set(statuses.map(status => status.id))
  for (const stock of defaults) {
    if (ids.has(stock.id)) continue
    const order = defaults.findIndex(status => status.id === stock.id)
    const previous = defaults.slice(0, order).reverse().find(status => ids.has(status.id))
    const next = defaults.slice(order + 1).find(status => ids.has(status.id))
    const insert = previous ? statuses.findIndex(status => status.id === previous.id) + 1 : next ? statuses.findIndex(status => status.id === next.id) : statuses.length
    statuses.splice(insert, 0, stock); ids.add(stock.id)
  }
  return nativeStatuses(statuses)
}

export function readNativeLabels(root: string): LabelConfig[] {
  const config = metadataConfig(root, ['labels'], 'config.json')
  const labels = config && Array.isArray(config.labels) ? records<LabelConfig>(config.labels) : getDefaultLabelConfig().labels
  return nativeLabels(labels)
}

export function readNativeViews(root: string): ViewConfig[] {
  const config = metadataConfig(root, [], 'views.json')
  const views = config && Array.isArray(config.views) ? records<ViewConfig>(config.views) : getDefaultViews()
  const ids = new Set(views.map(view => view.id))
  return nativeViews([...views, ...getDefaultKnowledgeViews().filter(view => !ids.has(view.id))])
}

export function readNativeProjects(root: string, workspaceId: string): LoadedProject[] {
  const directory = metadataDirectory(root, ['projects'])
  if (!directory) return []
  const projects: LoadedProject[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).slice(0, 500)) {
    if (!entry.isDirectory() || !id(entry.name)) continue
    const config = metadataConfig(root, ['projects', entry.name], 'config.json')
    if (config) projects.push({ workspaceId, folderPath: '', assetsPath: '', workspaceRootPath: '', config } as unknown as LoadedProject)
  }
  return nativeProjects(projects, workspaceId)
}

/** Only workspace navigation metadata crosses the boundary; local icon filenames and URLs do not. */
export function nativeStatuses(statuses: readonly StatusConfig[]): StatusConfig[] {
  return statuses.slice(0, 200).flatMap(status => {
    const statusId = id(status.id)
    if (!statusId || !['open', 'closed'].includes(status.category)) return []
    return [{ id: statusId, label: text(status.label), category: status.category, color: color(status.color),
      icon: typeof status.icon === 'string' && status.icon.length <= 32 && isEmoji(status.icon) ? status.icon : stockIcons[statusId] ?? '🔖',
      isFixed: status.isFixed === true, isDefault: status.isDefault === true, order: Number.isFinite(status.order) ? status.order : 0 }]
  })
}

export function nativeLabels(labels: readonly LabelConfig[]): LabelConfig[] {
  let remaining = 500
  const visit = (items: readonly LabelConfig[], depth: number): LabelConfig[] => depth > 8 ? [] : items.slice(0, remaining).flatMap(label => {
    const labelId = id(label.id)
    if (!labelId || remaining-- <= 0) return []
    return [{ id: labelId, name: text(label.name), color: color(label.color),
      valueType: ['string', 'number', 'date', 'link'].includes(label.valueType ?? '') ? label.valueType : undefined,
      children: Array.isArray(label.children) ? visit(records<LabelConfig>(label.children), depth + 1) : undefined }]
  })
  return visit(labels, 0)
}

export function nativeViews(views: readonly ViewConfig[]): ViewConfig[] {
  return views.slice(0, 200).flatMap(view => {
    const viewId = id(view.id)
    if (!viewId) return []
    return [{ id: viewId, name: text(view.name), description: text(view.description, 1000), color: color(view.color),
      expression: text(view.expression, 4096), domain: view.domain === 'knowledge' ? 'knowledge' as const : 'sessions' as const }]
  })
}

export function nativeProjects(projects: readonly LoadedProject[], workspaceId: string): LoadedProject[] {
  return projects.slice(0, 500).flatMap(project => {
    const projectId = id(project.config.id), slug = id(project.config.slug)
    if (!projectId || !slug || project.workspaceId !== workspaceId) return []
    return [{ workspaceId, folderPath: '', assetsPath: '', workspaceRootPath: '', config: {
      id: projectId, slug, name: text(project.config.name), description: text(project.config.description, 1000),
      color: typeof project.config.color === 'string' && /^#[\da-f]{3,8}$/i.test(project.config.color) ? project.config.color : undefined,
      createdAt: Number.isFinite(project.config.createdAt) ? project.config.createdAt : 0,
      updatedAt: Number.isFinite(project.config.updatedAt) ? project.config.updatedAt : 0,
      archivedAt: Number.isFinite(project.config.archivedAt) ? project.config.archivedAt : undefined,
    } }]
  })
}
