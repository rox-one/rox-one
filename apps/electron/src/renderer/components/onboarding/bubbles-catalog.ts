/**
 * Interest-bubbles catalog for onboarding.
 *
 * Six bilingual groups of 15 chips each. `deepInterests` is adaptive: it is
 * ranked from the user's `professionalInterests` selection (`dependsOn`), and
 * items flagged `anchor` stay in the cloud regardless of ranking so the
 * baseline prompts never disappear.
 *
 * Labels live here (not in the i18n bundles) because each chip is a fixed
 * bilingual catalogue entry; only the shared chrome (group titles, hint) goes
 * through i18n under the `onboarding.bubbles.*` prefix.
 */

export type BubbleGroupId =
  | 'role'
  | 'family'
  | 'professionalInterests'
  | 'careerGoals'
  | 'personalGoals'
  | 'deepInterests'

export type BubbleLocale = 'ru' | 'en'

export interface BubbleItem {
  id: string
  ru: string
  en: string
  /** deepInterests only: never dropped from the ranked cloud. */
  anchor?: boolean
  /** deepInterests only: professional-interest ids this interest derives from. */
  relatedTo?: string[]
}

export interface BubbleGroup {
  id: BubbleGroupId
  /** Hints which group's selection drives this group's ranking. */
  dependsOn?: BubbleGroupId
  items: BubbleItem[]
}

const ROLE_ITEMS: BubbleItem[] = [
  { id: 'student', ru: 'Студент', en: 'Student' },
  { id: 'entryLevel', ru: 'Начальная позиция', en: 'Entry-level' },
  { id: 'midLevel', ru: 'Средняя позиция', en: 'Mid-level' },
  { id: 'middleManager', ru: 'Менеджер среднего звена', en: 'Middle manager' },
  { id: 'seniorSpecialist', ru: 'Старший специалист', en: 'Senior specialist' },
  { id: 'teamLead', ru: 'Руководитель команды', en: 'Team lead' },
  { id: 'director', ru: 'Директор', en: 'Director' },
  { id: 'cLevel', ru: 'Топ-менеджер (C-level)', en: 'C-level executive' },
  { id: 'founder', ru: 'Основатель / предприниматель', en: 'Founder / entrepreneur' },
  { id: 'shareholder', ru: 'Акционер', en: 'Shareholder' },
  { id: 'phd', ru: 'PhD / постдок / аспирант', en: 'PhD / postdoc / graduate student' },
  { id: 'independentResearcher', ru: 'Независимый исследователь', en: 'Independent researcher' },
  { id: 'investor', ru: 'Инвестор', en: 'Investor' },
  { id: 'retired', ru: 'Пенсионер', en: 'Retired' },
  { id: 'unsure', ru: 'Затрудняюсь ответить', en: 'Prefer not to say' },
]

const FAMILY_ITEMS: BubbleItem[] = [
  { id: 'single', ru: 'Не в отношениях', en: 'Single' },
  { id: 'inRelationship', ru: 'В отношениях', en: 'In a relationship' },
  { id: 'livingWithPartner', ru: 'Живу с партнёром', en: 'Living with a partner' },
  { id: 'married', ru: 'В браке', en: 'Married' },
  { id: 'divorced', ru: 'В разводе', en: 'Divorced' },
  { id: 'hasChildren', ru: 'Есть дети', en: 'Have children' },
  { id: 'noChildren', ru: 'Нет детей', en: 'No children' },
  { id: 'planningChildren', ru: 'Планирую детей', en: 'Planning children' },
  { id: 'singleParent', ru: 'Родитель-одиночка', en: 'Single parent' },
  { id: 'hasSiblings', ru: 'Есть братья/сёстры', en: 'Have siblings' },
  { id: 'largeFamily', ru: 'Большая семья', en: 'Large family' },
  { id: 'extendedFamilyNearby', ru: 'Родственники рядом', en: 'Relatives nearby' },
  { id: 'caringForParents', ru: 'Забочусь о родителях', en: 'Caring for parents' },
  { id: 'caringForRelatives', ru: 'Забочусь о близких', en: 'Caring for loved ones' },
  { id: 'unsure', ru: 'Затрудняюсь ответить', en: 'Prefer not to say' },
]

