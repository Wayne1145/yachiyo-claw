import { StorageKeyGenerator } from '@/storage/StoreStorage'
import type { PreConstructedMessageState, PreprocessedFile, PreprocessedLink } from '../../types/input-box'
export type { PreConstructedMessageState }

function getFileKeys(file: File, additionalKeys: Iterable<string> = []): Set<string> {
  const keys = new Set(additionalKeys)
  keys.add(StorageKeyGenerator.fileUniqKey(file))
  return keys
}

function fileKeyMatches(file: File, keys: Set<string>): boolean {
  return keys.has(StorageKeyGenerator.fileUniqKey(file))
}

// ----- Link helpers -----

export function markLinkProcessing(prev: PreConstructedMessageState, url: string): PreConstructedMessageState {
  const key = StorageKeyGenerator.linkUniqKey(url)
  return {
    ...prev,
    preprocessingStatus: {
      ...prev.preprocessingStatus,
      links: {
        ...prev.preprocessingStatus.links,
        [key]: 'processing',
      },
    },
  }
}

export function storeLinkPromise(
  prev: PreConstructedMessageState,
  url: string,
  promise: Promise<unknown>
): PreConstructedMessageState {
  const key = StorageKeyGenerator.linkUniqKey(url)
  const newPromises = new Map(prev.preprocessingPromises.links)
  newPromises.set(key, promise)
  return {
    ...prev,
    preprocessingPromises: {
      ...prev.preprocessingPromises,
      links: newPromises,
    },
  }
}

export function onLinkProcessed(
  prev: PreConstructedMessageState,
  url: string,
  item: PreprocessedLink,
  max: number = 6
): PreConstructedMessageState {
  const key = StorageKeyGenerator.linkUniqKey(url)
  if (prev.preprocessingStatus.links[key] !== 'processing') {
    return prev
  }
  const newPromises = new Map(prev.preprocessingPromises.links)
  newPromises.delete(key)

  const nextLinks = [...prev.preprocessedLinks.filter((l) => l.url !== url), item].slice(-max)

  return {
    ...prev,
    preprocessedLinks: nextLinks,
    preprocessingStatus: {
      ...prev.preprocessingStatus,
      links: {
        ...prev.preprocessingStatus.links,
        [key]: item.error ? 'error' : 'completed',
      },
    },
    preprocessingPromises: {
      ...prev.preprocessingPromises,
      links: newPromises,
    },
  }
}

export function cleanupLink(prev: PreConstructedMessageState, url: string): PreConstructedMessageState {
  const key = StorageKeyGenerator.linkUniqKey(url)
  const newLinkPromises = new Map(prev.preprocessingPromises.links)
  newLinkPromises.delete(key)

  return {
    ...prev,
    preprocessedLinks: prev.preprocessedLinks.filter((l) => l.url !== url),
    preprocessingStatus: {
      ...prev.preprocessingStatus,
      links: {
        ...prev.preprocessingStatus.links,
        [key]: undefined,
      },
    },
    preprocessingPromises: {
      ...prev.preprocessingPromises,
      links: newLinkPromises,
    },
  }
}

// ----- File helpers -----

export function markFileProcessing(prev: PreConstructedMessageState, file: File): PreConstructedMessageState {
  const key = StorageKeyGenerator.fileUniqKey(file)
  return {
    ...prev,
    preprocessingStatus: {
      ...prev.preprocessingStatus,
      files: {
        ...prev.preprocessingStatus.files,
        [key]: 'processing',
      },
    },
  }
}

export function storeFilePromise(
  prev: PreConstructedMessageState,
  file: File,
  promise: Promise<unknown>
): PreConstructedMessageState {
  const key = StorageKeyGenerator.fileUniqKey(file)
  const newPromises = new Map(prev.preprocessingPromises.files)
  newPromises.set(key, promise)
  return {
    ...prev,
    preprocessingPromises: {
      ...prev.preprocessingPromises,
      files: newPromises,
    },
  }
}

export function onFileProcessed(
  prev: PreConstructedMessageState,
  file: File,
  item: PreprocessedFile,
  max: number = 20,
  options: { fileKeys?: Iterable<string> } = {}
): PreConstructedMessageState {
  const keys = getFileKeys(file, options.fileKeys)
  const key = Array.from(keys).find((candidateKey) => prev.preprocessingStatus.files[candidateKey] === 'processing')
  if (!key) {
    return prev
  }
  const newPromises = new Map(prev.preprocessingPromises.files)
  for (const fileKey of keys) {
    newPromises.delete(fileKey)
  }

  const nextFiles = [...prev.preprocessedFiles, item].slice(-max)
  const nextFileStatuses = { ...prev.preprocessingStatus.files }
  for (const fileKey of keys) {
    nextFileStatuses[fileKey] = fileKey === key ? (item.error ? 'error' : 'completed') : undefined
  }

  return {
    ...prev,
    preprocessedFiles: nextFiles,
    preprocessingStatus: {
      ...prev.preprocessingStatus,
      files: nextFileStatuses,
    },
    preprocessingPromises: {
      ...prev.preprocessingPromises,
      files: newPromises,
    },
  }
}

export function cleanupFile(
  prev: PreConstructedMessageState,
  file: File,
  options: { fileKeys?: Iterable<string>; removeAttachment?: boolean } = {}
): PreConstructedMessageState {
  const keys = getFileKeys(file, options.fileKeys)
  const newFilePromises = new Map(prev.preprocessingPromises.files)
  for (const key of keys) {
    newFilePromises.delete(key)
  }

  const nextFileStatuses = { ...prev.preprocessingStatus.files }
  for (const key of keys) {
    nextFileStatuses[key] = undefined
  }

  return {
    ...prev,
    attachments: options.removeAttachment ? prev.attachments.filter((f) => !fileKeyMatches(f, keys)) : prev.attachments,
    preprocessedFiles: prev.preprocessedFiles.filter((f) => !fileKeyMatches(f.file, keys)),
    preprocessingStatus: {
      ...prev.preprocessingStatus,
      files: nextFileStatuses,
    },
    preprocessingPromises: {
      ...prev.preprocessingPromises,
      files: newFilePromises,
    },
  }
}
