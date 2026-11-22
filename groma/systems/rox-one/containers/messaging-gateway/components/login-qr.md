---
type: C4 Component
title: Login qr
status: stable
groma:
  id: login-qr
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/auth/login-qr.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/auth/accounts.ts
description: Drives WeChat QR-code login and account binding through iLink.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/messaging-gateway/src/adapters/wechat/ilink/auth/login-qr.ts](../../../../../../packages/messaging-gateway/src/adapters/wechat/ilink/auth/login-qr.ts) | [packages/messaging-gateway/src/adapters/wechat/index.ts](../../../../../../packages/messaging-gateway/src/adapters/wechat/index.ts) | Invokes supplied callback: onStatus | typescript |
| [packages/messaging-gateway/src/adapters/wechat/ilink/auth/login-qr.ts](../../../../../../packages/messaging-gateway/src/adapters/wechat/ilink/auth/login-qr.ts) | [packages/messaging-gateway/src/registry.ts](../../../../../../packages/messaging-gateway/src/registry.ts) | Invokes supplied callback: verifyCodeProvider | typescript |
