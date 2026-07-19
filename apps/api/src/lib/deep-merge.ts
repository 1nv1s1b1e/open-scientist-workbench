/**
 * Deep-merge a partial patch into a base record.
 *
 * - Nested plain objects are merged recursively.
 * - Arrays are replaced (not concatenated) — a patch array wins outright.
 * - `undefined` patch values are skipped (base value retained).
 * - `null` and other non-object patch values overwrite the base.
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(patch ?? {})) {
    const bv = (base as Record<string, unknown>)[key]
    const pv = (patch as Record<string, unknown>)[key]
    if (
      bv &&
      pv &&
      typeof bv === 'object' &&
      !Array.isArray(bv) &&
      typeof pv === 'object' &&
      !Array.isArray(pv)
    ) {
      out[key] = deepMerge(bv as Record<string, unknown>, pv as Record<string, unknown>)
    } else if (pv !== undefined) {
      out[key] = pv
    }
  }
  return out as T
}
