import { describe, expect, it } from 'vitest'
import { processLaTeX } from './latex'

describe('processLaTeX', () => {
  const complexFormula = '\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi ix\\xi} \\,dx'
  const simpleExpression = '1 + 2 = 3'

  describe('inline LaTeX with $ delimiters', () => {
    it('should process complex formula', () => {
      const input = `$${complexFormula}$`
      const result = processLaTeX(input)
      expect(result).toBe(input)
    })

    it('should process expression starting with number', () => {
      const input = `$${simpleExpression}$`
      const result = processLaTeX(input)
      expect(result).toBe(input)
    })
  })

  describe('inline LaTeX with \\( \\) delimiters', () => {
    it('should convert complex formula to $ delimiters', () => {
      const input = `\\(${complexFormula}\\)`
      const expected = `$${complexFormula}$`
      const result = processLaTeX(input)
      expect(result).toBe(expected)
    })

    it('should convert expression starting with number to $ delimiters', () => {
      const input = `\\(${simpleExpression}\\)`
      const expected = `$${simpleExpression}$`
      const result = processLaTeX(input)
      expect(result).toBe(expected)
    })
  })

  describe('block LaTeX with $$ delimiters', () => {
    it('should process complex formula', () => {
      const input = `
$$
${complexFormula}
$$
`
      const result = processLaTeX(input)
      expect(result).toBe(input)
    })

    it('should process expression starting with number', () => {
      const input = `
$$
${simpleExpression}
$$
      `
      const result = processLaTeX(input)
      expect(result).toBe(input)
    })
  })

  describe('block LaTeX with \\[ \\] delimiters', () => {
    it('should convert complex formula to $$ delimiters', () => {
      const input = `
\\[
${complexFormula}
\\]
`
      const expected = `
$$
${complexFormula}
$$
`
      const result = processLaTeX(input)
      expect(result).toBe(expected)
    })

    it('should convert expression starting with number to $$ delimiters', () => {
      const input = `
\\[
${simpleExpression}
\\]
      `
      const expected = `
$$
${simpleExpression}
$$
      `
      const result = processLaTeX(input)
      expect(result).toBe(expected)
    })
  })
})
