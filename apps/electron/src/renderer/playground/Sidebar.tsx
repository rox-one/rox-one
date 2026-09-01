import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LevelGroup } from './registry'

interface SidebarProps {
  categories: LevelGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const STORAGE_KEY = 'playground-expanded-categories'

export function Sidebar({ categories, selectedId, onSelect }: SidebarProps) {
  const [expandedCategories, setExpandedCategories] = React.useState<Set<string>>(() => {
    // Try to restore from localStorage, otherwise collapse all by default
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as string[]
        return new Set(parsed)
      }
    } catch {
      // Ignore parse errors
    }
    return new Set<string>()
  })

  // Persist expanded categories to localStorage
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...expandedCategories]))
    } catch {
      // Ignore storage errors
    }
  }, [expandedCategories])

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  return (
    <nav className="w-56 shrink-0 border-r border-border bg-background overflow-y-auto">
      <div className="p-3 space-y-1">
        {categories.map(level => {
          const levelKey = `level:${level.name}`
          const isLevelExpanded = expandedCategories.has(levelKey)
          const componentCount = level.categories.reduce((total, category) => total + category.components.length, 0)

          return (
            <div key={level.name}>
              <button
                onClick={() => toggleCategory(levelKey)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    isLevelExpanded && 'rotate-90'
                  )}
                />
                {level.name}
                <span className="ml-auto text-[10px] font-normal opacity-60">
                  {componentCount}
                </span>
              </button>

              {isLevelExpanded && (
                <div className="ml-2 space-y-1">
                  {level.categories.map(category => {
                    const categoryKey = `category:${level.name}/${category.name}`
                    const isCategoryExpanded = expandedCategories.has(categoryKey)

                    return (
                      <div key={categoryKey}>
                        <button
                          onClick={() => toggleCategory(categoryKey)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ChevronRight
                            className={cn('h-3 w-3 transition-transform', isCategoryExpanded && 'rotate-90')}
                          />
                          {category.name}
                          <span className="ml-auto text-[10px] font-normal opacity-60">
                            {category.components.length}
                          </span>
                        </button>
                        {isCategoryExpanded && (
                          <div className="ml-2 space-y-0.5">
                            {category.components.map(component => (
                              <button
                                key={component.id}
                                onClick={() => onSelect(component.id)}
                                className={cn(
                                  'w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors',
                                  selectedId === component.id
                                    ? 'bg-foreground/10 text-foreground font-medium'
                                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
                                )}
                              >
                                {component.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
