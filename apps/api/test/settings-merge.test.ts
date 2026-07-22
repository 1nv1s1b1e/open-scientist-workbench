import { describe, expect, it } from 'vite-plus/test'
import { deepMerge } from '../src/lib/deep-merge.js'

// Inputs are typed as Record<string, unknown> to mirror the real call sites in
// settings.ts, where `base` is a GlobalSettings object and `patch` is an
// unvalidated JSON body (`c.req.json()`). The `deepMerge` generic infers
// T = Record<string, unknown>, so patches may legitimately vary per-key types
// (the runtime typeof checks decide merge vs. overwrite).
type Bag = Record<string, unknown>

describe('deepMerge', () => {
  it('merges nested objects recursively', () => {
    const base: Bag = { a: { b: 1, c: 2 }, d: 3 }
    const patch: Bag = { a: { b: 10 } }
    const out = deepMerge(base, patch)
    expect(out).toEqual({ a: { b: 10, c: 2 }, d: 3 })
  })

  it('replaces arrays outright (no concatenation)', () => {
    const base: Bag = { tags: ['a', 'b'] }
    const patch: Bag = { tags: ['z'] }
    const out = deepMerge(base, patch)
    expect(out).toEqual({ tags: ['z'] })
  })

  it('skips undefined patch values (base value retained)', () => {
    const base: Bag = { a: 1, b: 2 }
    const patch: Bag = { a: undefined, b: 20 }
    const out = deepMerge(base, patch)
    expect(out).toEqual({ a: 1, b: 20 })
  })

  it('null patch values overwrite the base', () => {
    const base: Bag = { a: 1, b: 'x' }
    const patch: Bag = { a: null }
    const out = deepMerge(base, patch)
    expect(out).toEqual({ a: null, b: 'x' })
  })

  it('handles deep nesting (3+ levels)', () => {
    const base: Bag = { l1: { l2: { l3a: 1, l3b: 2 }, keep: 9 }, top: 0 }
    const patch: Bag = { l1: { l2: { l3a: 100 } } }
    const out = deepMerge(base, patch)
    expect(out).toEqual({ l1: { l2: { l3a: 100, l3b: 2 }, keep: 9 }, top: 0 })
  })

  it('returns base unchanged when patch is empty', () => {
    const base: Bag = { a: 1, b: { c: 2 } }
    const out = deepMerge(base, {})
    expect(out).toEqual(base)
  })

  it('overwrites a base object with a non-object patch value', () => {
    const base: Bag = { a: { nested: true } }
    const patch: Bag = { a: 'flat-now' }
    const out = deepMerge(base, patch)
    expect(out).toEqual({ a: 'flat-now' })
  })

  it('overwrites a base non-object with an object patch value', () => {
    const base: Bag = { a: 'flat' }
    const patch: Bag = { a: { nested: true } }
    const out = deepMerge(base, patch)
    expect(out).toEqual({ a: { nested: true } })
  })
})
