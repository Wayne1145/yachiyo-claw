import { describe, expect, it } from 'vitest'
import { formatFileSize, formatNumber } from './index'

describe('formatNumber', () => {
  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0')
  })

  it('formats zero with unit', () => {
    expect(formatNumber(0, 'tokens')).toBe('0 tokens')
  })

  it('formats small numbers as-is', () => {
    expect(formatNumber(42)).toBe('42')
    expect(formatNumber(999)).toBe('999')
  })

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1K')
    expect(formatNumber(1500)).toBe('2K')
    expect(formatNumber(50000)).toBe('50K')
    expect(formatNumber(999999)).toBe('1000K')
  })

  it('formats millions with M suffix', () => {
    expect(formatNumber(1000000)).toBe('1.0M')
    expect(formatNumber(1500000)).toBe('1.5M')
    expect(formatNumber(10000000)).toBe('10.0M')
  })

  it('appends unit when provided', () => {
    expect(formatNumber(1500, 'tokens')).toBe('2K tokens')
    expect(formatNumber(1500000, 'tokens')).toBe('1.5M tokens')
    expect(formatNumber(42, 'tokens')).toBe('42 tokens')
  })
})

describe('formatFileSize', () => {
  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1 MB')
    expect(formatFileSize(5242880)).toBe('5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB')
  })

  it('uses 1024-based calculation', () => {
    // 2048 bytes = 2 KB
    expect(formatFileSize(2048)).toBe('2 KB')
    // 1048576 bytes = 1 MB
    expect(formatFileSize(1048576)).toBe('1 MB')
  })
})
