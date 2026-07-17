export const SKILL_NAME_RE = /^[a-z0-9-]+$/

export function isValidSkillName(value: string): boolean {
  return value.length > 0 && value.length <= 64 && SKILL_NAME_RE.test(value)
}
