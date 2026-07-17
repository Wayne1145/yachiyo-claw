import { describe, expect, it } from 'vitest'
import { isTextFile, isPdf, isWord, isPPT, isExcel } from './filetype'

function mockFile(type: string): File {
  return new File([''], 'test', { type })
}

describe('filetype utilities', () => {
  describe('isTextFile', () => {
    it('returns true for text/* MIME types', () => {
      expect(isTextFile(mockFile('text/plain'))).toBe(true)
      expect(isTextFile(mockFile('text/html'))).toBe(true)
      expect(isTextFile(mockFile('text/css'))).toBe(true)
      expect(isTextFile(mockFile('text/csv'))).toBe(true)
    })

    it('returns true for application text formats', () => {
      expect(isTextFile(mockFile('application/json'))).toBe(true)
      expect(isTextFile(mockFile('application/xml'))).toBe(true)
      expect(isTextFile(mockFile('application/x-yaml'))).toBe(true)
      expect(isTextFile(mockFile('application/x-toml'))).toBe(true)
      expect(isTextFile(mockFile('application/x-sh'))).toBe(true)
      expect(isTextFile(mockFile('application/javascript'))).toBe(true)
    })

    it('returns true for empty MIME type', () => {
      expect(isTextFile(mockFile(''))).toBe(true)
    })

    it('returns false for binary formats', () => {
      expect(isTextFile(mockFile('application/pdf'))).toBe(false)
      expect(isTextFile(mockFile('image/png'))).toBe(false)
      expect(isTextFile(mockFile('application/zip'))).toBe(false)
    })
  })

  describe('isPdf', () => {
    it('returns true for PDF files', () => {
      expect(isPdf(mockFile('application/pdf'))).toBe(true)
    })

    it('returns false for non-PDF files', () => {
      expect(isPdf(mockFile('text/plain'))).toBe(false)
      expect(isPdf(mockFile('application/msword'))).toBe(false)
    })
  })

  describe('isWord', () => {
    it('returns true for .doc files', () => {
      expect(isWord(mockFile('application/msword'))).toBe(true)
    })

    it('returns true for .docx files', () => {
      expect(isWord(mockFile('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe(true)
    })

    it('returns false for non-Word files', () => {
      expect(isWord(mockFile('application/pdf'))).toBe(false)
      expect(isWord(mockFile('text/plain'))).toBe(false)
    })
  })

  describe('isPPT', () => {
    it('returns true for .ppt files', () => {
      expect(isPPT(mockFile('application/vnd.ms-powerpoint'))).toBe(true)
    })

    it('returns true for .pptx files', () => {
      expect(isPPT(mockFile('application/vnd.openxmlformats-officedocument.presentationml.presentation'))).toBe(true)
    })

    it('returns false for non-PPT files', () => {
      expect(isPPT(mockFile('application/pdf'))).toBe(false)
    })
  })

  describe('isExcel', () => {
    it('returns true for .xls files', () => {
      expect(isExcel(mockFile('application/vnd.ms-excel'))).toBe(true)
    })

    it('returns true for .xlsx files', () => {
      expect(isExcel(mockFile('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe(true)
    })

    it('returns false for non-Excel files', () => {
      expect(isExcel(mockFile('application/pdf'))).toBe(false)
    })
  })
})
