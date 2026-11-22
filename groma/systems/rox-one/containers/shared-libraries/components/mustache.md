---
type: C4 Component
title: Mustache
status: stable
groma:
  id: mustache
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/session-tools-core/src/templates/mustache.ts
      symbol: renderMustache
    - scanner: typescript
      file: packages/session-tools-core/src/templates/loader.ts
description: Zero-dependency Mustache renderer for HTML templates with sections, inverted sections and dotted lookups.
---
