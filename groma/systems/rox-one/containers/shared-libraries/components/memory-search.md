---
type: C4 Component
title: Memory search
status: stable
groma:
  id: memory-search
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/memory-search.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/list-sessions.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/set-session-labels.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/wiki-apply.ts
      symbol: handleWikiApply
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/rovers.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/wiki-get.ts
      symbol: handleWikiGet
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/send-developer-feedback.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/knowledge-search.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/skills-search.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/show-widget.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/pages.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/index.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/skill-validate.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/skills-read.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/archive-session.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/messaging.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/source-oauth.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/knowledge-backlinks.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/mermaid-validate.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/dev-space-search.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/wiki-search.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/transform-data.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/credential-prompt.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/list-background-tasks.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/dev-space-propose.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/host-bash.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/send-agent-message.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/memory-forget.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/knowledge-propose.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/source-test.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/get-session-info.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/render-template.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/canvas-entity.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/agent-teams.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/memory-get.ts
      symbol: handleMemoryGet
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/submit-plan.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/create-task.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/script-sandbox.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/dev-space-read.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/visitors.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/update-preferences.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/knowledge-read.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/memory-repo.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/config-validate.ts
    - scanner: typescript
      file: packages/session-tools-core/src/handlers/set-session-status.ts
  technology: SQLite FTS5
description: Backs the memory_search agent tool with provenance-tagged, read-only full-text search over the workspace memory index.
---
