import { mkdirSync } from 'fs'
import { join } from 'path'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { assertNativeMetadataRead, readNativeProjects } from './native-sidebar-metadata'
import type { RequestContext } from '../../transport/types'
import type { LoadedProject } from '@craft-agent/shared/projects'
import {
  ProjectOkrConflictError,
  loadProjectOkr,
  saveProjectOkr,
  type ProjectOkrDocument,
} from '@craft-agent/shared/projects'
import {
  isClaimableLive,
  rpcProjectsActResult,
  rpcProjectsListResult,
  rpcProjectsReadResult,
} from '@craft-agent/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.projects.GET,
  RPC_CHANNELS.projects.GET_ONE,
  RPC_CHANNELS.projects.CREATE,
  RPC_CHANNELS.projects.UPDATE,
  RPC_CHANNELS.projects.DELETE,
  RPC_CHANNELS.projects.LIST_ASSETS,
  RPC_CHANNELS.projects.UPLOAD_ASSET,
  RPC_CHANNELS.projects.DELETE_ASSET,
  RPC_CHANNELS.projects.GET_OKR,
  RPC_CHANNELS.projects.SAVE_OKR,
  RPC_CHANNELS.projects.GET_ROADMAP,
  RPC_CHANNELS.projects.SAVE_ROADMAP,
  RPC_CHANNELS.projects.AI_STATUS,
  RPC_CHANNELS.projects.AI_ROADMAP,
] as const

const TEXT_ASSET_RE = /\.(md|markdown|txt|csv|tsv|json|ya?ml|html?|xml|log)$/i
const TEXT_ASSET_MAX_BYTES = 64 * 1024
const TEXT_EXCERPT_CHARS = 1500

/** Publish storage records in the current trusted registry namespace. Storage
 * basenames are not workspace identities; the renderer never infers this map. */
function projectWorkspaceProjection(
  projects: LoadedProject[],
  canonicalWorkspaceId: string,
  capturedRootPath: string,
): LoadedProject[] {
  const current = getWorkspaceByNameOrId(canonicalWorkspaceId)
  if (!current || current.id !== canonicalWorkspaceId || current.rootPath !== capturedRootPath ||
    projects.some(project => !project || project.workspaceRootPath !== capturedRootPath)) {
    throw new CodedError('AUTH_FAILED', 'Project workspace projection scope changed or is invalid')
  }
  return projects.map(project => ({ ...project, workspaceId: current.id }))
}

/** Short context lines about a project's inputs for the roadmap AI (names + small text excerpts). */
async function projectInputLines(
  workspaceRootPath: string,
  projectSlug: string,
  roadmap: import('@craft-agent/shared/projects').ProjectRoadmap,
  iconFilename?: string,
): Promise<string[]> {
  const { listProjectAssets, getProjectAssetsPath } = await import('@craft-agent/shared/projects')
  const { readFileSync, realpathSync, existsSync } = await import('fs')
  const { relative, isAbsolute } = await import('node:path')
  const workspaceRoot = realpathSync(workspaceRootPath)
  const assetsPath = getProjectAssetsPath(workspaceRootPath, projectSlug)
  const inside = (base: string, path: string) => { const rel = relative(base, path); return rel === '' || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel)) }
  const assetsRoot = existsSync(assetsPath) ? realpathSync(assetsPath) : assetsPath
  if (!inside(workspaceRoot, assetsRoot)) throw new CodedError('AUTH_FAILED', 'Project input scope denied')
  const lines: string[] = []
  for (const asset of listProjectAssets(workspaceRootPath, projectSlug)) {
    if (asset.filename === iconFilename) continue
    if (!inside(assetsRoot, realpathSync(asset.absolutePath))) throw new CodedError('AUTH_FAILED', 'Project input scope denied')
    let line = `file: ${asset.filename} (${asset.mimeType})`
    if (TEXT_ASSET_RE.test(asset.filename) && asset.sizeBytes <= TEXT_ASSET_MAX_BYTES) {
      try {
        const text = readFileSync(asset.absolutePath, 'utf-8').replace(/\s+/g, ' ').trim()
        if (text) line += ` — ${text.slice(0, TEXT_EXCERPT_CHARS)}`
      } catch {
        // unreadable asset: name only
      }
    }
    lines.push(line)
  }
  for (const input of roadmap.inputs) {
    const title = input.title || input.value.slice(0, 120)
    switch (input.kind) {
      case 'link': lines.push(`link: ${title}${input.title ? ` — ${input.value}` : ''}`); break
      case 'text': lines.push(`note: ${input.title ? `${input.title} — ` : ''}${input.value.replace(/\s+/g, ' ').slice(0, TEXT_EXCERPT_CHARS)}`); break
      case 'note': lines.push(`Rox note: ${title}`); break
      case 'session': lines.push(`session: ${title}`); break
      case 'source': lines.push(`data source: ${title}`); break
    }
  }
  return lines
}

