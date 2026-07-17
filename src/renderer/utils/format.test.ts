import { describe, expect, it } from 'vitest'

import { formatNumber, formatUsage } from './format'

describe('formatNumber', () => {
  it('returns plain string for numbers below 1000', () => {
    expect(formatNumber(191)).toBe('191')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(-123)).toBe('-123')
  })

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1K')
    expect(formatNumber(123456)).toBe('123K')
    expect(formatNumber(999999)).toBe('999K')
  })

  it('formats millions with M suffix', () => {
    expect(formatNumber(1000000)).toBe('1M')
    expect(formatNumber(12000000)).toBe('12M')
  })

  it('formats negative numbers using current floor behavior', () => {
    expect(formatNumber(-1000)).toBe('-1K')
    expect(formatNumber(-1500)).toBe('-2K')
    expect(formatNumber(-1000000)).toBe('-1M')
    expect(formatNumber(-1500000)).toBe('-2M')
  })

  it('supports decimals parameter for K and M', () => {
    expect(formatNumber(1500, 1)).toBe('1.5K')
    expect(formatNumber(999999, 2)).toBe('1000.00K')
    expect(formatNumber(1500000, 2)).toBe('1.50M')
    expect(formatNumber(-1500, 1)).toBe('-1.5K')
  })
})

describe('formatUsage', () => {
  it('combines formatted used/total values', () => {
    expect(formatUsage(191, 200)).toBe('191/200')
    expect(formatUsage(210000, 12000000)).toBe('210K/12M')
  })

  it('passes decimals parameter through to formatNumber', () => {
    expect(formatUsage(1500, 1000000, 1)).toBe('1.5K/1.0M')
  })
})
