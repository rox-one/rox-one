---
type: C4 Component
title: Frontmatter patches
status: stable
groma:
  id: frontmatter-patches
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/docs/frontmatter-patches.ts
    - scanner: typescript
      file: packages/core/src/docs/command-envelope.ts
    - scanner: typescript
      file: packages/core/src/docs/retained-source.ts
    - scanner: typescript
      file: packages/core/src/docs/block-identity.ts
    - scanner: typescript
      file: packages/core/src/docs/content-descriptor.ts
    - scanner: typescript
      file: packages/core/src/docs/daily.ts
    - scanner: typescript
      file: packages/core/src/docs/list-tree.ts
    - scanner: typescript
      file: packages/core/src/docs/container-codec.ts
    - scanner: typescript
      file: packages/core/src/docs/action-spec.ts
    - scanner: typescript
      file: packages/core/src/docs/property-dictionary.ts
    - scanner: typescript
      file: packages/core/src/docs/index.ts
    - scanner: typescript
      file: packages/core/src/docs/rox-authority.ts
    - scanner: typescript
      file: packages/core/src/docs/note-share.ts
  technology: YAML
description: Projects and patches YAML frontmatter properties by byte range without re-serializing the whole document.
---
