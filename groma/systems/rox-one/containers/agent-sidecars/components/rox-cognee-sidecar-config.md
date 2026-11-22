---
type: C4 Component
title: Config
status: stable
groma:
  id: rox-cognee-sidecar-config
  parent: agent-sidecars
  code:
    - scanner: python
      file: packages/cognee-sidecar/rox_cognee_sidecar/config.py
    - scanner: python
      file: packages/cognee-sidecar/rox_cognee_sidecar/fake_backend.py
    - scanner: python
      file: packages/cognee-sidecar/rox_cognee_sidecar/cognee_backend.py
    - scanner: python
      file: packages/cognee-sidecar/rox_cognee_sidecar/__init__.py
    - scanner: python
      file: packages/cognee-sidecar/rox_cognee_sidecar/__main__.py
    - scanner: python
      file: packages/cognee-sidecar/rox_cognee_sidecar/server.py
description: Maps environment variables into cognee sidecar memory and embedding configuration.
---