export function registerProjectsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  async function broadcastChanged(workspaceId: string, workspaceRootPath: string): Promise<void> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace || workspace.rootPath !== workspaceRootPath) {
      throw new CodedError('AUTH_FAILED', 'Project workspace projection scope changed or is invalid')
    }
    const canonicalWorkspaceId = workspace.id
    const { loadWorkspaceProjects } = await import('@craft-agent/shared/projects')
    const projects = projectWorkspaceProjection(loadWorkspaceProjects(workspaceRootPath), canonicalWorkspaceId, workspaceRootPath)
    pushTyped(server, RPC_CHANNELS.projects.CHANGED, { to: 'workspace', workspaceId: canonicalWorkspaceId }, canonicalWorkspaceId, projects)
  }

  // List all projects for a workspace
  server.handle(RPC_CHANNELS.projects.GET, async (ctx, workspaceId: string) => {
    const nativeWorkspace = assertNativeMetadataRead(ctx, deps, server, workspaceId)
    if (nativeWorkspace) return readNativeProjects(nativeWorkspace.rootPath, nativeWorkspace.id)
    const listed = rpcProjectsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`PROJECTS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const { id, rootPath } = workspace
    const { loadWorkspaceProjects } = await import('@craft-agent/shared/projects')
    assertNativeMetadataRead(ctx, deps, server, workspaceId, rootPath)
    return projectWorkspaceProjection(loadWorkspaceProjects(rootPath), id, rootPath)
  }, { nativeAction: 'read' })

  // Get one project (by id or slug)
  server.handle(RPC_CHANNELS.projects.GET_ONE, async (_ctx, workspaceId: string, projectIdOrSlug: string) => {
    const read = rpcProjectsReadResult({ source: 'native', nativeId: projectIdOrSlug })
    if (!isClaimableLive(read.result)) return null
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null
    const { id, rootPath } = workspace
    const { loadProject, loadProjectById } = await import('@craft-agent/shared/projects')
    const project = loadProject(rootPath, projectIdOrSlug) ?? loadProjectById(rootPath, projectIdOrSlug)
    return projectWorkspaceProjection(project ? [project] : [], id, rootPath)[0] ?? null
  })

  // Create a new project
  server.handle(RPC_CHANNELS.projects.CREATE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/projects').CreateProjectInput) => {
    const act = rpcProjectsActResult({ source: 'native', action: 'write', nativeId: input?.name || 'project' })
    if (!isClaimableLive(act)) throw new Error('project create is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createProject } = await import('@craft-agent/shared/projects')
    const project = createProject(workspace.rootPath, {
      name: input.name?.trim() || 'New Project',
      description: input.description,
      workingDirectory: input.workingDirectory,
      details: input.details,
      colorTheme: input.colorTheme,
    })
    // Ensure notes/projects/{slug}/ folder for project-scoped notes placement.
    try {
      const wsConfig = loadWorkspaceConfig(workspace.rootPath)
      const candidates = [
        wsConfig?.notesPath,
        join(workspace.rootPath, 'notes'),
        join(getDefaultWorkspacesDir(), workspaceId, 'notes'),
      ].filter((p): p is string => Boolean(p))
      for (const notesRoot of new Set(candidates)) {
        mkdirSync(join(notesRoot, 'projects', project.slug), { recursive: true })
      }
    } catch (err) {
      log.warn(`Failed to ensure project notes folder for ${project.slug}:`, err)
    }
    await broadcastChanged(workspaceId, workspace.rootPath)
    log.info(`Created project: ${project.slug}`)
    return project
  })

  // Update project (partial patch). Slug stays stable.
  server.handle(RPC_CHANNELS.projects.UPDATE, async (
    _ctx,
    workspaceId: string,
    projectSlug: string,
    patch: Partial<Omit<import('@craft-agent/shared/projects').ProjectConfig, 'id' | 'slug' | 'createdAt'>>,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { updateProject } = await import('@craft-agent/shared/projects')
    const updated = updateProject(workspace.rootPath, projectSlug, patch)
    await broadcastChanged(workspaceId, workspace.rootPath)
    return updated
  })

  // Delete a project; unbinds projectId from any sessions that referenced it.
  server.handle(RPC_CHANNELS.projects.DELETE, async (_ctx, workspaceId: string, projectSlug: string) => {
    if (!projectSlug) throw new Error('projectSlug is required')
    const act = rpcProjectsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: projectSlug })
    if (!isClaimableLive(act)) throw new Error('project delete is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const { loadProject, deleteProject } = await import('@craft-agent/shared/projects')
    const project = loadProject(workspace.rootPath, projectSlug)
    if (!project) {
      log.warn(`PROJECTS_DELETE: project ${projectSlug} not found`)
      return
    }

    const { unbindProjectFromSessions } = await import('@craft-agent/shared/sessions')
    const touched = await unbindProjectFromSessions(workspace.rootPath, project.config.id)
    const { unbindProjectFromPages } = await import('@craft-agent/shared/pages')
    const touchedPages = unbindProjectFromPages(workspace.rootPath, project.config.id)
    deleteProject(workspace.rootPath, projectSlug)
    await broadcastChanged(workspaceId, workspace.rootPath)
    log.info(`Deleted project ${projectSlug} (unbound ${touched} sessions, ${touchedPages} pages)`)
  })

  // List assets in a project
  server.handle(RPC_CHANNELS.projects.LIST_ASSETS, async (_ctx, workspaceId: string, projectSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    const { listProjectAssets } = await import('@craft-agent/shared/projects')
    return listProjectAssets(workspace.rootPath, projectSlug)
  })

  // Upload an asset (base64 / text / sourcePath)
  server.handle(RPC_CHANNELS.projects.UPLOAD_ASSET, async (
    _ctx,
    workspaceId: string,
    projectSlug: string,
    input: import('@craft-agent/shared/projects').UploadProjectAssetInput,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { uploadProjectAsset } = await import('@craft-agent/shared/projects')
    const asset = uploadProjectAsset(workspace.rootPath, projectSlug, input)
    await broadcastChanged(workspaceId, workspace.rootPath)
    log.info(`Uploaded asset ${asset.filename} to project ${projectSlug}`)
    return asset
  })

  // Delete an asset by filename
  server.handle(RPC_CHANNELS.projects.DELETE_ASSET, async (
    _ctx,
    workspaceId: string,
    projectSlug: string,
    filename: string,
  ) => {
    if (!filename) throw new Error('filename is required')
    const act = rpcProjectsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: filename })
    if (!isClaimableLive(act)) throw new Error('project asset delete is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { deleteProjectAsset } = await import('@craft-agent/shared/projects')
    deleteProjectAsset(workspace.rootPath, projectSlug, filename)
    await broadcastChanged(workspaceId, workspace.rootPath)
  })

  // Roadmap (roadmap.json next to config.json). Missing file → empty roadmap.
  server.handle(RPC_CHANNELS.projects.GET_ROADMAP, async (ctx, workspaceId: string, projectSlug: string) => {
    const read = rpcProjectsReadResult({ source: 'native', nativeId: projectSlug })
    if (!isClaimableLive(read.result)) return null
    const workspace = requireCallerWorkspace(ctx, deps, workspaceId)
    if (!workspace || !projectSlug) return null
    const { loadProjectConfig, loadProjectRoadmap } = await import('@craft-agent/shared/projects')
    if (!loadProjectConfig(workspace.rootPath, projectSlug)) return null
    return loadProjectRoadmap(workspace.rootPath, projectSlug)
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.projects.SAVE_ROADMAP, async (ctx, workspaceId: string, projectSlug: string, roadmap: unknown) => {
    const act = rpcProjectsActResult({ source: 'native', action: 'write', nativeId: projectSlug || 'project' })
    if (!isClaimableLive(act)) throw new Error('project roadmap save is not live')
    const workspace = requireCallerWorkspace(ctx, deps, workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    if (!projectSlug) throw new Error('projectSlug is required')
    const { saveProjectRoadmap, isRoadmapRevision } = await import('@craft-agent/shared/projects')
    const revision = roadmap && typeof roadmap === 'object' ? (roadmap as { revision?: unknown }).revision : undefined
    if (!isRoadmapRevision(revision)) throw new Error('PROJECT_ROADMAP_INVALID_REVISION')
    return saveProjectRoadmap(workspace.rootPath, projectSlug, roadmap, { expectedRevision: revision })
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  // Which model the Project screen AI would use (honest disabled state when none).
  server.handle(RPC_CHANNELS.projects.AI_STATUS, async (ctx, workspaceId: string) => {
    requireCallerWorkspace(ctx, deps, workspaceId)
    const describe = deps.sessionManager?.describeWorkspaceLlm
    if (typeof describe !== 'function') return { available: false, reason: 'unsupported' }
    return describe.call(deps.sessionManager, workspaceId)
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  // Roadmap AI: clarifying questions → spec proposal → improve text. Never writes;
  // the renderer shows a proposal and applies only the items the user accepts.
  server.handle(RPC_CHANNELS.projects.AI_ROADMAP, async (
    ctx,
    workspaceId: string,
    projectSlug: string,
    request: import('@craft-agent/shared/projects').RoadmapAiRequest & { language?: string; today?: string; inputs?: string[] },
  ): Promise<import('@craft-agent/shared/projects').RoadmapAiResponse> => {
    const workspace = requireCallerWorkspace(ctx, deps, workspaceId)
    if (!workspace) return { ok: false, error: `Workspace not found: ${workspaceId}` }
    const principal = ctx.principal
    const authority = deps.nativeData?.authority
    // Keep the exact grant generations through both asynchronous input seams.
    // Regranting access must not revive an in-flight export to a provider.
    const authorizationFences = principal ? (['read', 'write'] as const).map(action => {
      if (!authority?.authorize(principal, workspaceId, action, workspace.rootPath)) {
        throw new CodedError('AUTH_FAILED', `Project roadmap AI ${action} is unauthorized`)
      }
      const fence = authority.permissionFence(principal, workspaceId, action)
      if (!fence) throw new CodedError('AUTH_FAILED', `Project roadmap AI ${action} is unauthorized`)
      return { action, fence }
    }) : []
    const text = typeof request?.text === 'string' ? request.text.trim() : ''
    if (!text) return { ok: false, error: 'empty' }
    if (!['clarify', 'spec', 'improve'].includes(request.mode) || text.length > 20_000) throw new Error('PROJECT_ROADMAP_INVALID_AI_REQUEST')
    const query = deps.sessionManager?.queryWorkspaceLlm
    const describe = deps.sessionManager?.describeWorkspaceLlm
    if (typeof query !== 'function') return { ok: false, error: 'unsupported', unavailable: true }
    const status = typeof describe === 'function' ? describe.call(deps.sessionManager, workspaceId) : { available: true }
    if (!status.available) return { ok: false, error: status.reason ?? 'no-connection', unavailable: true }

    const shared = await import('@craft-agent/shared/projects')
    const project = shared.loadProject(workspace.rootPath, projectSlug)
    if (!project) return { ok: false, error: `Project not found: ${projectSlug}` }
    const { roadmap } = shared.loadProjectRoadmap(workspace.rootPath, projectSlug)
    if (!shared.isRoadmapRevision(request.roadmapRevision) || request.roadmapRevision !== roadmap.revision) throw new Error('PROJECT_ROADMAP_CONFLICT')
    const extra = Array.isArray(request.inputs) ? request.inputs.filter((l): l is string => typeof l === 'string').slice(0, 32).map(line => line.slice(0, TEXT_EXCERPT_CHARS)) : []
    const aiContext = {
      projectName: project.config.name,
      projectDescription: project.config.description,
      roadmap,
      inputs: [...(await projectInputLines(workspace.rootPath, projectSlug, roadmap, project.config.icon)), ...extra],
      today: typeof request.today === 'string' ? request.today : undefined,
      language: typeof request.language === 'string' ? request.language : undefined,
    }
    const mode = request.mode
    const prompt = mode === 'clarify'
      ? shared.buildClarifyPrompt(aiContext, text)
      : mode === 'improve'
        ? shared.buildImprovePrompt(aiContext, text)
        : shared.buildSpecPrompt(aiContext, text, Array.isArray(request.answers) ? request.answers : [])
    try {
      const currentWorkspace = requireCallerWorkspace(ctx, deps, workspaceId)
      if (ctx.principal !== principal || currentWorkspace.rootPath !== workspace.rootPath) {
        throw new CodedError('AUTH_FAILED', 'Project roadmap AI caller scope changed during operation')
      }
      for (const { action, fence } of authorizationFences) {
        if (!principal || !authority || authority.permissionFence(principal, workspaceId, action) !== fence ||
          !authority.authorize(principal, workspaceId, action, workspace.rootPath)) {
          throw new CodedError('AUTH_FAILED', `Project roadmap AI ${action} permission changed during operation`)
        }
      }
      const result = await query.call(deps.sessionManager, workspaceId, {
        systemPrompt: prompt.systemPrompt,
        prompt: prompt.prompt,
        temperature: mode === 'improve' ? 0.3 : 0.2,
        maxTokens: mode === 'spec' ? 8000 : 2000,
      })
      const effectiveModel = result.effectiveModel === undefined ? result.model ?? null : result.effectiveModel
      const provenance = { requestedModel: result.requestedModel, effectiveModel, model: effectiveModel ?? undefined, warning: result.warning }
      log.info(`PROJECTS_AI_ROADMAP: ${mode} for ${projectSlug} answered by ${result.model ?? 'unknown model'} (${result.text.length} chars)`)
      if (mode === 'clarify') {
        const questions = shared.parseClarifyResponse(result.text)
        if (!questions.length) return { ok: false, error: 'unparseable', raw: result.text.slice(0, 2000), ...provenance }
        return { ok: true, mode, questions, ...provenance, roadmapRevision: roadmap.revision }
      }
      if (mode === 'improve') {
        const improved = shared.stripImprovedText(result.text)
        if (!improved) return { ok: false, error: 'empty-answer', ...provenance }
        return { ok: true, mode, text: improved, ...provenance, roadmapRevision: roadmap.revision }
      }
      const proposal = shared.parseSpecResponse(result.text)
      if (!proposal) return { ok: false, error: 'unparseable', raw: result.text.slice(0, 2000) }
      return { ok: true, mode: 'spec', proposal, ...provenance, roadmapRevision: roadmap.revision }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`PROJECTS_AI_ROADMAP failed for ${projectSlug}: ${message}`)
      return { ok: false, error: message }
    }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  // Project OKR data has the same workspace boundary as project metadata.
  server.handle(RPC_CHANNELS.projects.GET_OKR, async (ctx, workspaceId: string, projectSlug: string) => {
    const workspace = requireCallerWorkspace(ctx, deps, workspaceId)
    if (!projectSlug) throw new Error('projectSlug is required')
    return loadProjectOkr(workspace.rootPath, projectSlug)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.projects.SAVE_OKR, async (
    ctx,
    workspaceId: string,
    projectSlug: string,
    expectedRevision: number,
    document: Pick<ProjectOkrDocument, 'cycles'>,
  ) => {
    const workspace = requireCallerWorkspace(ctx, deps, workspaceId)
    if (!projectSlug) throw new Error('projectSlug is required')
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('expectedRevision must be a non-negative safe integer')
    }
    if (!document || !Array.isArray(document.cycles)) throw new Error('document.cycles is required')
    try {
      return saveProjectOkr(workspace.rootPath, projectSlug, expectedRevision, { cycles: document.cycles })
    } catch (error) {
      if (error instanceof ProjectOkrConflictError) {
        return {
          conflict: true as const,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
        }
      }
      throw error
    }
  }, { nativeAction: 'write' })
}

function requireCallerWorkspace(
  ctx: RequestContext,
  deps: HandlerDeps,
  requestedWorkspaceId: string,
) {
  const callerWorkspaceId = ctx.workspaceId ?? (
    ctx.webContentsId === null
      ? undefined
      : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) ?? undefined
  )
  if (!requestedWorkspaceId || callerWorkspaceId !== requestedWorkspaceId) {
    throw new CodedError('AUTH_FAILED', 'Workspace access denied')
  }
  const workspace = getWorkspaceByNameOrId(requestedWorkspaceId)
  if (!workspace) throw new CodedError('NOT_FOUND', `Workspace not found: ${requestedWorkspaceId}`)
  return workspace
}
