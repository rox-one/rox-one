/**
 * Zod schemas for theme layers and the portable `.rox-theme.json` format.
 * Browser-safe (zod + theme-layers only): imported directly by the renderer's
 * theme import so it never drags the Node-only config barrel into WebUI.
 */
import { z } from 'zod';
import { isSafeCssColor } from './theme-layers.ts';

/**
 * Theme layer tokens (frame/content/elevation/wallpaper/accent/glass). Strict,
 * bounded: a malformed import is rejected instead of half-applied.
 */
const LayerColorSchema = z.string().min(1).max(64).refine(isSafeCssColor, {
  message: 'Colour must be hex, rgb(a), hsl(a), oklch/oklab or transparent/currentColor/black/white',
});
const GradientSchema = z.object({
  type: z.enum(['linear', 'radial']),
  angle: z.number().finite().min(0).max(360).optional(),
  at: z.tuple([z.number().finite().min(0).max(100), z.number().finite().min(0).max(100)]).optional(),
  stops: z.array(z.tuple([LayerColorSchema, z.number().finite().min(0).max(1)])).min(2).max(5),
}).strict();
export const ThemeLayersSchema = z.object({
  frame: z.object({
    bg: LayerColorSchema.optional(),
    fg: LayerColorSchema.optional(),
    muted: LayerColorSchema.optional(),
    border: LayerColorSchema.optional(),
    gradient: GradientSchema.optional(),
  }).strict().optional(),
  content: z.object({
    bg: LayerColorSchema.optional(),
    fg: LayerColorSchema.optional(),
    border: LayerColorSchema.optional(),
    join: z.enum(['line', 'shadow', 'float']).optional(),
    radius: z.number().finite().min(0).max(24).optional(),
  }).strict().optional(),
  elevation: z.object({
    1: LayerColorSchema.optional(),
    2: LayerColorSchema.optional(),
    3: LayerColorSchema.optional(),
  }).strict().optional(),
  wallpaper: z.union([
    z.object({ type: z.literal('solid'), color: LayerColorSchema }).strict(),
    GradientSchema,
  ]).optional(),
  accent: LayerColorSchema.optional(),
  glass: z.number().finite().min(0).max(1).optional(),
  gridDivider: LayerColorSchema.optional(),
}).strict();

/** Portable `.rox-theme.json` export/import format. */
export const RoxThemeFileSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  name: z.string().min(1).max(80),
  base: z.string().max(80).optional(),
  layers: ThemeLayersSchema,
}).strict();

