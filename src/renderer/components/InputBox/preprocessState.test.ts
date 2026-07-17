import { describe, expect, it, vi } from 'vitest'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import type { PreConstructedMessageState } from '../../types/input-box'
import { cleanupFile, onFileProcessed } from './preprocessState'

vi.mock('@/platform', () => ({
  default: {
    getStorageType: () => 'test',
  },
}))

function createState(file: File, fileKey: string): PreConstructedMessageState {
  return {
    draftMessageId: 'draft-1',
    text: '',
    pictureKeys: [],
    attachments: [file],
    links: [],
    preprocessedFiles: [
      {
        file,
        content: 'content',
        storageKey: fileKey,
      },
    ],
    preprocessedLinks: [],
    preprocessingStatus: {
      files: {
        [fileKey]: 'processing',
      },
      links: {},
    },
    preprocessingPromises: {
      files: new Map([[fileKey, Promise.resolve()]]),
      links: new Map(),
    },
  }
}

describe('cleanupFile', () => {
  it('removes a file when native path lookup changes the file key during deletion', () => {
    const file = new File(['content'], 'document.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      lastModified: 1710000000000,
    })
    const originalFileKey = StorageKeyGenerator.fileUniqKey(file)
    const prev = createState(file, originalFileKey)

    Object.defineProperty(file, 'path', {
      value: '/tmp/document.docx',
      configurable: true,
    })
    const fileKeyAfterPathLookup = StorageKeyGenerator.fileUniqKey(file)

    const next = cleanupFile(prev, file, {
      fileKeys: [originalFileKey, fileKeyAfterPathLookup],
      removeAttachment: true,
    })

    expect(next.attachments).toEqual([])
    expect(next.preprocessedFiles).toEqual([])
    expect(next.preprocessingStatus.files[originalFileKey]).toBeUndefined()
    expect(next.preprocessingStatus.files[fileKeyAfterPathLookup]).toBeUndefined()
    expect(next.preprocessingPromises.files.has(originalFileKey)).toBe(false)
    expect(next.preprocessingPromises.files.has(fileKeyAfterPathLookup)).toBe(false)
  })
})

describe('onFileProcessed', () => {
  it('completes processing when native path lookup changes the file key', () => {
    const file = new File(['content'], 'document.pdf', {
      type: 'application/pdf',
      lastModified: 1710000000000,
    })
    const originalFileKey = StorageKeyGenerator.fileUniqKey(file)
    const prev = createState(file, originalFileKey)

    Object.defineProperty(file, 'path', {
      value: '/tmp/document.pdf',
      configurable: true,
    })
    const fileKeyAfterPathLookup = StorageKeyGenerator.fileUniqKey(file)

    const next = onFileProcessed(
      prev,
      file,
      {
        file,
        inputFileKey: originalFileKey,
        content: 'parsed content',
        storageKey: originalFileKey,
      },
      20,
      { fileKeys: [originalFileKey, fileKeyAfterPathLookup] }
    )

    expect(next.preprocessingStatus.files[originalFileKey]).toBe('completed')
    expect(next.preprocessingStatus.files[fileKeyAfterPathLookup]).toBeUndefined()
    expect(next.preprocessingPromises.files.has(originalFileKey)).toBe(false)
    expect(next.preprocessingPromises.files.has(fileKeyAfterPathLookup)).toBe(false)
    expect(next.preprocessedFiles.at(-1)?.inputFileKey).toBe(originalFileKey)
  })
})
