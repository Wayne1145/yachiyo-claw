import JSZip from 'jszip'

const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const MAX_EXTRACTED_CHARACTERS = 5_000_000
const MAX_DOCX_XML_BYTES = 32 * 1024 * 1024
const MAX_PDF_PAGES = 2_000

export class MobileDocumentParseError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'MobileDocumentParseError'
  }
}

function requireSupportedSize(file: File): void {
  if (!Number.isFinite(file.size) || file.size <= 0) throw new MobileDocumentParseError('mobile_document_empty')
  if (file.size > MAX_SOURCE_BYTES) throw new MobileDocumentParseError('mobile_document_too_large')
}

function appendBounded(parts: string[], value: string, currentLength: number): number {
  const nextLength = currentLength + value.length
  if (nextLength > MAX_EXTRACTED_CHARACTERS)
    throw new MobileDocumentParseError('mobile_document_extracted_text_too_large')
  parts.push(value)
  return nextLength
}

export async function parsePdfFileLocally(file: File): Promise<string> {
  requireSupportedSize(file)
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof Worker === 'undefined') {
    const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    ;(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = workerModule
  } else {
    GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  }
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useWorkerFetch: false,
  })
  const document = await loadingTask.promise
  try {
    if (document.numPages > MAX_PDF_PAGES) throw new MobileDocumentParseError('mobile_pdf_too_many_pages')
    const pages: string[] = []
    let length = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const lines: string[] = []
      let line = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        line += `${line && item.str ? ' ' : ''}${item.str}`
        if (item.hasEOL) {
          if (line.trim()) lines.push(line.trim())
          line = ''
        }
      }
      if (line.trim()) lines.push(line.trim())
      const pageText = lines.join('\n').trim()
      if (pageText) length = appendBounded(pages, pageText, length) + (pages.length > 1 ? 2 : 0)
    }
    return pages.join('\n\n')
  } finally {
    await document.destroy()
  }
}

interface ZipEntryWithSize {
  _data?: { uncompressedSize?: number }
}

function docxParagraphText(paragraph: Element): string {
  const output: string[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE && node.parentElement?.localName === 't') {
      output.push(node.nodeValue || '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (element.localName === 'tab') output.push('\t')
    else if (element.localName === 'br' || element.localName === 'cr') output.push('\n')
    for (const child of Array.from(element.childNodes)) visit(child)
  }
  visit(paragraph)
  return output
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function parseWordXml(xml: string): string {
  if (xml.length > MAX_DOCX_XML_BYTES) throw new MobileDocumentParseError('mobile_docx_xml_too_large')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) throw new MobileDocumentParseError('mobile_docx_xml_invalid')
  const paragraphs = Array.from(document.getElementsByTagNameNS('*', 'p'))
  const parts: string[] = []
  let length = 0
  for (const paragraph of paragraphs) {
    const text = docxParagraphText(paragraph)
    if (!text) continue
    length = appendBounded(parts, text, length) + 2
  }
  return parts.join('\n\n')
}

export async function parseDocxFileLocally(file: File): Promise<string> {
  requireSupportedSize(file)
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), {
    // CRC validation expands every entry; target entries are instead bounded by their declared size before extraction.
    checkCRC32: false,
    createFolders: false,
  })
  const paths = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']
  const parts: string[] = []
  let totalXmlBytes = 0
  for (const path of paths) {
    const entry = zip.file(path)
    if (!entry) continue
    const declaredSize = (entry as unknown as ZipEntryWithSize)._data?.uncompressedSize
    if (typeof declaredSize === 'number') {
      totalXmlBytes += declaredSize
      if (declaredSize > MAX_DOCX_XML_BYTES || totalXmlBytes > MAX_DOCX_XML_BYTES)
        throw new MobileDocumentParseError('mobile_docx_xml_too_large')
    }
    const text = parseWordXml(await entry.async('string'))
    if (text) parts.push(text)
  }
  if (!parts.length) throw new MobileDocumentParseError('mobile_docx_text_unavailable')
  const result = parts.join('\n\n')
  if (result.length > MAX_EXTRACTED_CHARACTERS)
    throw new MobileDocumentParseError('mobile_document_extracted_text_too_large')
  return result
}
