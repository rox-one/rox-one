import SkillsCatalogPage from '@/pages/SkillsCatalogPage'

export default function SkillsSection({ workspaceId, rootPath }: { workspaceId: string; rootPath?: string }) {
  return <SkillsCatalogPage workspaceId={workspaceId} workspaceRootPath={rootPath} />
}