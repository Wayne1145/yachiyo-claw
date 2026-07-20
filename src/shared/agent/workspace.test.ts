import { describe, expect, it } from 'vitest'
import { validateWorkspaceRelativePath } from './workspace'

describe('workspace contracts', () => {
  it('accepts relative paths and rejects traversal/absolute paths', () => {
    expect(validateWorkspaceRelativePath('src/main.ts')).toBe('src/main.ts')
    expect(() => validateWorkspaceRelativePath('../secrets')).toThrow('workspace_path_traversal')
    expect(() => validateWorkspaceRelativePath('/etc/passwd')).toThrow('workspace_path_must_be_relative')
    expect(() => validateWorkspaceRelativePath('C:/repo/file.ts')).toThrow('workspace_path_must_be_relative')
  })
})

