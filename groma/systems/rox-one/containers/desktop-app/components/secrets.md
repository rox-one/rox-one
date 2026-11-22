---
type: C4 Component
title: Secrets
status: stable
groma:
  id: secrets
  parent: desktop-app
  code:
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/secrets.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/__init__.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/search.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/copies.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/notebooks.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/kernel.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/catalog.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/__main__.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/host.py
    - scanner: python
      file: apps/electron/resources/cookbooks/src/rox_cookbooks/ui.py
  technology: Python
description: Resolves cookbook notebook secrets into kernel environment variables, layering ROX gateway defaults.
---
