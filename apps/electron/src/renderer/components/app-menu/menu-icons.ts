/**
 * Lucide icons named by the app-menu schema (`shared/menu-schema.ts`) and the
 * mobile menu pages, resolved by name.
 *
 * An explicit map instead of `Icons[name]` over `import * as Icons`: dynamic
 * lookup on the namespace keeps every lucide icon (~0.9 MB) in the startup
 * bundle. `menu-icons.test.ts` checks that every schema icon name resolves.
 */
import type * as React from 'react'
import {
  AppWindow, Bug, ClipboardPaste, Copy, Download, Eye, Focus, HelpCircle, Keyboard, LogOut,
  Maximize2, Minimize2, PanelLeft, PanelRight, Pencil, PictureInPicture2, Redo2, RotateCcw,
  Scissors, Settings, SquarePen, TextSelect, Undo2, ZoomIn, ZoomOut,
  // Settings-page icons (menu-schema SETTINGS_ICONS), the mobile fallback.
  BookOpen, Blocks, Building2, CircleUser, Cloud, DownloadCloud, FileText, MessageSquare, Palette, Server, Shield, ShieldAlert, ShieldCheck, ShoppingBag, Sparkles, Tag, ToggleRight, Users,
} from 'lucide-react'

type MenuIcon = React.ComponentType<{ className?: string }>

export const MENU_ICONS: Readonly<Record<string, MenuIcon>> = {
  AppWindow, Bug, ClipboardPaste, Copy, Download, Eye, Focus, HelpCircle, Keyboard, LogOut,
  Maximize2, Minimize2, PanelLeft, PanelRight, Pencil, PictureInPicture2, Redo2, RotateCcw,
  Scissors, Settings, SquarePen, TextSelect, Undo2, ZoomIn, ZoomOut,
  BookOpen, Blocks, Building2, CircleUser, Cloud, DownloadCloud, FileText, MessageSquare, Palette, Server, Shield, ShieldAlert, ShieldCheck, ShoppingBag, Sparkles, Tag, ToggleRight, Users,
}

export function getMenuIcon(name: unknown): MenuIcon | null {
  return typeof name === 'string' && Object.hasOwn(MENU_ICONS, name) ? MENU_ICONS[name]! : null
}
