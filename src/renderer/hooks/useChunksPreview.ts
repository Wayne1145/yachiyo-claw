import type { KnowledgeBaseFile } from '@shared/types'
import { useState } from 'react'

export const useChunksPreview = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<KnowledgeBaseFile | null>(null)

  const openPreview = (file: KnowledgeBaseFile) => {
    setSelectedFile(file)
    setIsOpen(true)
  }

  const closePreview = () => {
    setIsOpen(false)
    setSelectedFile(null)
  }

  return {
    isOpen,
    selectedFile,
    openPreview,
    closePreview,
  }
}
