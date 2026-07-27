import type { SkillInfo } from '@shared/types/skills'

/**
 * Skills XML generation for system prompt injection (extracted from tools-builder.ts to break cycle).
 */

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function generateSkillsXml(skills: SkillInfo[], toolUseSupported = false): string {
  const skillEntries = skills
    .map(
      (s) => `<skill>
  <name>${escapeXml(s.name)}</name>
  <description>${escapeXml(s.description)}</description>
</skill>`
    )
    .join('\n')

  const toolHint = toolUseSupported
    ? [
        '',
        '<skills_usage>',
        'Scan the catalog before acting. When a task clearly matches a skill, call load_skill with its exact listed name before proceeding.',
        'Choose the most specific match. Load more than one only when each is necessary for a distinct part of the task.',
        'Follow the loaded instructions and referenced resources. Use execute_skill_script for a referenced script when that tool is available.',
        'Never invent an unlisted skill name, path, script, or instruction. If no skill matches, use the other available tools.',
        '</skills_usage>',
        '',
      ].join('\n')
    : '\n'

  return `
<available_skills>
${skillEntries}
</available_skills>
${toolHint}`
}
