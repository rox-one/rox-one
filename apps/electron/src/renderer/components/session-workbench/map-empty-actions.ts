/**
 * Empty-map guard for the session workflow editor menus.
 *
 * With zero scenes and zero draft nodes, layout (align / distribute / tile)
 * and document actions (promote trace, save version, run pipeline) have
 * nothing to act on, so the toolbar ⋯ menu and the canvas context menu hide
 * them. Tolerates missing arrays so a half-loaded graph never crashes a menu.
 */
export function isSessionMapEmpty(input: {
  scenes?: readonly unknown[] | null
  draftNodes?: readonly unknown[] | null
}): boolean {
  return (input.scenes?.length ?? 0) === 0 && (input.draftNodes?.length ?? 0) === 0
}
