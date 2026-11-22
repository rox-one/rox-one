---
type: C4 Component
title: Entry
status: stable
groma:
  id: entry
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/commands/catalogue/entry.ts
    - scanner: typescript
      file: packages/core/src/commands/catalogue/meetings.ts
      symbol: MEETINGS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/im.ts
      symbol: IM_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/index.ts
    - scanner: typescript
      file: packages/core/src/commands/catalogue/collab.ts
      symbol: COLLAB_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/system.ts
    - scanner: typescript
      file: packages/core/src/commands/catalogue/acl.ts
      symbol: ACL_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/drive.ts
    - scanner: typescript
      file: packages/core/src/commands/catalogue/notify.ts
      symbol: NOTIFY_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/xsc.ts
      symbol: XSC_CATALOGUE_TYPES
    - scanner: typescript
      file: packages/core/src/commands/catalogue/docs.ts
      symbol: DOCS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/projects.ts
      symbol: PROJECTS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/contacts.ts
      symbol: CONTACTS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/social.ts
      symbol: SOCIAL_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/entities.ts
      symbol: ENTITIES_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/goals.ts
      symbol: GOALS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/identity.ts
      symbol: IDENTITY_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/workplace.ts
    - scanner: typescript
      file: packages/core/src/commands/catalogue/xfn.ts
      symbol: XFN_NEW_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/agents.ts
      symbol: AGENTS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/calendar.ts
      symbol: CALENDAR_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/spaces.ts
      symbol: SPACES_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/kpis.ts
      symbol: KPIS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/tasks.ts
      symbol: TASKS_COMMANDS
    - scanner: typescript
      file: packages/core/src/commands/catalogue/automation.ts
      symbol: AUTOMATION_COMMANDS
description: Declares catalogue command entries (name, owner module, authority, verb, risk class) with placeholder schemas for later binding.
---
