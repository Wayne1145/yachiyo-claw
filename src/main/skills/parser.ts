import type { SkillMetadata } from '@shared/types/skills'
import fs from 'fs'
import matter from 'gray-matter'
import { getLogger } from '../util'
import { isValidSkillName } from './validation'

const log = getLogger('skills:parser')

interface ParsedSkillFile {
  metadata: SkillMetadata
  body: string
}

/**
 * Parse a SKILL.md file, extracting frontmatter metadata and body content.
 * Returns null for malformed files (missing name or description).
 */
export function parseSkillFile(skillMdPath: string, directoryName?: string): ParsedSkillFile | null {
  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8')
    const { data, content: body } = matter(content)

    if (!data.name || typeof data.name !== 'string') {
      log.warn(`Skill file missing or invalid 'name' field: ${skillMdPath}`)
      return null
    }
    if (!data.description || typeof data.description !== 'string') {
      log.warn(`Skill file missing or invalid 'description' field: ${skillMdPath}`)
      return null
    }

    let skillName = data.name as string
    const skillDescription = data.description as string

    if (directoryName && skillName !== directoryName) {
      if (!isValidSkillName(directoryName)) {
        log.warn(
          `Skill directory name has invalid format (must be lowercase alphanumeric + hyphens, 1-64 chars): ` +
            `${skillMdPath}`
        )
        return null
      }
      log.warn(
        `Skill name "${skillName}" doesn't match directory name "${directoryName}" in ${skillMdPath}. ` +
          'Using directory name.'
      )
      skillName = directoryName
    }

    if (!isValidSkillName(skillName)) {
      log.warn(
        `Skill file has invalid name format (must be lowercase alphanumeric + hyphens, 1-64 chars): ${skillMdPath}`
      )
      return null
    }

    if (skillDescription.length > 1024) {
      log.warn(`Skill file description exceeds 1024 characters: ${skillMdPath}`)
      return null
    }

    const metadata: SkillMetadata = {
      name: skillName,
      description: skillDescription,
    }

    if (data.license && typeof data.license === 'string') {
      metadata.license = data.license as string
    }
    const isValidCompatibility = typeof data.compatibility === 'string' && data.compatibility.length <= 500
    if (isValidCompatibility) {
      metadata.compatibility = data.compatibility as string
    }
    if (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)) {
      const filtered: Record<string, string> = {}
      for (const [key, value] of Object.entries(data.metadata as Record<string, unknown>)) {
        if (typeof value === 'string') {
          filtered[key] = value
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          filtered[key] = String(value)
        }
      }
      if (Object.keys(filtered).length > 0) {
        metadata.metadata = filtered
      }
    }
    if (Array.isArray(data.allowedTools)) {
      metadata.allowedTools = data.allowedTools.filter((t: unknown) => typeof t === 'string')
    }

    const trimmedBody = body.trim()
    const bodyTokenEstimate = Math.ceil(trimmedBody.length / 4)
    if (bodyTokenEstimate > 5000) {
      log.warn(`Skill "${skillName}" body is ~${bodyTokenEstimate} tokens (recommended < 5000): ${skillMdPath}`)
    }

    return { metadata, body: trimmedBody }
  } catch (error) {
    log.error(`Failed to parse skill file: ${skillMdPath}`, error)
    return null
  }
}
