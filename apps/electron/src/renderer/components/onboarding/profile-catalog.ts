/**
 * Profile questionnaire bubble catalog for the onboarding «profile» step.
 *
 * Seven bilingual groups of 15 chips each. The last group, `deepInterests`, is
 * adaptive: `rankDeepInterests` deterministically re-orders/filters its base set
 * from the selected `function` + `area` chips using the static
 * `relatedFunctions` / `relatedAreas` mapping below — no model call, no
 * randomness. Items flagged `anchor` never disappear, and previously selected
 * ids are always kept visible by the caller.
 *
 * Labels live here (not in the i18n bundles) because each chip is a fixed
 * bilingual catalogue entry; only the group titles and shared chrome go
 * through i18n under the `onboarding.profile.bubbles.*` prefix.
 */

export const PROFILE_BUBBLE_GROUP_IDS = [
  'role',
  'family',
  'function',
  'area',
  'careerGoals',
  'personalGoals',
  'deepInterests',
] as const

export type ProfileBubbleGroupId = (typeof PROFILE_BUBBLE_GROUP_IDS)[number]

/** Groups whose selection feeds the adaptive `deepInterests` ranking. */
export const PROFILE_ADAPTIVE_GROUP_ID: ProfileBubbleGroupId = 'deepInterests'

export type ProfileBubbleLocale = 'ru' | 'en'

export interface ProfileBubbleItem {
  id: string
  ru: string
  en: string
  /** deepInterests only: never dropped from the visible cloud. */
  anchor?: boolean
  /** deepInterests only: `function` ids this interest derives from. */
  relatedFunctions?: string[]
  /** deepInterests only: `area` ids this interest derives from. */
  relatedAreas?: string[]
}

export interface ProfileBubbleGroup {
  id: ProfileBubbleGroupId
  /** True for the adaptive group ranked/filtered by `function` + `area`. */
  adaptive?: boolean
  items: ProfileBubbleItem[]
}

const ROLE_ITEMS: ProfileBubbleItem[] = [
  { id: 'student', ru: 'Учусь', en: 'Studying' },
  { id: 'entryLevel', ru: 'Начальная позиция', en: 'Entry-level' },
  { id: 'midLevel', ru: 'Средняя позиция', en: 'Mid-level' },
  { id: 'middleManager', ru: 'Менеджер среднего звена', en: 'Middle manager' },
  { id: 'seniorSpecialist', ru: 'Старший специалист', en: 'Senior specialist' },
  { id: 'teamLead', ru: 'Руководитель команды', en: 'Team lead' },
  { id: 'director', ru: 'Директор', en: 'Director' },
  { id: 'cLevel', ru: 'Топ-менеджер (C-level)', en: 'C-level executive' },
  { id: 'founder', ru: 'Основатель / предприниматель', en: 'Founder / entrepreneur' },
  { id: 'shareholder', ru: 'Акционер', en: 'Shareholder' },
  { id: 'freelancer', ru: 'Фрилансер', en: 'Freelancer' },
  { id: 'researcher', ru: 'Исследователь', en: 'Researcher' },
  { id: 'investor', ru: 'Инвестор', en: 'Investor' },
  { id: 'retired', ru: 'Пенсионер', en: 'Retired' },
  { id: 'unsure', ru: 'Затрудняюсь ответить', en: 'Prefer not to say' },
]

const FAMILY_ITEMS: ProfileBubbleItem[] = [
  { id: 'single', ru: 'Не в отношениях', en: 'Single' },
  { id: 'inRelationship', ru: 'В отношениях', en: 'In a relationship' },
  { id: 'married', ru: 'В браке', en: 'Married' },
  { id: 'civilUnion', ru: 'Гражданское партнёрство', en: 'Civil partnership' },
  { id: 'divorced', ru: 'В разводе', en: 'Divorced' },
  { id: 'separated', ru: 'В разлуке', en: 'Separated' },
  { id: 'widowed', ru: 'Вдовец / вдова', en: 'Widowed' },
  { id: 'partnerNoKids', ru: 'Есть партнёр, без детей', en: 'Partner, no children' },
  { id: 'hasKids', ru: 'Есть дети', en: 'Have children' },
  { id: 'expectantParent', ru: 'Ждём ребёнка', en: 'Expecting a child' },
  { id: 'grandparent', ru: 'Есть внуки', en: 'Have grandchildren' },
  { id: 'caresForParents', ru: 'Забочусь о родителях', en: 'Caring for parents' },
  { id: 'hasSiblings', ru: 'Есть братья / сёстры', en: 'Have siblings' },
  { id: 'livesWithParents', ru: 'Живу с родителями', en: 'Living with parents' },
  { id: 'familyUnsure', ru: 'Затрудняюсь ответить', en: 'Prefer not to say' },
]

