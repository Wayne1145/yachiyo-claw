import { describe, expect, it } from 'vitest'
import { validatePluginToolInputSchema } from './tool-schema'

describe('validatePluginToolInputSchema', () => {
  it('accepts the supported subset', () => {
    expect(
      validatePluginToolInputSchema({
        type: 'object',
        properties: {
          city: { type: 'string', minLength: 1, maxLength: 100, description: 'City name' },
          days: { type: 'integer', minimum: 1, maximum: 14 },
          units: { type: 'string', enum: ['metric', 'imperial'] },
          tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          verbose: { type: 'boolean' },
        },
        required: ['city'],
        additionalProperties: false,
      }),
    ).toEqual({ ok: true })
    expect(validatePluginToolInputSchema(undefined)).toEqual({ ok: true })
  })

  it('rejects $ref, patternProperties, and other unsupported keywords', () => {
    expect(validatePluginToolInputSchema({ type: 'object', properties: { a: { $ref: '#/defs/a' } } }).ok).toBe(false)
    expect(validatePluginToolInputSchema({ type: 'object', patternProperties: { '^a': { type: 'string' } } }).ok).toBe(
      false,
    )
    expect(
      validatePluginToolInputSchema({ type: 'object', properties: { a: { type: 'string', pattern: '(a+)+$' } } }).ok,
    ).toBe(false)
    expect(validatePluginToolInputSchema({ type: 'object', allOf: [] }).ok).toBe(false)
  })

  it('rejects non-object roots, excess depth, and forbidden property names', () => {
    expect(validatePluginToolInputSchema({ type: 'string' }).ok).toBe(false)
    expect(
      validatePluginToolInputSchema({
        type: 'object',
        properties: {
          a: {
            type: 'object',
            properties: { b: { type: 'object', properties: { c: { type: 'object', properties: {} } } } },
          },
        },
      }).ok,
    ).toBe(false)
    // JSON.parse creates a REAL "__proto__" key (an object literal would set the prototype instead)
    // — this is exactly how a hostile manifest would carry it.
    expect(
      validatePluginToolInputSchema(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')).ok,
    ).toBe(false)
  })

  it('bounds enum size and property count', () => {
    expect(
      validatePluginToolInputSchema({
        type: 'object',
        properties: { a: { type: 'string', enum: Array.from({ length: 51 }, (_, i) => `v${i}`) } },
      }).ok,
    ).toBe(false)
    const manyProps = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, { type: 'string' }]))
    expect(validatePluginToolInputSchema({ type: 'object', properties: manyProps }).ok).toBe(false)
  })
})
