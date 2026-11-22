---
type: C4 Component
title: Claude oauth
status: stable
groma:
  id: claude-oauth
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/auth/claude-oauth.ts
    - scanner: typescript
      file: packages/shared/src/auth/index.ts
    - scanner: typescript
      file: packages/shared/src/auth/oauth-flow-store.ts
    - scanner: typescript
      file: packages/shared/src/auth/chatgpt-oauth.ts
    - scanner: typescript
      file: packages/shared/src/auth/oauth-relay.ts
    - scanner: typescript
      file: packages/shared/src/auth/state.ts
    - scanner: typescript
      file: packages/shared/src/auth/oauth.ts
    - scanner: typescript
      file: packages/shared/src/auth/claude-token.ts
    - scanner: typescript
      file: packages/shared/src/auth/microsoft-oauth.ts
    - scanner: typescript
      file: packages/shared/src/auth/generic-oauth.ts
    - scanner: typescript
      file: packages/shared/src/auth/slack-oauth.ts
    - scanner: typescript
      file: packages/shared/src/auth/google-oauth.ts
    - scanner: typescript
      file: packages/shared/src/auth/rox-connect-flow.ts
    - scanner: typescript
      file: packages/shared/src/auth/oauth-flow-types.ts
    - scanner: typescript
      file: packages/shared/src/auth/callback-page.ts
    - scanner: typescript
      file: packages/shared/src/auth/callback-server.ts
    - scanner: typescript
      file: packages/shared/src/auth/types.ts
    - scanner: typescript
      file: packages/shared/src/auth/rox-id-client.ts
    - scanner: typescript
      file: packages/shared/src/auth/pkce.ts
    - scanner: typescript
      file: packages/shared/src/auth/claude-oauth-config.ts
    - scanner: typescript
      file: packages/shared/src/auth/chatgpt-oauth-config.ts
    - scanner: typescript
      file: packages/shared/src/auth/rox-account-authority.ts
    - scanner: typescript
      file: packages/shared/src/auth/rox-cloud.ts
    - scanner: typescript
      file: packages/shared/src/auth/rox-pocket-client.ts
    - scanner: typescript
      file: packages/shared/src/auth/github-copilot.ts
description: Implements browser-based PKCE OAuth for Anthropic Claude, returning tokens plus optional account and organization identity.
---
