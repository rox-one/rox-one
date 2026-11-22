---
type: C4 Component
title: Monitor
status: stable
groma:
  id: monitor-monitor
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/monitor/monitor.ts
description: Long-polls Weixin updates, persists sync offsets and dispatches inbound messages.
---
