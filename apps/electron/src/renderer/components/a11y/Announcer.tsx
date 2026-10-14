import { useEffect, useState } from 'react'
import { subscribeAnnouncements, type Announcement } from '@/lib/a11y/announcer'

/**
 * Persistent visually hidden live regions. Mounted once in the shell so the
 * regions exist before the first announcement (late-mounted live regions are
 * often ignored by screen readers).
 *
 * Repeating the same text would not be re-read, so the message is cleared and
 * re-set on the next frame.
 */
export function Announcer() {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')

  useEffect(() => {
    const frames: Record<Announcement['politeness'], number> = { polite: 0, assertive: 0 }
    const unsubscribe = subscribeAnnouncements((announcement: Announcement) => {
      const { politeness, message } = announcement
      const set = politeness === 'assertive' ? setAssertive : setPolite
      set('')
      cancelAnimationFrame(frames[politeness])
      frames[politeness] = requestAnimationFrame(() => set(message))
    })
    return () => {
      cancelAnimationFrame(frames.polite)
      cancelAnimationFrame(frames.assertive)
      unsubscribe()
    }
  }, [])

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="a11y-announcer-polite">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="a11y-announcer-assertive">{assertive}</div>
    </>
  )
}