const FUNCTION_ITEMS: ProfileBubbleItem[] = [
  { id: 'management', ru: 'Управление', en: 'Management' },
  { id: 'engineering', ru: 'Разработка', en: 'Engineering' },
  { id: 'design', ru: 'Дизайн', en: 'Design' },
  { id: 'product', ru: 'Продукт', en: 'Product' },
  { id: 'marketing', ru: 'Маркетинг', en: 'Marketing' },
  { id: 'sales', ru: 'Продажи', en: 'Sales' },
  { id: 'finance', ru: 'Финансы', en: 'Finance' },
  { id: 'legal', ru: 'Юридическая работа', en: 'Legal' },
  { id: 'hrPeople', ru: 'HR и люди', en: 'HR & people' },
  { id: 'dataAnalytics', ru: 'Данные и аналитика', en: 'Data & analytics' },
  { id: 'customerSupport', ru: 'Поддержка клиентов', en: 'Customer support' },
  { id: 'educationTraining', ru: 'Обучение', en: 'Education & training' },
  { id: 'research', ru: 'Исследования', en: 'Research' },
  { id: 'operations', ru: 'Операции', en: 'Operations' },
  { id: 'administration', ru: 'Администрирование', en: 'Administration' },
]

const AREA_ITEMS: ProfileBubbleItem[] = [
  { id: 'softwareIt', ru: 'IT и софт', en: 'IT & software' },
  { id: 'telecommunications', ru: 'Телеком', en: 'Telecommunications' },
  { id: 'fintechFinance', ru: 'Финтех и финансы', en: 'Fintech & finance' },
  { id: 'healthcare', ru: 'Медицина', en: 'Healthcare' },
  { id: 'education', ru: 'Образование', en: 'Education' },
  { id: 'scienceResearch', ru: 'Наука', en: 'Science' },
  { id: 'industryManufacturing', ru: 'Промышленность', en: 'Industry & manufacturing' },
  { id: 'retailEcommerce', ru: 'Ритейл и e-commerce', en: 'Retail & e-commerce' },
  { id: 'governmentPublic', ru: 'Госсектор', en: 'Government & public sector' },
  { id: 'mediaEntertainment', ru: 'Медиа и развлечения', en: 'Media & entertainment' },
  { id: 'energyUtilities', ru: 'Энергетика', en: 'Energy & utilities' },
  { id: 'transportLogistics', ru: 'Транспорт и логистика', en: 'Transport & logistics' },
  { id: 'agricultureFood', ru: 'Сельское хозяйство и еда', en: 'Agriculture & food' },
  { id: 'nonprofitSocial', ru: 'НКО и социальная сфера', en: 'Nonprofit & social' },
  { id: 'otherArea', ru: 'Другое', en: 'Other' },
]

const CAREER_GOALS_ITEMS: ProfileBubbleItem[] = [
  { id: 'leadership', ru: 'Руководить людьми', en: 'Lead people' },
  { id: 'higherIncome', ru: 'Больше зарабатывать', en: 'Earn more' },
  { id: 'ownBusiness', ru: 'Своё дело', en: 'Build my own business' },
  { id: 'masteryCraft', ru: 'Стать экспертом', en: 'Master the craft' },
  { id: 'workLifeBalance', ru: 'Баланс работы и жизни', en: 'Work-life balance' },
  { id: 'relocateAbroad', ru: 'Переезд за рубеж', en: 'Relocate abroad' },
  { id: 'careerChange', ru: 'Сменить профессию', en: 'Change career' },
  { id: 'remoteWork', ru: 'Удалённая работа', en: 'Work remotely' },
  { id: 'publicRecognition', ru: 'Публичное признание', en: 'Public recognition' },
  { id: 'mentoringOthers', ru: 'Наставничество', en: 'Mentor others' },
  { id: 'buildProduct', ru: 'Создать продукт', en: 'Ship a product' },
  { id: 'expertAuthority', ru: 'Стать авторитетом', en: 'Become an authority' },
  { id: 'stableIncome', ru: 'Стабильный доход', en: 'Stable income' },
  { id: 'sabbatical', ru: 'Творческий отпуск', en: 'Take a sabbatical' },
  { id: 'careerUnsure', ru: 'Пока не определился', en: 'Not decided yet' },
]

