/**
 * OEM plugin catalog allowlist (E1).
 *
 * Empty list means no marketplace installs. Names not on the list are never
 * returned from bazaar package listings.
 */

export const OEM_PLUGIN_ALLOWLIST: string[] = []

export function filterBazaarPackages<T extends { name: string }>(packages: T[]): T[] {
  const allowed = new Set(OEM_PLUGIN_ALLOWLIST)
  return packages.filter((pkg) => allowed.has(pkg.name))
}
