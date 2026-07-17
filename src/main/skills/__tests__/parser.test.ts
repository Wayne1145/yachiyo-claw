import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSkillFile } from '../parser'

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
}))

vi.mock('gray-matter', () => ({
  default: vi.fn(),
}))

vi.mock('../../util', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

import fs from 'fs'
import matter from 'gray-matter'

const mockedReadFileSync = vi.mocked(fs.readFileSync)
const mockedMatter = vi.mocked(matter)

describe('parseSkillFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should parse valid SKILL.md with frontmatter and body', () => {
    const rawContent = '---\nname: my-skill\ndescription: A test skill\n---\n# Instructions\nDo something useful.'
    mockedReadFileSync.mockReturnValue(rawContent)
    mockedMatter.mockReturnValue({
      data: { name: 'my-skill', description: 'A test skill' },
      content: '\n# Instructions\nDo something useful.',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')

    expect(result).not.toBeNull()
    expect(result!.metadata.name).toBe('my-skill')
    expect(result!.metadata.description).toBe('A test skill')
    expect(result!.body).toBe('# Instructions\nDo something useful.')
  })

  it('should return null for missing name field', () => {
    mockedReadFileSync.mockReturnValue('---\ndescription: A test skill\n---\nBody')
    mockedMatter.mockReturnValue({
      data: { description: 'A test skill' },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')
    expect(result).toBeNull()
  })

  it('should return null for missing description field', () => {
    mockedReadFileSync.mockReturnValue('---\nname: my-skill\n---\nBody')
    mockedMatter.mockReturnValue({
      data: { name: 'my-skill' },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')
    expect(result).toBeNull()
  })

  it('should return null for invalid name format (uppercase, spaces)', () => {
    mockedReadFileSync.mockReturnValue('---\nname: My Skill\ndescription: desc\n---\nBody')
    mockedMatter.mockReturnValue({
      data: { name: 'My Skill', description: 'desc' },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')
    expect(result).toBeNull()
  })

  it('should use directory name when frontmatter name differs', () => {
    mockedReadFileSync.mockReturnValue('raw')
    mockedMatter.mockReturnValue({
      data: { name: 'wrong-name', description: 'A test skill' },
      content: 'Body content',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md', 'correct-name')

    expect(result).not.toBeNull()
    expect(result!.metadata.name).toBe('correct-name')
  })

  it('should return null for name exceeding 64 characters', () => {
    const longName = 'a'.repeat(65)
    mockedReadFileSync.mockReturnValue('raw')
    mockedMatter.mockReturnValue({
      data: { name: longName, description: 'desc' },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')
    expect(result).toBeNull()
  })

  it('should return null for description exceeding 1024 characters', () => {
    const longDescription = 'a'.repeat(1025)
    mockedReadFileSync.mockReturnValue('raw')
    mockedMatter.mockReturnValue({
      data: { name: 'my-skill', description: longDescription },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')
    expect(result).toBeNull()
  })

  it('should handle empty file gracefully (fs throws)', () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    const result = parseSkillFile('/nonexistent/SKILL.md')
    expect(result).toBeNull()
  })

  it('should extract optional fields (license, compatibility, metadata, allowedTools)', () => {
    mockedReadFileSync.mockReturnValue('raw')
    mockedMatter.mockReturnValue({
      data: {
        name: 'my-skill',
        description: 'A test skill',
        license: 'MIT',
        compatibility: 'chatbox >= 1.0',
        metadata: { author: 'test', version: '1.0' },
        allowedTools: ['web_search', 'file_read'],
      },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')

    expect(result).not.toBeNull()
    expect(result!.metadata.license).toBe('MIT')
    expect(result!.metadata.compatibility).toBe('chatbox >= 1.0')
    expect(result!.metadata.metadata).toEqual({ author: 'test', version: '1.0' })
    expect(result!.metadata.allowedTools).toEqual(['web_search', 'file_read'])
  })

  it('should ignore compatibility if too long (>500 chars)', () => {
    mockedReadFileSync.mockReturnValue('raw')
    mockedMatter.mockReturnValue({
      data: {
        name: 'my-skill',
        description: 'A test skill',
        compatibility: 'a'.repeat(501),
      },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')

    expect(result).not.toBeNull()
    expect(result!.metadata.compatibility).toBeUndefined()
  })

  it('should filter out non-string allowedTools entries', () => {
    mockedReadFileSync.mockReturnValue('raw')
    mockedMatter.mockReturnValue({
      data: {
        name: 'my-skill',
        description: 'A test skill',
        allowedTools: ['web_search', 42, null, 'file_read'],
      },
      content: 'Body',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')

    expect(result).not.toBeNull()
    expect(result!.metadata.allowedTools).toEqual(['web_search', 'file_read'])
  })

  it('should trim body whitespace', () => {
    mockedReadFileSync.mockReturnValue('raw')
    mockedMatter.mockReturnValue({
      data: { name: 'my-skill', description: 'desc' },
      content: '\n\n  Body content  \n\n',
    } as unknown as ReturnType<typeof matter>)

    const result = parseSkillFile('/path/to/SKILL.md')

    expect(result).not.toBeNull()
    expect(result!.body).toBe('Body content')
  })
})
