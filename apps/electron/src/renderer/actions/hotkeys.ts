/**
 * W1-07 (#1504) — pure hotkey helpers for flag-gated, per-platform actions.
 */
import { isMac } from '@/lib/platform'
import type { ActionDefinition } from './types'

/** Default chord of an action on the given platform (null = unbound). */
export function resolveDefaultHotkey(action: ActionDefinition, mac: boolean = isMac): string | null {
  if (!mac && action.defaultHotkeyNonMac !== undefined) return action.defaultHotkeyNonMac
  return action.defaultHotkey
}

export function isActionFlagEnabled(action: ActionDefinition, flags: ReadonlySet<string>): boolean {
  return !action.flag || flags.has(action.flag)
}

/**
 * Physical chord a binding fires on: `mod` is ⌘ (meta) on macOS and Ctrl
 * elsewhere, `ctrl` is always Ctrl. Two bindings collide when this matches.
 */
export function physicalChord(hotkey: string, mac: boolean = isMac): string {
  const parts = hotkey.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const modifiers = new Set<string>()
  for (const part of parts.slice(0, -1)) {
    if (part === 'mod') modifiers.add(mac ? 'meta' : 'ctrl')
    else if (part === 'ctrl') modifiers.add('ctrl')
    else modifiers.add(part)
  }
  return [...[...modifiers].sort(), key].join('+')
}

/** Pairs of actions whose default chords collide on the platform. */
export function findHotkeyCollisions(
  definitions: readonly ActionDefinition[],
  mac: boolean,
): Array<[string, string, string]> {
  const byChord = new Map<string, string>()
  const collisions: Array<[string, string, string]> = []
  for (const action of definitions) {
    const hotkey = resolveDefaultHotkey(action, mac)
    if (!hotkey) continue
    const chord = physicalChord(hotkey, mac)
    const other = byChord.get(chord)
    if (other) collisions.push([other, action.id, chord])
    else byChord.set(chord, action.id)
  }
  return collisions
}
