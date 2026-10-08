import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EntityListEmptyScreen } from './entity-list-empty'
import { definePlaygroundStory } from '@/playground/registry/story-loader'

/**
 * A real production empty-state screen, rendered without test-only copies or
 * data adapters. Co-location ensures the component and its visual contract
 * evolve together.
 */
const EntityListEmptyScreenStory = () => {
  const { t } = useTranslation()

  return (
    <EntityListEmptyScreen
      icon={<FolderOpen className="size-5" />}
      title={t('projectsList.empty')}
      description={t('projectsList.emptyDescription')}
      className="h-full min-h-[360px]"
    />
  )
}

export default definePlaygroundStory({
  id: 'screen-entity-list-empty',
  name: 'Entity List Empty Screen',
  category: 'Sources',
  level: 'Screens',
  description: 'Production empty-state screen for a collection with no available entities.',
  component: EntityListEmptyScreenStory,
  props: [],
  layout: 'full',
})
