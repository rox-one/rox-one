/**
 * Visible UI brand leftovers (ROX-AUD-181 / #341).
 * Protocol/storage/OAuth IDs stay on the migration manifest. This file is
 * the allowlisted UI copy only — do not rename @craft-agent packages here.
 */

import { ROX_PRODUCT_NAME } from './manifest.ts'

export const UI_BRAND_MANIFEST = {
  productName: ROX_PRODUCT_NAME,
  playgroundTitle: 'Design System Playground - Rox',
  dashboardTitle: 'Rox — Панель аналитики',
} as const

export const UI_BRAND_ALLOWLIST = [
  '@craft-agent',
  'com.lukilabs.craft-agent',
  '.craft-agent',
  'CRAFT_',
  'craftagents://',
] as const