const PROFESSIONAL_INTEREST_ITEMS: BubbleItem[] = [
  { id: 'softwareDevelopment', ru: 'Разработка ПО', en: 'Software development' },
  { id: 'dataAnalytics', ru: 'Аналитика данных', en: 'Data analytics' },
  { id: 'sales', ru: 'Продажи', en: 'Sales' },
  { id: 'management', ru: 'Управление', en: 'Management' },
  { id: 'research', ru: 'Исследования', en: 'Research' },
  { id: 'artificialIntelligence', ru: 'Искусственный интеллект', en: 'Artificial intelligence' },
  { id: 'medicine', ru: 'Медицина и здоровье', en: 'Medicine and health' },
  { id: 'finance', ru: 'Финансы', en: 'Finance' },
  { id: 'design', ru: 'Дизайн', en: 'Design' },
  { id: 'marketing', ru: 'Маркетинг', en: 'Marketing' },
  { id: 'education', ru: 'Образование', en: 'Education' },
  { id: 'engineering', ru: 'Инженерия', en: 'Engineering' },
  { id: 'product', ru: 'Продукт', en: 'Product' },
  { id: 'law', ru: 'Право', en: 'Law' },
  { id: 'operations', ru: 'Операции и процессы', en: 'Operations and processes' },
]

const CAREER_GOAL_ITEMS: BubbleItem[] = [
  { id: 'growInCurrentRole', ru: 'Расти в текущей роли', en: 'Grow in my current role' },
  { id: 'changeField', ru: 'Сменить сферу', en: 'Change fields' },
  { id: 'becomeManager', ru: 'Стать руководителем', en: 'Become a manager' },
  { id: 'startBusiness', ru: 'Запустить свой бизнес', en: 'Start my own business' },
  { id: 'getPromotion', ru: 'Получить повышение', en: 'Get a promotion' },
  { id: 'higherIncome', ru: 'Увеличить доход', en: 'Increase my income' },
  { id: 'remoteWork', ru: 'Работать удалённо', en: 'Work remotely' },
  { id: 'workAbroad', ru: 'Работать за рубежом', en: 'Work abroad' },
  { id: 'workLifeBalance', ru: 'Баланс работы и жизни', en: 'Work-life balance' },
  { id: 'buildExpertise', ru: 'Стать экспертом в нише', en: 'Build deep expertise' },
  { id: 'mentorOthers', ru: 'Наставлять других', en: 'Mentor others' },
  { id: 'publicSpeaking', ru: 'Публичные выступления', en: 'Public speaking' },
  { id: 'learnNewSkills', ru: 'Освоить новые навыки', en: 'Learn new skills' },
  { id: 'getCertification', ru: 'Получить сертификат или степень', en: 'Get a certification or degree' },
  { id: 'findPurpose', ru: 'Найти дело по душе', en: 'Find meaningful work' },
]

const PERSONAL_GOAL_ITEMS: BubbleItem[] = [
  { id: 'health', ru: 'Укрепить здоровье', en: 'Improve my health' },
  { id: 'fitness', ru: 'Заняться спортом', en: 'Get fit' },
  { id: 'learnLanguage', ru: 'Выучить язык', en: 'Learn a language' },
  { id: 'travel', ru: 'Путешествовать', en: 'Travel' },
  { id: 'readMore', ru: 'Больше читать', en: 'Read more' },
  { id: 'creativeHobby', ru: 'Творческое хобби', en: 'Creative hobby' },
  { id: 'financialFreedom', ru: 'Финансовая свобода', en: 'Financial freedom' },
  { id: 'relationships', ru: 'Улучшить отношения', en: 'Strengthen relationships' },
  { id: 'mindfulness', ru: 'Осознанность и спокойствие', en: 'Mindfulness and calm' },
  { id: 'timeManagement', ru: 'Управлять временем', en: 'Manage my time' },
  { id: 'volunteering', ru: 'Волонтёрство', en: 'Volunteering' },
  { id: 'moveHome', ru: 'Переезд', en: 'Move somewhere new' },
  { id: 'buildHabit', ru: 'Выработать привычку', en: 'Build a habit' },
  { id: 'digitalDetox', ru: 'Цифровой детокс', en: 'Digital detox' },
  { id: 'selfDevelopment', ru: 'Саморазвитие', en: 'Self-development' },
]

