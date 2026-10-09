/**
 * createNativeSkillsToolRuntime — the server-core implementation of the
 * SkillsToolRuntime seam from @rox/session-tools-core. Registered once by
 * registerSkillsHandlers, it lets the skills_search / skills_read session tools
 * reach the SAME gated catalog as the `<available_skills>` prompt block and the
 * skills RPC layer, in the process that owns the skills RPC layer.
 *
 * Boundary rules:
 * - The catalog is the eligibility-gated merge from `loadAllSkills`; a skill
 *   hidden by gating (operator allowlist, disabled pack, OS, missing bins/env/
 *   config) is invisible to search AND unreadable.
 * - Every advertised/readable skill must ALSO resolve (realpath) inside its
 *   discovered root. Discovery follows directory symlinks, so a link that
 *   escapes its root would otherwise leak an outside SKILL.md into the catalog
 *   and the read path; `isWithinRealRoot` drops those entries up front, so
 *   search, list and read share one confined catalog.
 * - Reads resolve by slug through `loadSkillDetails`, which confines the path
 *   with the hardened, symlink-safe instructions reader — a raw path never
 *   crosses this seam.
 */

import { dirname } from 'node:path'
import type {
  SkillCatalogEntry,
  SkillReadOutcome,
  SkillSearchHit,
  SkillsRuntimeScope,
  SkillsToolRuntime,
} from '@rox/session-tools-core'
import { isWithinRealRoot } from '@rox/session-tools-core'
import {
  buildSkillEligibilityReport,
  loadSkillDetails,
  type LoadedSkill,
} from '@rox/shared/skills'

const MAX_EXCERPT_CHARS = 240

/** The directory a skill was discovered under — the root reads must not escape. */
function skillBaseDir(skill: LoadedSkill): string {
  return dirname(skill.path)
}

function toCatalogEntry(skill: LoadedSkill): SkillCatalogEntry {
  return {
    slug: skill.slug,
    name: skill.metadata.name,
    description: skill.metadata.description,
    path: skill.path,
    baseDir: skillBaseDir(skill),
    source: skill.source,
  }
}

async function eligibleCatalog(scope: SkillsRuntimeScope): Promise<LoadedSkill[]> {
  const report = await buildSkillEligibilityReport({
    workspaceRoot: scope.workspaceRoot,
    projectRoot: scope.projectRoot,
    includeCollisions: false,
  })
  return report.eligible.filter(skill => isWithinRealRoot(skill.path, skillBaseDir(skill)))
}

export function createNativeSkillsToolRuntime(): SkillsToolRuntime {
  return {
    async list(scope) {
      return (await eligibleCatalog(scope)).map(toCatalogEntry)
    },

    async search({ workspaceRoot, projectRoot, query, limit }) {
      const needle = query.trim().toLowerCase()
      const catalog = await eligibleCatalog({ workspaceRoot, projectRoot })
      const matches = catalog.filter(skill =>
        `${skill.slug}\n${skill.metadata.name}\n${skill.metadata.description}`.toLowerCase().includes(needle),
      )
      const bounded = matches.slice(0, Math.max(0, limit ?? matches.length))
      const hits: SkillSearchHit[] = []
      for (const skill of bounded) {
        const entry = toCatalogEntry(skill)
        const details = await loadSkillDetails(workspaceRoot, skill.slug, projectRoot)
        const excerpt = details?.content ? details.content.replace(/\s+/g, ' ').trim().slice(0, MAX_EXCERPT_CHARS) : ''
        hits.push(excerpt ? { ...entry, excerpt } : entry)
      }
      return hits
    },

    async read({ workspaceRoot, projectRoot, slug }): Promise<SkillReadOutcome | null> {
      const catalog = await eligibleCatalog({ workspaceRoot, projectRoot })
      if (!catalog.some(skill => skill.slug === slug)) return null
      const details = await loadSkillDetails(workspaceRoot, slug, projectRoot)
      if (!details) return null
      return { slug: details.slug, name: details.metadata.name, content: details.content, path: details.path }
    },
  }
}