import * as codeReview from './code-review'
import * as dataAnalysis from './data-analysis'
import * as translationExpert from './translation-expert'
import * as writingAssistant from './writing-assistant'
import type { SkillInfo, SkillMetadata } from '../../../shared/types/skills'

export const builtinSkills = [translationExpert, codeReview, writingAssistant, dataAnalysis]

export interface BuiltinSkillDefinition {
  metadata: SkillMetadata
  body: string
}

export function getBuiltinSkill(name: string): BuiltinSkillDefinition | undefined {
  return builtinSkills.find((skill) => skill.metadata.name === name)
}

export function listBuiltinSkillInfos(): SkillInfo[] {
  return builtinSkills.map((skill) => ({
    ...skill.metadata,
    path: `builtin://${skill.metadata.name}`,
    isBuiltin: true,
    bodyTokenEstimate: Math.ceil(skill.body.length / 4),
    source: { type: 'builtin' },
  }))
}