const PERSONAL_GOALS_ITEMS: ProfileBubbleItem[] = [
  { id: 'health', ru: 'Здоровье', en: 'Health' },
  { id: 'fitness', ru: 'Спорт и форма', en: 'Fitness' },
  { id: 'learnLanguage', ru: 'Выучить язык', en: 'Learn a language' },
  { id: 'travel', ru: 'Путешествия', en: 'Travel' },
  { id: 'familyTime', ru: 'Больше времени с семьёй', en: 'More family time' },
  { id: 'financialFreedom', ru: 'Финансовая свобода', en: 'Financial freedom' },
  { id: 'hobbyProject', ru: 'Своё хобби-дело', en: 'A hobby project' },
  { id: 'readMore', ru: 'Больше читать', en: 'Read more' },
  { id: 'mindfulness', ru: 'Осознанность и покой', en: 'Mindfulness & calm' },
  { id: 'creativeWork', ru: 'Творчество', en: 'Creative work' },
  { id: 'community', ru: 'Сообщество и друзья', en: 'Community & friends' },
  { id: 'savings', ru: 'Накопления', en: 'Build savings' },
  { id: 'buyHome', ru: 'Своё жильё', en: 'Buy a home' },
  { id: 'personalGrowth', ru: 'Личностный рост', en: 'Personal growth' },
  { id: 'rest', ru: 'Больше отдыхать', en: 'Rest more' },
]

/**
 * Adaptive base set. `relatedFunctions` / `relatedAreas` map each interest to
 * the `function` / `area` chip ids that raise its deterministic score.
 */
const DEEP_INTERESTS_ITEMS: ProfileBubbleItem[] = [
  { id: 'ai', ru: 'Искусственный интеллект', en: 'Artificial intelligence', anchor: true, relatedFunctions: ['engineering', 'dataAnalytics', 'research', 'product'], relatedAreas: ['softwareIt', 'scienceResearch'] },
  { id: 'programming', ru: 'Программирование', en: 'Programming', relatedFunctions: ['engineering', 'dataAnalytics'], relatedAreas: ['softwareIt'] },
  { id: 'writing', ru: 'Писательство', en: 'Writing', relatedFunctions: ['marketing', 'educationTraining'], relatedAreas: ['mediaEntertainment', 'education'] },
  { id: 'psychology', ru: 'Психология', en: 'Psychology', relatedFunctions: ['hrPeople', 'educationTraining', 'research'], relatedAreas: ['healthcare', 'education'] },
  { id: 'philosophy', ru: 'Философия', en: 'Philosophy', relatedFunctions: ['research', 'educationTraining'], relatedAreas: ['education', 'scienceResearch'] },
  { id: 'history', ru: 'История', en: 'History', relatedFunctions: ['research', 'educationTraining'], relatedAreas: ['education', 'scienceResearch', 'governmentPublic'] },
  { id: 'science', ru: 'Наука', en: 'Science', anchor: true, relatedFunctions: ['research', 'dataAnalytics', 'engineering'], relatedAreas: ['scienceResearch', 'healthcare', 'education'] },
  { id: 'art', ru: 'Искусство', en: 'Art', anchor: true, relatedFunctions: ['design'], relatedAreas: ['mediaEntertainment', 'nonprofitSocial'] },
  { id: 'music', ru: 'Музыка', en: 'Music', relatedFunctions: ['design'], relatedAreas: ['mediaEntertainment'] },
  { id: 'entrepreneurship', ru: 'Предпринимательство', en: 'Entrepreneurship', relatedFunctions: ['management', 'product', 'marketing'], relatedAreas: ['softwareIt', 'retailEcommerce', 'fintechFinance'] },
  { id: 'investing', ru: 'Инвестиции', en: 'Investing', relatedFunctions: ['finance', 'management'], relatedAreas: ['fintechFinance'] },
  { id: 'languages', ru: 'Языки', en: 'Languages', relatedFunctions: ['educationTraining', 'research'], relatedAreas: ['education', 'mediaEntertainment'] },
  { id: 'healthLongevity', ru: 'Здоровье и долголетие', en: 'Health & longevity', relatedFunctions: ['research', 'engineering'], relatedAreas: ['healthcare'] },
  { id: 'environment', ru: 'Экология', en: 'Environment', relatedFunctions: ['operations', 'research'], relatedAreas: ['energyUtilities', 'agricultureFood', 'nonprofitSocial'] },
  { id: 'games', ru: 'Игры', en: 'Games', relatedFunctions: ['engineering', 'design', 'product'], relatedAreas: ['softwareIt', 'mediaEntertainment'] },
]

