---
type: C4 Component
title: Kinds
status: stable
groma:
  id: messenger-relay-kinds
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/messenger-relay/kinds.ts
    - scanner: typescript
      file: packages/shared/src/messenger-relay/index.ts
    - scanner: typescript
      file: packages/shared/src/messenger-relay/builders.ts
    - scanner: typescript
      file: packages/shared/src/messenger-relay/bech32.ts
    - scanner: typescript
      file: packages/shared/src/messenger-relay/nip01.ts
  technology: Nostr NIP-01
description: Defines the Nostr kind and tag vocabulary signed by the Rox Messenger relay bridge.
---
