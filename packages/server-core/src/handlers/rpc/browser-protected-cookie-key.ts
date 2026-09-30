import { spawnSync } from 'node:child_process'

const SERVICE = 'rox.browser-profile-cookie-vault'
// Private Security.framework call. No lookup, credential data, UI or application activation.
const DELETE_SCRIPT = `ObjC.import('Foundation'); ObjC.import('Security');
// NSDictionary is toll-free bridged to CFDictionary; bind the object argument
// explicitly because JXA's imported CFDictionaryRef signature rejects it.
ObjC.bindFunction('SecItemDelete', ['int', ['id']]);
function run(argv) {
  if (argv.length !== 1 || !argv[0]) throw Error('Invalid account');
  var constant = function(value) { return ObjC.castRefToObject(value); };
  var query = $.NSMutableDictionary.alloc.init;
  query.setObjectForKey(constant($.kSecClassGenericPassword), constant($.kSecClass));
  query.setObjectForKey('${SERVICE}', constant($.kSecAttrService));
  query.setObjectForKey(argv[0], constant($.kSecAttrAccount));
  query.setObjectForKey(constant($.kSecUseAuthenticationUIFail), constant($.kSecUseAuthenticationUI));
  return String($.SecItemDelete(query));
}`

interface CommandResult { status: number | null; stdout?: string | Buffer; error?: unknown; signal?: string | null }
type Execute = (file: string, args: string[], options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore']; timeout: number; maxBuffer: number }) => CommandResult

/** True means deleted or authoritatively absent, never an ambiguous CLI failure. */
export function deleteProtectedCookieKey(reference: string, platform: NodeJS.Platform = process.platform,
  execute: Execute = spawnSync): boolean {
  if (!reference.trim() || reference.includes('\0')) return false
  const options = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 512 }
  try {
    if (platform === 'darwin') {
      const deleted = execute('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', reference], options)
      if (deleted.status === 0 && !deleted.error && !deleted.signal) return true
      // CLI search failures can be mislabeled as exit 44. Obtain an independent
      // status-preserving, no-prompt native result instead of trusting that code.
      const result = execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', DELETE_SCRIPT, reference], options)
      if (result.status !== 0 || result.error || result.signal) return false
      const status = result.stdout?.toString().trim()
      // SecBase.h: errSecSuccess=0, errSecItemNotFound=-25300. Unlike security
      // CLI exit 44, this result does not collapse a failed search into absence.
      return status === '0' || status === '-25300'
    }
    if (platform === 'linux') {
      const result = execute('secret-tool', ['clear', 'service', SERVICE, 'account', reference], options)
      // libsecret clear's nonzero result is ambiguous (locked, absent or failed).
      return result.status === 0 && !result.error && !result.signal
    }
  } catch { /* Unknown execution failure is not absence. */ }
  return false
}
