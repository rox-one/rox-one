---
type: C4 Component
title: Status
status: stable
groma:
  id: git-status
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/git/status.ts
    - scanner: typescript
      file: packages/shared/src/git/exec.ts
    - scanner: typescript
      file: packages/shared/src/git/workspace.ts
description: Parses git status porcelain output into a branch/ahead/behind and changed-file snapshot.
---
