/** Canonicalize planner-generated future source aliases without erasing event scope. */
export function canonicalValidationSourceId(sourceId: string): string {
  const normalized = sourceId
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
  if (!normalized.startsWith('future:')) return normalized
  const region = normalized.match(/(?:^|-)ar-?(\d+)(?:-|$)/)?.[1]
  const suffix = region ? `-ar${region}` : ''
  if (region && /spectro/.test(normalized) && /energy/.test(normalized) && /flux/.test(normalized)) {
    return `future:spectroscopy-energy-flux${suffix}`
  }
  if (region && /spectro/.test(normalized) && /(?:iris|eis)/.test(normalized)) {
    return `future:spectroscopy${suffix}`
  }
  if (region && /(?:hard-x|hxr|hardx)/.test(normalized)) {
    return `future:hard-xray${suffix}`
  }
  if (/mhd/.test(normalized) && /forward/.test(normalized)) {
    return region ? `future:matched-mhd-forward-model${suffix}` : 'future:matched-mhd-forward-model'
  }
  return normalized
}
