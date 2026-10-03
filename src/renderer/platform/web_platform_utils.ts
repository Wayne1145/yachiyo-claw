import { isTextFilePath } from '@shared/file-extensions'

export async function parseTextFileLocally(file: File): Promise<{ text: string; isSupported: boolean }> {
  const lowerName = file.name.toLocaleLowerCase()
  if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
    const { parsePdfFileLocally } = await import('./mobile_document_parser')
    return { text: await parsePdfFileLocally(file), isSupported: true }
  }
  if (
    lowerName.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const { parseDocxFileLocally } = await import('./mobile_document_parser')
    return { text: await parseDocxFileLocally(file), isSupported: true }
  }
  if (!isTextFilePath(file.name)) {
    // 只在桌面端有 attachment.path，网页版本只有 attachment.name
    return { text: '', isSupported: false }
  }
  const text = await file.text()
  return { text, isSupported: true }
}
