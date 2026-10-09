import IntegrationsCatalogPage from '@/pages/IntegrationsCatalogPage'

export default function IntegrationsSection({ workspaceId, rootPath }: { workspaceId: string; rootPath?: string }) {
  return <IntegrationsCatalogPage workspaceId={workspaceId} workspaceRootPath={rootPath} />
}