const DEEP_INTEREST_ITEMS: BubbleItem[] = [
  { id: 'systemsThinking', ru: 'Системное мышление', en: 'Systems thinking', anchor: true, relatedTo: ['softwareDevelopment', 'engineering'] },
  { id: 'aiEthics', ru: 'Этика ИИ', en: 'AI ethics', relatedTo: ['artificialIntelligence', 'research'] },
  { id: 'dataStorytelling', ru: 'Истории в данных', en: 'Data storytelling', relatedTo: ['dataAnalytics', 'design'] },
  { id: 'neuroscience', ru: 'Нейронауки', en: 'Neuroscience', relatedTo: ['medicine', 'research'] },
  { id: 'markets', ru: 'Рынки и инвестиции', en: 'Markets and investing', relatedTo: ['finance'] },
  { id: 'humanBehavior', ru: 'Поведение человека', en: 'Human behavior', relatedTo: ['management', 'research'] },
  { id: 'climate', ru: 'Климат и устойчивость', en: 'Climate and sustainability', anchor: true, relatedTo: ['engineering', 'research'] },
  { id: 'educationAccess', ru: 'Доступность образования', en: 'Access to education', relatedTo: ['education'] },
  { id: 'healthTech', ru: 'Технологии в здоровье', en: 'Health technology', relatedTo: ['medicine', 'artificialIntelligence'] },
  { id: 'openSource', ru: 'Открытый код', en: 'Open source', anchor: true, relatedTo: ['softwareDevelopment'] },
  { id: 'productCraft', ru: 'Ремесло продукта', en: 'Product craft', relatedTo: ['product', 'design'] },
  { id: 'leadership', ru: 'Лидерство', en: 'Leadership', relatedTo: ['management', 'sales'] },
  { id: 'security', ru: 'Безопасность и приватность', en: 'Security and privacy', relatedTo: ['softwareDevelopment', 'law'] },
  { id: 'creativity', ru: 'Креативность', en: 'Creativity', anchor: true, relatedTo: ['design', 'marketing'] },
  { id: 'philosophy', ru: 'Философия и смысл', en: 'Philosophy and meaning', anchor: true },
]

export const BUBBLE_GROUPS: Record<BubbleGroupId, BubbleGroup> = {
  role: { id: 'role', items: ROLE_ITEMS },
  family: { id: 'family', items: FAMILY_ITEMS },
  professionalInterests: { id: 'professionalInterests', items: PROFESSIONAL_INTEREST_ITEMS },
  careerGoals: { id: 'careerGoals', items: CAREER_GOAL_ITEMS },
  personalGoals: { id: 'personalGoals', items: PERSONAL_GOAL_ITEMS },
  deepInterests: { id: 'deepInterests', dependsOn: 'professionalInterests', items: DEEP_INTEREST_ITEMS },
}

export const BUBBLE_GROUP_IDS: BubbleGroupId[] = [
  'role',
  'family',
  'professionalInterests',
  'careerGoals',
  'personalGoals',
  'deepInterests',
]

/**
 * Order a group's items by `rankedIds` without ever dropping an item.
 *
 * Ranking only floats matched ids to the front (in ranked order); anchors come
 * next so they are always eye-level, then the rest keep catalogue order. Every
 * item — including the ones the parent has selected — stays in the result, so
 * a re-rank never makes a selected bubble vanish.
 */
export function orderBubbleItems(group: BubbleGroup, rankedIds?: string[]): BubbleItem[] {
  if (!rankedIds || rankedIds.length === 0) return group.items
  const rank = new Map(rankedIds.map((id, index) => [id, index]))
  const ranked = group.items
    .filter((item) => rank.has(item.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  const rankedSet = new Set(ranked.map((item) => item.id))
  const rest = group.items.filter((item) => !rankedSet.has(item.id))
  return [...ranked, ...rest.filter((item) => item.anchor), ...rest.filter((item) => !item.anchor)]
}