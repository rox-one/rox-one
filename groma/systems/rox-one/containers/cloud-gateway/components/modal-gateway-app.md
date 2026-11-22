---
type: C4 Component
title: App
status: stable
groma:
  id: modal-gateway-app
  parent: cloud-gateway
  code:
    - scanner: python
      file: apps/modal-gateway/app.py
description: Serves a Modal-hosted cloud-runs gateway mirroring the Cloudflare HTTP contract.
---
