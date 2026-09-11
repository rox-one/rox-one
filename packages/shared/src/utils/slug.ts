/** Generate a URL/filesystem-safe slug from a name; falls back to `fallback` when it reduces to empty. */
export function generateSlug(name: string, fallback = 'workspace'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  return slug || fallback;
}

/**
 * Kebab-case a name and de-collide against existing slugs by appending
 * `-2`, `-3`, … (matches the historical Projects behavior).
 */
export function generateUniqueSlug(
  name: string,
  existingSlugs: ReadonlySet<string>,
  fallback: string,
): string {
  const slug = generateSlug(name, fallback);
  if (!existingSlugs.has(slug)) return slug;

  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) counter++;
  return `${slug}-${counter}`;
}
