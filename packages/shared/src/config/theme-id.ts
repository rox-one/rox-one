/** Opaque preset filename stem. Keep existing spaces, dots and Unicode names. */
export function isSafeThemeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..'
    && !/[\/\\\0]/.test(value) && new TextEncoder().encode(value).length <= 250
}
