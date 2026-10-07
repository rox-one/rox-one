import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import {
  SUPER_ENGINEERING_HUB_TAGLINES,
  SUPER_ENGINEERING_SCRAMBLE_CHARSET,
} from '@/constants/hub-taglines'
import { SE_SPRING_TAGLINE } from '@/lib/motion/super-engineering-springs'

function randomScramble(text: string, charset: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === ' ' || ch === '–' || ch === '-') {
      out += ch
      continue
    }
    out += charset[Math.floor(Math.random() * charset.length)] ?? ch
  }
  return out
}

export interface ScrambleTaglineProps {
  phrases?: readonly string[]
  className?: string
  cycleMs?: number
}

export function ScrambleTagline({
  phrases = SUPER_ENGINEERING_HUB_TAGLINES,
  className,
  cycleMs = 3200,
}: ScrambleTaglineProps) {
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = React.useState(0)
  const [display, setDisplay] = React.useState(phrases[0] ?? '')
  const phrase = phrases[index % phrases.length] ?? ''

  React.useEffect(() => {
    if (!phrase) return
    const id = window.setInterval(() => {
      setIndex((value) => (value + 1) % phrases.length)
    }, cycleMs)
    return () => window.clearInterval(id)
  }, [cycleMs, phrase, phrases.length])

  React.useEffect(() => {
    if (!phrase) return
    if (reduceMotion) {
      setDisplay(phrase)
      return
    }
    let frame = 0
    const frames = 14
    const tick = window.setInterval(() => {
      frame += 1
      if (frame >= frames) {
        window.clearInterval(tick)
        setDisplay(phrase)
        return
      }
      setDisplay(randomScramble(phrase, SUPER_ENGINEERING_SCRAMBLE_CHARSET))
    }, 32)
    return () => window.clearInterval(tick)
  }, [phrase, reduceMotion])

  return (
    <p
      className={cn('text-sm text-muted-foreground tabular-nums', className)}
      data-testid="scramble-tagline"
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={display}
          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={reduceMotion ? { duration: 0.2 } : SE_SPRING_TAGLINE}
        >
          {display}
        </motion.span>
      </AnimatePresence>
    </p>
  )
}
