---
type: C4 Component
title: Serve lab
status: stable
groma:
  id: serve-lab
  parent: desktop-app
  code:
    - scanner: python
      file: apps/electron/resources/cookbooks/scripts/serve_lab.py
      symbol: main
    - scanner: python
      file: apps/electron/resources/cookbooks/scripts/electron_handshake_probe.py
  technology: Python
description: Starts the loopback Cookbooks Lab HTTP server for local cookbook development.
---
