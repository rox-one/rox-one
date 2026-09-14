/**
 * SettingsUIConstants
 *
 * Centralized style definitions for consistent settings UI appearance.
 */

export const settingsUI = {
  /** Label style for setting titles */
  label: 'text-[13px] leading-5 font-medium text-text-primary',

  /** Description style for setting subtitles */
  description: 'text-[12px] leading-[18px] text-text-muted',

  /** Smaller description for compact contexts (e.g., menu options) */
  descriptionSmall: 'text-[12px] leading-[18px] text-text-muted',

  /** Gap between label and description (applied to description as margin-top) */
  labelDescriptionGap: 'mt-0.5',

  /** Gap for label group containers (applied as space-y) */
  labelGroup: 'min-w-0',

  /** Shared geometry for every field family; narrow-panel stacking stays in CSS. */
  row: 'flex min-h-[44px] w-full items-center justify-between gap-3 text-left',
  rowPadding: 'px-[var(--settings-row-x)] py-[var(--settings-row-y)]',
  rowPaddingStandalone: 'py-[var(--settings-row-y)]',
  control: 'flex shrink-0 items-center gap-2',
  section: 'space-y-[var(--settings-section-gap)]',
  sectionHeader: 'flex min-w-0 items-start justify-between gap-3 px-0.5',
  sectionTitle: 'text-[13px] leading-5 font-semibold text-text-primary',
  card: 'rox-settings-card overflow-hidden rounded-md bg-surface-elevated shadow-minimal',
  fieldFrame: 'relative min-w-0 rounded-md',
  interactive: 'transition-colors duration-[var(--motion-fast)] hover:bg-surface-hover active:bg-surface-pressed',
}
