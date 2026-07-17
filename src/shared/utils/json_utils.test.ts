import { describe, expect, it } from 'vitest'
import { parseJsonOrEmpty } from './json_utils'

describe('parseJsonOrEmpty', () => {
  it('parses valid JSON object', () => {
    expect(parseJsonOrEmpty('{"key": "value"}')).toEqual({ key: 'value' })
  })

  it('parses valid JSON array', () => {
    expect(parseJsonOrEmpty('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('parses nested JSON', () => {
    const input = '{"a": {"b": [1, 2]}}'
    expect(parseJsonOrEmpty(input)).toEqual({ a: { b: [1, 2] } })
  })

  it('returns empty object for invalid JSON', () => {
    expect(parseJsonOrEmpty('not json')).toEqual({})
    expect(parseJsonOrEmpty('{invalid}')).toEqual({})
  })

  it('returns empty object for empty string', () => {
    expect(parseJsonOrEmpty('')).toEqual({})
  })

  it('parses JSON primitives', () => {
    expect(parseJsonOrEmpty('"hello"')).toBe('hello')
    expect(parseJsonOrEmpty('42')).toBe(42)
    expect(parseJsonOrEmpty('true')).toBe(true)
    expect(parseJsonOrEmpty('null')).toBe(null)
  })
})
