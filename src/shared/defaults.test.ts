import { describe, it, expect } from 'vitest'
import { chatSessionSettings, getDefaultPrompt, newConfigs, pictureSessionSettings, settings } from './defaults'
import { YACHIYO_DEFAULT_MODEL } from './providers/definitions/yachiyo'
import { ModelProviderEnum, Theme, type Settings, type SessionSettings } from './types'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('defaults', () => {
  it('settings() returns expected default values', () => {
    const result: Settings = settings()

    expect(result.theme).toBe(Theme.Light)
    expect(result.language).toBe('en')
    expect(result.fontSize).toBe(14)
    expect(result.spellCheck).toBe(true)
    expect(result.showWordCount).toBe(false)
    expect(result.showTokenCount).toBe(false)
    expect(result.showTokenUsed).toBe(true)
    expect(result.extension?.webSearch?.provider).toBe('bing')
  })

  it('settings() returns allowReportingAndTracking as true', () => {
    expect(settings().allowReportingAndTracking).toBe(true)
  })

  it('settings() returns enableMarkdownRendering as true', () => {
    expect(settings().enableMarkdownRendering).toBe(true)
  })

  it('settings() returns shortcuts object with expected keys', () => {
    const result = settings().shortcuts

    expect(Object.keys(result).sort()).toEqual(
      [
        'quickToggle',
        'inputBoxFocus',
        'inputBoxWebBrowsingMode',
        'newChat',
        'newPictureChat',
        'sessionListNavNext',
        'sessionListNavPrev',
        'sessionListNavTargetIndex',
        'dialogOpenSearch',
        'inputBoxSendMessage',
        'inputBoxSendMessageWithoutResponse',
        'optionNavUp',
        'optionNavDown',
        'optionSelect',
      ].sort()
    )
  })

  it('newConfigs() returns object with uuid string', () => {
    const result = newConfigs()

    expect(typeof result.uuid).toBe('string')
    expect(result.uuid).toMatch(UUID_REGEX)
  })

  it('getDefaultPrompt() returns expected string', () => {
    expect(getDefaultPrompt()).toContain('你不是机器人。你是月见八千代。')
  })

  it('chatSessionSettings() returns provider and modelId', () => {
    const result: SessionSettings = chatSessionSettings()

    expect(result.provider).toBe(ModelProviderEnum.Yachiyo)
    expect(result.modelId).toBe(YACHIYO_DEFAULT_MODEL)
  })

  it('pictureSessionSettings() returns provider, modelId, dalleStyle, imageGenerateNum', () => {
    const result: SessionSettings = pictureSessionSettings()

    expect(result.provider).toBe(ModelProviderEnum.ChatboxAI)
    expect(result.modelId).toBe('DALL-E-3')
    expect(result.dalleStyle).toBe('vivid')
    expect(result.imageGenerateNum).toBe(1)
  })
})
