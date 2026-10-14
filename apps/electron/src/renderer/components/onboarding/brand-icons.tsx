/**
 * Brand marks for the first-run identity buttons.
 *
 * Telegram and GitHub glyphs are the simple-icons paths (CC0 1.0,
 * https://simpleicons.org). The Chrome mark is drawn here from basic
 * geometry (three 120° sectors plus the centre), not copied artwork.
 */
import type * as React from 'react'
import { cn } from '@/lib/utils'

interface BrandIconProps {
  className?: string
}

export function TelegramLogo({ className }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', className)}>
      <circle cx="12" cy="12" r="12" fill="#26A5E4" />
      <path
        fill="#fff"
        d="M16.906 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
      />
    </svg>
  )
}

export function GithubLogo({ className }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', className)}>
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  )
}

export function ChromeLogo({ className }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', className)}>
      <path fill="#EA4335" d="M12 12 1.608 6A12 12 0 0 1 22.392 6Z" />
      <path fill="#FBBC04" d="M12 12 22.392 6A12 12 0 0 1 12 24Z" />
      <path fill="#34A853" d="M12 12 12 24A12 12 0 0 1 1.608 6Z" />
      <circle cx="12" cy="12" r="5.6" fill="#fff" />
      <circle cx="12" cy="12" r="4.4" fill="#1A73E8" />
    </svg>
  )
}

/**
 * Tinted glass tile with a soft glow that hosts a brand mark or an
 * illustration (start screens). Purely decorative.
 */
export function GlowTile({ children, tone = 'sky', className }: { children: React.ReactNode; tone?: 'sky' | 'violet'; className?: string }) {
  return (
    <span aria-hidden="true" data-tone={tone} className={cn('onb-tile', className)}>
      {children}
    </span>
  )
}

/** Custom illustration for «глубокая персонализация»: layered context cards around a spark. */
export function PersonalizationArt({ className }: BrandIconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('shrink-0', className)}>
      <defs>
        <linearGradient id="onb-pa-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id="onb-pa-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <rect x="4" y="9" width="17" height="13" rx="3" fill="url(#onb-pa-b)" stroke="#fff" strokeOpacity="0.18" transform="rotate(-8 12 15)" />
      <rect x="9" y="7" width="17" height="13" rx="3" fill="url(#onb-pa-b)" stroke="#fff" strokeOpacity="0.24" transform="rotate(6 17 13)" />
      <rect x="7" y="12" width="18" height="13" rx="3" fill="#0b1020" fillOpacity="0.55" stroke="url(#onb-pa-a)" strokeWidth="1.2" />
      <path d="M10.5 17h7M10.5 20h4.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M22 15.2l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" fill="url(#onb-pa-a)" />
    </svg>
  )
}
