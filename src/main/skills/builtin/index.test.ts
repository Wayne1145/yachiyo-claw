import { describe, expect, it } from 'vitest'
import { getBuiltinSkill, listBuiltinSkillInfos } from './index'

describe('built-in Skills registry', () => {
  it('publishes discoverable metadata and loadable bodies', () => {
    const infos = listBuiltinSkillInfos()
    expect(infos.map((skill) => skill.name)).toEqual([
      'translation-expert',
      'code-review',
      'writing-assistant',
      'data-analysis',
    ])
    expect(infos.every((skill) => skill.isBuiltin && skill.path.startsWith('builtin://'))).toBe(true)
    expect(getBuiltinSkill('code-review')?.body).toContain('# Code Review Specialist')
    expect(getBuiltinSkill('missing')).toBeUndefined()
  })
})
