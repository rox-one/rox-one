import type { ReferenceOp } from '../engine'

/** One command's reference op, optionally with a catalogue event type. */
export type ReferenceSpec = ReferenceOp | { op: ReferenceOp; event: string }
export type ReferenceSpecMap = Readonly<Record<string, ReferenceSpec>>
