import type { SkillInfo } from '@shared/types/skills'
import { describe, expect, it } from 'vitest'
import { generateSkillsXml } from '../tools-builder'

function makeSkill(name: string, description: string): SkillInfo {
  return {
    name,
    description,
    path: `/skills/${name}`,
    isBuiltin: false,
  }
}

describe('generateSkillsXml', () => {
  it('should generate valid XML containing skill names and descriptions', () => {
    const skills: SkillInfo[] = [
      makeSkill('code-review', 'Review code for bugs and improvements'),
      makeSkill('translation', 'Translate text between languages'),
    ]

    const xml = generateSkillsXml(skills)

    expect(xml).toContain('<available_skills>')
    expect(xml).toContain('</available_skills>')
    expect(xml).toContain('<name>code-review</name>')
    expect(xml).toContain('<description>Review code for bugs and improvements</description>')
    expect(xml).toContain('<name>translation</name>')
    expect(xml).toContain('<description>Translate text between languages</description>')
  })

  it('should include all enabled skills', () => {
    const skills: SkillInfo[] = [
      makeSkill('skill-a', 'Description A'),
      makeSkill('skill-b', 'Description B'),
      makeSkill('skill-c', 'Description C'),
    ]

    const xml = generateSkillsXml(skills)

    const skillTagCount = (xml.match(/<skill>/g) || []).length
    expect(skillTagCount).toBe(3)
  })

  it('should handle empty skills array', () => {
    const xml = generateSkillsXml([])

    expect(xml).toContain('<available_skills>')
    expect(xml).toContain('</available_skills>')
    expect(xml).not.toContain('<skill>')
  })

  it('should include load_skill usage instruction when toolUseSupported is true', () => {
    const xml = generateSkillsXml([makeSkill('test', 'Test skill')], true)

    expect(xml).toContain('load_skill')
  })

  it('should not include load_skill usage instruction when toolUseSupported is false', () => {
    const xml = generateSkillsXml([makeSkill('test', 'Test skill')])

    expect(xml).not.toContain('load_skill')
  })

  it('should handle single skill', () => {
    const xml = generateSkillsXml([makeSkill('only-one', 'The only skill')])

    expect(xml).toContain('<name>only-one</name>')
    expect(xml).toContain('<description>The only skill</description>')
    const skillTagCount = (xml.match(/<skill>/g) || []).length
    expect(skillTagCount).toBe(1)
  })
})