export const PROFILE_BUBBLE_GROUPS: Record<ProfileBubbleGroupId, ProfileBubbleGroup> = {
  role: { id: 'role', items: ROLE_ITEMS },
  family: { id: 'family', items: FAMILY_ITEMS },
  function: { id: 'function', items: FUNCTION_ITEMS },
  area: { id: 'area', items: AREA_ITEMS },
  careerGoals: { id: 'careerGoals', items: CAREER_GOALS_ITEMS },
  personalGoals: { id: 'personalGoals', items: PERSONAL_GOALS_ITEMS },
  deepInterests: { id: 'deepInterests', adaptive: true, items: DEEP_INTERESTS_ITEMS },
}

/** Ordered list of groups as they appear in the questionnaire. */
export const PROFILE_BUBBLE_GROUP_ORDER: ProfileBubbleGroupId[] = [...PROFILE_BUBBLE_GROUP_IDS]

/** `id → { ru, en }` for every chip, used when building the suggest prompt. */
export const PROFILE_BUBBLE_LABEL_BY_ID: Record<string, { ru: string; en: string }> = Object.fromEntries(
  PROFILE_BUBBLE_GROUP_IDS.flatMap((groupId) =>
    PROFILE_BUBBLE_GROUPS[groupId].items.map((item) => [item.id, { ru: item.ru, en: item.en }]),
  ),
)

export interface DeepInterestContext {
  /** Selected `function` chip ids. */
  functions: readonly string[]
  /** Selected `area` chip ids. */
  areas: readonly string[]
}

function scoreDeepInterest(item: ProfileBubbleItem, context: DeepInterestContext): number {
  const functionHits = (item.relatedFunctions ?? []).filter((id) => context.functions.includes(id)).length
  const areaHits = (item.relatedAreas ?? []).filter((id) => context.areas.includes(id)).length
  return functionHits + areaHits
}

/**
 * Deterministically rank/filter the adaptive `deepInterests` cloud.
 *
 * Rules (pure, stable — same inputs always yield the same order):
 * - With no `function`/`area` selected the full base set is returned in base order.
 * - Otherwise the visible set is every item with score > 0 plus every `anchor`
 *   and every `previouslySelected` id (selections never vanish).
 * - Order is score-descending, ties broken by base-set index.
 */
export function rankDeepInterests(
  context: DeepInterestContext,
  previouslySelected: readonly string[] = [],
): ProfileBubbleItem[] {
  const base = PROFILE_BUBBLE_GROUPS.deepInterests.items
  const hasContext = context.functions.length > 0 || context.areas.length > 0
  if (!hasContext) return [...base]

  const selected = new Set(previouslySelected)
  const scored = base.map((item, index) => ({ item, index, score: scoreDeepInterest(item, context) }))
  const visible = scored.filter(
    ({ item, score }) => score > 0 || item.anchor === true || selected.has(item.id),
  )
  visible.sort((a, b) => (b.score - a.score) || (a.index - b.index))
  return visible.map(({ item }) => item)
}