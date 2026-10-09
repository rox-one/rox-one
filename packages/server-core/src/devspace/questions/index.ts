/**
 * Dev Space question blocks (03-SPEC-features §3, D8) — public surface.
 * Consumed by the `devSpace:generateQuestions` handler.
 */
export {
  DEV_SPACE_QUESTION_BLOCK_NAMES, DEV_SPACE_QUESTIONS_PER_BLOCK, generateQuestionBlocks, roleLabel,
} from './blocks.ts'
export type {
  DevSpaceQuestionContext, DevSpaceQuestionProfile, DevSpaceQuestionRepo, DevSpaceQuestionSecurity, DevSpaceQuestionSignals,
} from './blocks.ts'
export {
  buildQuestionContext, collectRepoSignals, collectWorkSignals, profileFromEnvironment, resolveWorkingCopy,
} from './context.ts'
export type { BuildQuestionContextInput, EnvironmentPrefsReader } from './context.ts'