import type { ActionDefinition } from './types'

export const actions = {
  // ═══════════════════════════════════════════
  // General
  // ═══════════════════════════════════════════
  'app.newChat': {
    id: 'app.newChat',
    labelKey: 'shortcuts.action.newChat',
    description: 'Create a new chat session',
    defaultHotkey: 'mod+n',
    category: 'General',
  },
  'app.newChatInPanel': {
    id: 'app.newChatInPanel',
    labelKey: 'shortcuts.action.newChatInPanel',
    description: 'Create a new chat session in a new panel',
    defaultHotkey: 'mod+t',
    category: 'General',
  },
  'app.settings': {
    id: 'app.settings',
    labelKey: 'shortcuts.action.settings',
    description: 'Open application settings',
    defaultHotkey: 'mod+,',
    category: 'General',
  },
  'app.toggleTheme': {
    id: 'app.toggleTheme',
    labelKey: 'shortcuts.action.toggleTheme',
    description: 'Switch between light and dark mode',
    defaultHotkey: 'mod+shift+a',
    category: 'General',
  },
  'app.search': {
    id: 'app.search',
    labelKey: 'shortcuts.action.search',
    description: 'Open search panel',
    defaultHotkey: 'mod+f',
    category: 'General',
  },
  'app.omnibox': {
    id: 'app.omnibox',
    labelKey: 'shortcuts.action.omnibox',
    description: 'Open the unified command palette',
    defaultHotkey: 'mod+k',
    category: 'General',
  },
  'app.keyboardShortcuts': {
    id: 'app.keyboardShortcuts',
    labelKey: 'shortcuts.action.keyboardShortcuts',
    description: 'Show keyboard shortcuts reference',
    defaultHotkey: 'mod+/',
    category: 'General',
  },
  'app.newWindow': {
    id: 'app.newWindow',
    labelKey: 'shortcuts.action.newWindow',
    description: 'Open a new window',
    defaultHotkey: 'mod+shift+n',
    category: 'General',
  },
  'app.quit': {
    id: 'app.quit',
    labelKey: 'shortcuts.action.quit',
    description: 'Quit the application',
    defaultHotkey: 'mod+q',
    category: 'General',
  },

  // ═══════════════════════════════════════════
  // Navigation
  // ═══════════════════════════════════════════
  'nav.focusSidebar': {
    id: 'nav.focusSidebar',
    labelKey: 'shortcuts.action.focusSidebar',
    defaultHotkey: 'mod+1',
    category: 'Navigation',
  },
  'nav.focusNavigator': {
    id: 'nav.focusNavigator',
    labelKey: 'shortcuts.action.focusNavigator',
    defaultHotkey: 'mod+2',
    category: 'Navigation',
  },
  'nav.focusChat': {
    id: 'nav.focusChat',
    labelKey: 'shortcuts.action.focusChat',
    defaultHotkey: 'mod+3',
    category: 'Navigation',
  },
  'nav.nextZone': {
    id: 'nav.nextZone',
    labelKey: 'shortcuts.action.focusNextZone',
    defaultHotkey: 'tab',
    category: 'Navigation',
    when: '!inputFocus',  // Tab should work normally in text inputs
  },
  'nav.goBack': {
    id: 'nav.goBack',
    labelKey: 'shortcuts.action.goBack',
    description: 'Navigate to previous session',
    defaultHotkey: 'mod+[',
    category: 'Navigation',
  },
  'nav.goForward': {
    id: 'nav.goForward',
    labelKey: 'shortcuts.action.goForward',
    description: 'Navigate to next session',
    defaultHotkey: 'mod+]',
    category: 'Navigation',
  },
  'nav.goBackAlt': {
    id: 'nav.goBackAlt',
    labelKey: 'shortcuts.action.goBack',
    description: 'Navigate to previous session (arrow key)',
    defaultHotkey: 'mod+left',
    category: 'Navigation',
    when: '!inputFocus',  // CMD+Left = cursor to line start in text inputs
  },
  'nav.goForwardAlt': {
    id: 'nav.goForwardAlt',
    labelKey: 'shortcuts.action.goForward',
    description: 'Navigate to next session (arrow key)',
    defaultHotkey: 'mod+right',
    category: 'Navigation',
    when: '!inputFocus',  // CMD+Right = cursor to line end in text inputs
  },

  // ═══════════════════════════════════════════
  // View
  // ═══════════════════════════════════════════
  'view.toggleSidebar': {
    id: 'view.toggleSidebar',
    labelKey: 'shortcuts.action.toggleSidebar',
    defaultHotkey: 'mod+b',
    category: 'View',
  },
  'view.toggleFocusMode': {
    id: 'view.toggleFocusMode',
    labelKey: 'shortcuts.action.toggleFocusMode',
    description: 'Hide both sidebars for distraction-free work',
    defaultHotkey: 'mod+.',
    category: 'View',
  },

  'collection.viewNext': {
    id: 'collection.viewNext',
    labelKey: 'shortcuts.action.collectionViewNext',
    description: 'Cycle sessions layout: list → board → table → heatmap',
    defaultHotkey: 'alt+v',
    category: 'View',
    when: '!inputFocus',
  },
  'collection.viewPrev': {
    id: 'collection.viewPrev',
    labelKey: 'shortcuts.action.collectionViewPrev',
    description: 'Return to the last sessions layout',
    defaultHotkey: 'alt+shift+v',
    category: 'View',
    when: '!inputFocus',
  },
  'collection.viewList': {
    id: 'collection.viewList',
    labelKey: 'shortcuts.action.collectionViewList',
    defaultHotkey: 'mod+shift+1',
    category: 'View',
    when: '!inputFocus',
  },
  'collection.viewBoard': {
    id: 'collection.viewBoard',
    labelKey: 'shortcuts.action.collectionViewBoard',
    defaultHotkey: 'mod+shift+2',
    category: 'View',
    when: '!inputFocus',
  },
  'collection.viewTable': {
    id: 'collection.viewTable',
    labelKey: 'shortcuts.action.collectionViewTable',
    defaultHotkey: 'mod+shift+3',
    category: 'View',
    when: '!inputFocus',
  },
  'collection.viewHeatmap': {
    id: 'collection.viewHeatmap',
    labelKey: 'shortcuts.action.collectionViewHeatmap',
    defaultHotkey: 'mod+shift+4',
    category: 'View',
    when: '!inputFocus',
  },

  // ═══════════════════════════════════════════
  // Navigator (scoped — active entity list in middle panel)
  // ═══════════════════════════════════════════
  'navigator.selectAll': {
    id: 'navigator.selectAll',
    labelKey: 'shortcuts.action.selectAll',
    defaultHotkey: 'mod+a',
    category: 'Navigator',
    scope: 'navigator',
    when: 'navigatorFocus',  // CMD+A = select all text when in input
  },
  'navigator.clearSelection': {
    id: 'navigator.clearSelection',
    labelKey: 'shortcuts.action.clearSelection',
    defaultHotkey: 'escape',
    category: 'Navigator',
    scope: 'navigator',
    when: 'navigatorFocus',
  },

  // ═══════════════════════════════════════════
  // Panels
  // ═══════════════════════════════════════════
  'panel.focusNext': {
    id: 'panel.focusNext',
    labelKey: 'shortcuts.action.focusNextPanel',
    description: 'Move focus to the next panel',
    defaultHotkey: 'mod+shift+]',
    category: 'Navigation',
  },
  'panel.focusPrev': {
    id: 'panel.focusPrev',
    labelKey: 'shortcuts.action.focusPrevPanel',
    description: 'Move focus to the previous panel',
    defaultHotkey: 'mod+shift+[',
    category: 'Navigation',
  },

  // ═══════════════════════════════════════════
  // Chat
  // ═══════════════════════════════════════════
  'chat.stopProcessing': {
    id: 'chat.stopProcessing',
    labelKey: 'shortcuts.action.stopProcessing',
    description: 'Cancel the current agent task (double-press)',
    defaultHotkey: 'escape',
    category: 'Chat',
    scope: 'chat',
    when: '!hasSelection',  // Let browser clear selection first; overlays handled by hasOpenOverlay() in enabled callback
  },
  'chat.cyclePermissionMode': {
    id: 'chat.cyclePermissionMode',
    labelKey: 'shortcuts.action.cyclePermissionMode',
    description: 'Switch between Explore, Ask, and Execute modes',
    defaultHotkey: 'shift+tab',
    category: 'Chat',
  },
  'chat.nextSearchMatch': {
    id: 'chat.nextSearchMatch',
    labelKey: 'shortcuts.action.nextSearchMatch',
    defaultHotkey: 'mod+g',
    category: 'Chat',
  },
  'chat.prevSearchMatch': {
    id: 'chat.prevSearchMatch',
    labelKey: 'shortcuts.action.prevSearchMatch',
    defaultHotkey: 'mod+shift+g',
    category: 'Chat',
  },

  // ═══════════════════════════════════════════
  // Workspace
  // ═══════════════════════════════════════════
  'workspace.openInEditor': {
    id: 'workspace.openInEditor',
    labelKey: 'workspace.openInEditor',
    description: 'Open the current workspace in cmux, Cursor, VS Code, or Zed',
    defaultHotkey: null,
    category: 'View',
  },
  'sessions.import': {
    id: 'sessions.import',
    labelKey: 'settings.import.title',
    description: 'Scan local Grok/Claude sessions and persist them as Rox chats',
    defaultHotkey: null,
    category: 'General',
  },
  'session.advisor': {
    id: 'session.advisor',
    labelKey: 'shortcuts.action.advisorReview',
    description: 'Prefill @advisor in this chat — does not spawn a hidden session',
    defaultHotkey: null,
    category: 'Chat',
  },
  'session.simplify': {
    id: 'session.simplify',
    labelKey: 'shortcuts.action.simplifyDiff',
    description: 'Prefill @simplify in this chat — does not spawn a hidden session',
    defaultHotkey: null,
    category: 'Chat',
  },
  'session.workflow': {
    id: 'session.workflow',
    labelKey: 'shortcuts.action.sessionWorkflow',
    description: 'Open the existing session workflow map',
    defaultHotkey: null,
    category: 'Chat',
  },
  'session.agentTeams': {
    id: 'session.agentTeams',
    labelKey: 'settings.appearance.workbenchHarnessAgentTeams',
    description: 'Prefill @agent-teams captain protocol (needs Appearance → Agent Teams flag)',
    defaultHotkey: null,
    category: 'Chat',
  },

} as const satisfies Record<string, ActionDefinition>

// Type-safe action IDs
export type ActionId = keyof typeof actions

// Get all actions as array (for shortcuts page)
export const actionList = Object.values(actions)

// Get actions by category (for organized display)
export const actionsByCategory = actionList.reduce((acc, action) => {
  if (!acc[action.category]) acc[action.category] = []
  acc[action.category].push(action)
  return acc
}, {} as Record<string, ActionDefinition[]>)
