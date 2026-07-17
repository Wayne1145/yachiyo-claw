import { describe, expect, it } from 'vitest'
import { createNewChatButtonToolPart, createSuggestedQuestionsToolPart, shouldGuideEnterCompleted } from './utils'

describe('createSuggestedQuestionsToolPart', () => {
  it('creates a result tool part for suggested questions', () => {
    const part = createSuggestedQuestionsToolPart('suggested-123')

    expect(part).toEqual({
      type: 'tool-show_suggested_questions',
      toolCallId: 'suggested-123',
      toolName: 'show_suggested_questions',
      state: 'result',
      result: { displayed: true },
    })
  })
})

describe('createNewChatButtonToolPart', () => {
  it('creates a result tool part for the new chat button', () => {
    const part = createNewChatButtonToolPart('new-chat-123')

    expect(part).toEqual({
      type: 'tool-show_new_chat_button',
      toolCallId: 'new-chat-123',
      toolName: 'show_new_chat_button',
      state: 'result',
      result: { displayed: true },
    })
  })

  it('adds an optional custom label', () => {
    const part = createNewChatButtonToolPart('new-chat-123', { label: 'Click here to start a new chat' })

    expect(part.result).toEqual({
      displayed: true,
      label: 'Click here to start a new chat',
    })
  })
})

describe('shouldGuideEnterCompleted', () => {
  it('returns true when onboarding has been completed', () => {
    expect(shouldGuideEnterCompleted({ onboardingCompleted: true, isLoggedIn: false, hasValidConfig: false })).toBe(
      true
    )
  })

  it('returns true when user is logged in, even without valid config', () => {
    expect(shouldGuideEnterCompleted({ onboardingCompleted: false, isLoggedIn: true, hasValidConfig: false })).toBe(
      true
    )
  })

  it('returns true when user has valid config', () => {
    expect(shouldGuideEnterCompleted({ onboardingCompleted: false, isLoggedIn: false, hasValidConfig: true })).toBe(
      true
    )
  })

  it('returns false for truly new users', () => {
    expect(shouldGuideEnterCompleted({ onboardingCompleted: false, isLoggedIn: false, hasValidConfig: false })).toBe(
      false
    )
  })
})
