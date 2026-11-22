---
type: C4 Component
title: Pptx tool
status: stable
groma:
  id: pptx-tool
  parent: desktop-app
  code:
    - scanner: python
      file: apps/electron/resources/scripts/pptx_tool.py
    - scanner: python
      file: apps/electron/resources/scripts/doc_diff.py
    - scanner: python
      file: apps/electron/resources/scripts/ical_tool.py
    - scanner: python
      file: apps/electron/resources/scripts/hindsight_runner.py
    - scanner: python
      file: apps/electron/resources/scripts/img_tool.py
    - scanner: python
      file: apps/electron/resources/scripts/markitdown_cli.py
    - scanner: python
      file: apps/electron/resources/scripts/docx_tool.py
    - scanner: python
      file: apps/electron/resources/scripts/pdf_tool.py
    - scanner: python
      file: apps/electron/resources/scripts/xlsx_tool.py
  technology: python-pptx
description: Creates, inspects and extracts PowerPoint presentations from markdown or JSON via a CLI.
---
