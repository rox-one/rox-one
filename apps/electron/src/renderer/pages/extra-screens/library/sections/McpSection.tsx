import IntegrationsCatalogPage from '@/pages/IntegrationsCatalogPage'

export default function McpSection({ workspaceId, rootPath }: { workspaceId: string; rootPath?: string }) {
  return (
    <IntegrationsCatalogPage
      workspaceId={workspaceId}
      workspaceRootPath={rootPath}
      sourceFilter={{ kind: 'type', sourceType: 'mcp' }}
    />
  )
}