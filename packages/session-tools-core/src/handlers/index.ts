/**
 * Session Tools Core - Handlers
 *
 * Exports all handler functions for session-scoped tools.
 * These handlers are used by both Claude and Codex implementations.
 */

// SubmitPlan
export { handleSubmitPlan } from './submit-plan.ts';
export type { SubmitPlanArgs } from './submit-plan.ts';

// Config Validate
export { handleConfigValidate } from './config-validate.ts';
export type { ConfigValidateArgs } from './config-validate.ts';

// Skill Validate
export { handleSkillValidate } from './skill-validate.ts';
export type { SkillValidateArgs } from './skill-validate.ts';

// Mermaid Validate
export { handleMermaidValidate } from './mermaid-validate.ts';
export type { MermaidValidateArgs } from './mermaid-validate.ts';

// Source Test
export { handleSourceTest } from './source-test.ts';
export type { SourceTestArgs } from './source-test.ts';

// OAuth Triggers
export {
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
} from './source-oauth.ts';
export type {
  SourceOAuthTriggerArgs,
  GoogleOAuthTriggerArgs,
  SlackOAuthTriggerArgs,
  MicrosoftOAuthTriggerArgs,
} from './source-oauth.ts';

// Credential Prompt
export { handleCredentialPrompt } from './credential-prompt.ts';
export type { CredentialPromptArgs } from './credential-prompt.ts';

// Update Preferences
export { handleUpdatePreferences } from './update-preferences.ts';
export type { UpdatePreferencesArgs } from './update-preferences.ts';

// Transform Data
export { handleTransformData } from './transform-data.ts';
export type { TransformDataArgs } from './transform-data.ts';

// Script Sandbox
export { handleScriptSandbox } from './script-sandbox.ts';
export type { ScriptSandboxArgs } from './script-sandbox.ts';

// Host-tool Bash
export { handleHostBash, runHostBash } from './host-bash.ts';
export type { HostBashArgs } from './host-bash.ts';

// Render Template
export { handleRenderTemplate } from './render-template.ts';
export type { RenderTemplateArgs } from './render-template.ts';

// Send Developer Feedback
export { handleSendDeveloperFeedback } from './send-developer-feedback.ts';
export type { SendDeveloperFeedbackArgs } from './send-developer-feedback.ts';

// Session Self-Management
export { handleSetSessionLabels } from './set-session-labels.ts';
export type { SetSessionLabelsArgs } from './set-session-labels.ts';
export { handleSetSessionStatus } from './set-session-status.ts';
export type { SetSessionStatusArgs } from './set-session-status.ts';
export { handleGetSessionInfo } from './get-session-info.ts';
export type { GetSessionInfoArgs } from './get-session-info.ts';
export { handleListSessions } from './list-sessions.ts';
export type { ListSessionsArgs } from './list-sessions.ts';
export { handleListBackgroundTasks } from './list-background-tasks.ts';
export type { ListBackgroundTasksArgs } from './list-background-tasks.ts';
export { handleCreateTask } from './create-task.ts';
export type { CreateTaskArgs } from './create-task.ts';
export { handleArchiveSession } from './archive-session.ts';
export type { ArchiveSessionArgs } from './archive-session.ts';
export { handleAgentTeams } from './agent-teams.ts';
export type { AgentTeamsArgs, AgentTeamsAction } from './agent-teams.ts';

// Knowledge read tools (K-10 §3.1; args types derive from the zod schemas in tool-defs)
export { handleKnowledgeSearch, KNOWLEDGE_SEARCH_MAX_LIMIT } from './knowledge-search.ts';
export { handleKnowledgeRead, KNOWLEDGE_READ_MAX_MARKDOWN_CHARS } from './knowledge-read.ts';
export { handleKnowledgeGetBacklinks, KNOWLEDGE_BACKLINKS_MAX_ITEMS } from './knowledge-backlinks.ts';
export { handleKnowledgePropose, parseProposeOps } from './knowledge-propose.ts';

// Memory repository read tools (Wave B; args types derive from the zod schemas in tool-defs)
export {
  handleMemoryRepoRead,
  handleMemoryRepoSearch,
  MEMORY_REPO_READ_MAX_CHARS,
  MEMORY_REPO_SEARCH_MAX_LIMIT,
} from './memory-repo.ts';
// Memory recall tools (c1.3)
export { handleMemorySearch, MEMORY_SEARCH_MAX_LIMIT } from './memory-search.ts';
export { handleMemoryGet } from './memory-get.ts';
export { handleMemoryForget, MEMORY_FORGET_MAX_IDS } from './memory-forget.ts';
// Workspace wiki tools (c1.7; read-only search/get + mutating apply)
export { handleWikiSearch, WIKI_SEARCH_MAX_LIMIT } from './wiki-search.ts';
export { handleWikiGet } from './wiki-get.ts';
export { handleWikiApply } from './wiki-apply.ts';
// Visitor access tools (port row a1.6; invite/revoke mutate, list reads)
export { handleVisitorInvite } from './visitors.ts';
export { handleVisitorRevoke } from './visitors.ts';
export { handleVisitorList } from './visitors.ts';
// Skills catalog tools (c2.7; read-only over the registered skills runtime)
export { handleSkillsSearch, SKILLS_SEARCH_MAX_LIMIT } from './skills-search.ts';
export { handleSkillsRead, SKILLS_READ_MAX_CHARS } from './skills-read.ts';

// Developer Space tools (spec 02 §9; artifact reads + propose via the registered
// dev-space runtime — propose only ever drafts, it never applies)
export { handleDevSpaceRead, DEVSPACE_READ_MAX_CONTENT_CHARS } from './dev-space-read.ts';
export { handleDevSpaceSearch, DEVSPACE_SEARCH_MAX_LIMIT } from './dev-space-search.ts';
export { handleDevSpacePropose, parseDevSpaceProposeOps } from './dev-space-propose.ts';

// Pages
export {
  handleListPages,
  handleGetPage,
  handleCreatePage,
  handleUpdatePage,
  handleWritePageData,
  handleDeletePage,
} from './pages.ts';
export type {
  ListPagesArgs,
  GetPageArgs,
  CreatePageArgs,
  UpdatePageArgs,
  WritePageDataArgs,
  DeletePageArgs,
} from './pages.ts';

// Board widgets
export { handleShowWidget } from './show-widget.ts';
export type { ShowWidgetArgs } from './show-widget.ts';
