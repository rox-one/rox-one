import { createPage, loadWorkspacePages } from './storage.ts'
import type { PageConfig } from './types.ts'

export const DEMO_PAGE_NAME = 'Getting started'

export const DEMO_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Getting started</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font: 16px/1.5 system-ui, sans-serif; padding: 2rem; }
    main { max-width: 40rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
    p { margin: 0; opacity: 0.8; }
  </style>
</head>
<body>
  <main>
    <h1>Getting started</h1>
    <p>This is a Page — a persistent HTML document in this workspace. Ask an agent to design it, or edit it yourself.</p>
  </main>
</body>
</html>
`

/** Seed a starter Page when the workspace has none. Idempotent. */
export function ensureDemoPage(workspaceRootPath: string): PageConfig | null {
  if (loadWorkspacePages(workspaceRootPath).length > 0) return null
  return createPage(workspaceRootPath, {
    name: DEMO_PAGE_NAME,
    description: 'Starter page for this workspace',
    kind: 'static',
    content: DEMO_PAGE_HTML,
  })
}
