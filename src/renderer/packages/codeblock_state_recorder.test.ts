import { afterEach, describe, expect, it } from 'vitest'
import { calculateState, needCollapse, saveState } from './codeblock_state_recorder'

describe('codeblock_state_recorder', () => {
  describe('calculateState', () => {
    it('counts lines correctly', () => {
      const state = calculateState({ content: 'line1\nline2\nline3', language: 'js' })
      expect(state.lines).toBe(3)
    })

    it('single line content has 1 line', () => {
      const state = calculateState({ content: 'single line', language: 'ts' })
      expect(state.lines).toBe(1)
    })

    it('does not collapse when preferCollapsed is false', () => {
      const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
      const state = calculateState({ content, language: 'js', preferCollapsed: false })
      expect(state.shouldCollapse).toBe(false)
      expect(state.collapsed).toBe(false)
    })

    it('does not collapse when preferCollapsed is true but lines <= 6', () => {
      const state = calculateState({ content: 'a\nb\nc\nd\ne\nf', language: 'js', preferCollapsed: true })
      expect(state.lines).toBe(6)
      expect(state.shouldCollapse).toBe(false)
      expect(state.collapsed).toBe(false)
    })

    it('collapses when preferCollapsed is true and lines > 6', () => {
      const content = Array.from({ length: 7 }, (_, i) => `line ${i}`).join('\n')
      const state = calculateState({ content, language: 'js', preferCollapsed: true })
      expect(state.lines).toBe(7)
      expect(state.shouldCollapse).toBe(true)
      expect(state.collapsed).toBe(true)
    })
  })

  describe('needCollapse', () => {
    it('returns non-collapsed state when generating', () => {
      const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
      const state = needCollapse({ content, language: 'js', generating: true, preferCollapsed: true })
      expect(state.collapsed).toBe(false)
      expect(state.shouldCollapse).toBe(false)
      expect(state.lines).toBe(0)
    })

    it('returns calculated state for new content', () => {
      const content = 'unique_content_' + Math.random()
      const state = needCollapse({ content, language: 'py' })
      expect(state.lines).toBe(1)
    })

    it('returns saved state if previously saved', () => {
      const content = 'saved_content_' + Math.random()
      const options = { content, language: 'rs', preferCollapsed: true }
      // First calculate — not yet saved
      const initial = needCollapse(options)

      // Save with collapsed toggled
      saveState({ ...options, collapsed: !initial.collapsed })

      // Should return the saved state
      const retrieved = needCollapse(options)
      expect(retrieved.collapsed).toBe(!initial.collapsed)
    })
  })

  describe('saveState', () => {
    it('persists the collapsed override', () => {
      const content = 'persist_test_' + Math.random()
      const options = { content, language: 'go', preferCollapsed: true }
      const saved = saveState({ ...options, collapsed: false })
      expect(saved.collapsed).toBe(false)
      expect(saved.shouldCollapse).toBe(false) // 1 line, not enough to collapse
    })

    it('handles large content correctly', () => {
      const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
      const options = { content, language: 'java', preferCollapsed: true }
      const saved = saveState({ ...options, collapsed: true })
      expect(saved.lines).toBe(100)
      expect(saved.shouldCollapse).toBe(true)
      expect(saved.collapsed).toBe(true)
    })
  })
})
