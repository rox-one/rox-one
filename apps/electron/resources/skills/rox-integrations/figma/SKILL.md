---
name: figma
description: Connect a ROX session to the official Figma MCP tools and inspect Figma designs, variables, Code Connect mappings and screenshots before implementing them.
license: MIT
---

# Figma integration for ROX

This is a ROX-authored integration adapter, not a redistributed Figma skill.

1. Inspect the session's available source tools for a Figma source. The official remote MCP endpoint is https://mcp.figma.com/mcp. If the source is absent or authorization fails, explain that prerequisite; do not claim access.
2. Read the official workflow resource supplied by that connected MCP server before using its corresponding operation. Figma skills and API use are subject to the Figma Developer Terms. Do not download or redistribute those restricted skills as part of ROX.
3. Resolve the user's file URL and node from their request, request design context and a screenshot through the available source tools, and use the project's own components and tokens for implementation.
4. Compare the rendered implementation with the supplied design and report observed differences. Writes to Figma need the user's request to modify that file.

Primary references: https://github.com/figma/mcp-server-guide and https://developers.figma.com/docs/figma-mcp-server/.
