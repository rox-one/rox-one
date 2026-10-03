/**
 * Projects Module
 *
 * Public exports for project management.
 */

export type {
  ProjectConfig,
  ProjectAsset,
  CreateProjectInput,
  LoadedProject,
  ProjectPromptContext,
  OkrCycle,
  OkrCycleStatus,
  OkrEvidence,
  OkrMeasurement,
  OkrKeyResult,
  OkrObjective,
  OkrProgress,
  ProjectOkrDocument,
} from './types.ts';
export type { OkrCycleInput, OkrCalculation, OkrObjectiveCalculation, OkrKeyResultCalculation } from './okr.ts';
export {
  calculateOkrCycle,
  createOkrCycle,
  loadProjectOkr,
  saveProjectOkr,
  ProjectOkrConflictError,
} from './okr.ts';

export {
  // Path utilities
  ensureProjectsDir,
  ensureProjectAssetsDir,
  getWorkspaceProjectsPath,
  getProjectPath,
  getProjectAssetsPath,
  getProjectMemoryPath,
  MEMORY_FILENAME,
  // Config operations
  loadProjectConfig,
  saveProjectConfig,
  // Memory operations
  loadProjectMemory,
  // Load operations
  loadProject,
  loadProjectById,
  loadWorkspaceProjects,
  // Create/update/delete
  generateProjectSlug,
  createProject,
  updateProject,
  deleteProject,
  projectExists,
  // Asset operations
  listProjectAssets,
  uploadProjectAsset,
  deleteProjectAsset,
  sanitizeAssetFilename,
} from './storage.ts';

export type { UploadProjectAssetInput } from './storage.ts';

export * from './roadmap.ts';
export * from './roadmap-ai.ts';
export {
  getProjectRoadmapPath,
  getProjectRoadmapMarkdownPath,
  loadProjectRoadmap,
  saveProjectRoadmap,
  loadProjectRoadmapPromptText,
} from './roadmap-storage.ts';
export type { LoadedRoadmap, SaveRoadmapOptions } from './roadmap-storage.ts';
