import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export type IconName =
  | 'server'
  | 'cpu'
  | 'gpu'
  | 'ram'
  | 'disk'
  | 'globe'
  | 'terminal'
  | 'key'
  | 'box'
  | 'users'
  | 'chart'
  | 'log'
  | 'folder'
  | 'file'
  | 'shield'
  | 'play'
  | 'stop'
  | 'trash'
  | 'copy'
  | 'check'
  | 'plus'
  | 'pencil'
  | 'arrow'
  | 'search'

/**
 * One stroke drawing per name. Each entry is a factory: a JSX element is a real
 * DOM node in Solid, and one node cannot be rendered in two places at once.
 */
const drawings: Record<IconName, () => JSX.Element> = {
  server: () => (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <circle cx="7" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="7" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  cpu: () => (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  gpu: () => (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="9" cy="12" r="2.4" />
      <circle cx="15.5" cy="12" r="2.4" />
      <path d="M7 18v3M17 18v3" />
    </>
  ),
  ram: () => (
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 10v4M10.5 10v4M14 10v4M17.5 10v4M6 17v2M18 17v2" />
    </>
  ),
  disk: () => (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
  globe: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
    </>
  ),
  terminal: () => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M12.5 15H17" />
    </>
  ),
  key: () => (
    <>
      <circle cx="8" cy="8" r="4" />
      <path d="m11 11 9 9M17 17l2.5-2.5M14.5 14.5 17 12" />
    </>
  ),
  box: () => (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  users: () => (
    <>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6" />
      <path d="M15.5 5.5a3 3 0 0 1 0 5.6M17 14c2.3.7 4 3 4 6" />
    </>
  ),
  chart: () => (
    <>
      <path d="M4 20V4M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="1" />
      <rect x="12" y="9" width="3" height="8" rx="1" />
      <rect x="17" y="6" width="3" height="11" rx="1" />
    </>
  ),
  log: () => (
    <>
      <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  folder: () => (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 10h18" />
    </>
  ),
  file: () => (
    <>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  shield: () => (
    <>
      <path d="M12 3 5 6v5c0 4.5 2.9 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  play: () => <path d="M8 5.5v13l11-6.5-11-6.5Z" />,
  stop: () => <rect x="6" y="6" width="12" height="12" rx="2" />,
  trash: () => (
    <>
      <path d="M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  copy: () => (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  check: () => <path d="m5 12.5 4.5 4.5L19 7" />,
  plus: () => <path d="M12 5v14M5 12h14" />,
  pencil: () => (
    <>
      <path d="m4 20 1-4.2L15.2 5.6a2.1 2.1 0 0 1 3 3L8.2 19 4 20Z" />
      <path d="m13.8 7 3.2 3.2" />
    </>
  ),
  arrow: () => <path d="M5 12h14M13 6l6 6-6 6" />,
  search: () => (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.2 15.2 4.3 4.3" />
    </>
  ),
}

export interface IconProps {
  name: IconName
  size?: number
  class?: string
  /** A text label makes the icon meaningful; without it the icon is decoration. */
  label?: string
}

export function Icon(props: IconProps): JSX.Element {
  const size = (): number => props.size ?? 18
  return (
    <svg
      class={cx('icon', props.class)}
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label === undefined ? undefined : 'img'}
      aria-label={props.label}
      aria-hidden={props.label === undefined ? 'true' : undefined}
    >
      {drawings[props.name]()}
    </svg>
  )
}
