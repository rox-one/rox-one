/**
 * Access-policy plugin registry (port-matrix row a1.6, fail-closed half).
 *
 * A named operator role MAY declare `accessPolicyPlugin: <name>`. Before this
 * registry existed the field was parsed (operator-role-policy.ts) and then
 * ignored, so a role that NAMED a plugin was silently admitted WITHOUT it —
 * fail-open. Admission now resolves the declared name here:
 *
 * - a name with NO registered authorizer refuses the connection's methods
 *   (fail-closed);
 * - a registered plugin that returns false refuses;
 * - a registered plugin that returns true admits;
 * - a role that does not name a plugin is unchanged.
 *
 * Every refusal uses the same typed OPERATOR_ACCESS_DENIED as a scope denial,
 * so the response is uniform and leaks no oracle about which plugin is missing.
 */

/** The per-request facts an access-policy plugin may inspect. */
export interface AccessPolicyRequest {
  readonly channel: string
  readonly nativeAction: string | undefined
  /** Resolved role name, null when the ceiling carried no role. */
  readonly role: string | null
  /** Subject of the authenticated native principal. */
  readonly subject: string
}

export interface AccessPolicyPlugin {
  /**
   * Decide whether this request is admitted. Returning false (or throwing)
   * refuses; only an explicit `true` admits. Fail-closed by construction.
   */
  authorize(request: AccessPolicyRequest): boolean | Promise<boolean>
  /**
   * Optional second hook, invoked when a connection adopting the policy
   * resumes (e.g. to rehydrate plugin-side state). Absence never admits or
   * refuses anything on its own.
   */
  resume?(request: AccessPolicyRequest): void | Promise<void>
}

const registry = new Map<string, AccessPolicyPlugin>()

/** Register (or replace) the authorizer for a named access-policy plugin. */
export function registerAccessPolicyPlugin(name: string, plugin: AccessPolicyPlugin): void {
  const key = typeof name === 'string' ? name.trim() : ''
  if (!key) throw new Error('Access-policy plugin name must be a non-empty string')
  if (!plugin || typeof plugin.authorize !== 'function') {
    throw new Error(`Access-policy plugin "${key}" must declare an authorize function`)
  }
  registry.set(key, plugin)
}

/** Look up a registered plugin, or null when the name is unknown/empty. */
export function lookupAccessPolicyPlugin(name: string | null | undefined): AccessPolicyPlugin | null {
  if (typeof name !== 'string' || name.length === 0) return null
  return registry.get(name) ?? null
}

/** Test seam: drop every registered plugin. */
export function resetAccessPolicyPlugins(): void {
  registry.clear()
}

/**
 * Fail-closed admission decision for a ceiling that declares an access-policy
 * plugin. A role without the field is unchanged (true). An unregistered name,
 * a plugin without an authorizer, a thrown authorizer, or any non-`true`
 * result all refuse.
 */
export async function isAccessPolicyAdmitted(
  pluginName: string | null | undefined,
  request: AccessPolicyRequest,
): Promise<boolean> {
  if (typeof pluginName !== 'string' || pluginName.length === 0) return true
  const plugin = lookupAccessPolicyPlugin(pluginName)
  if (!plugin || typeof plugin.authorize !== 'function') return false
  try {
    return (await plugin.authorize(request)) === true
  } catch {
    return false
  }
}