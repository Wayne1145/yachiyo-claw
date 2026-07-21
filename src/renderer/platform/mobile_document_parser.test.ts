// @vitest-environment jsdom
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { MobileDocumentParseError, parseDocxFileLocally, parsePdfFileLocally } from './mobile_document_parser'

function createPdf(): File {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 42 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET\nendstream',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(body).length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = new TextEncoder().encode(body).length
  body += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, '0')} 00000 n `)
    .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  const buffer = new TextEncoder().encode(body).buffer as ArrayBuffer
  const file = new File([buffer], 'sample.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buffer })
  return file
}

async function createDocx(xml: string): Promise<File> {
  const zip = new JSZip()
  zip.file('word/document.xml', xml)
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const buffer = new Uint8Array(bytes).buffer as ArrayBuffer
  const file = new File([buffer], 'document.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buffer })
  return file
}

describe('mobile document parser', () => {
  it('extracts text from PDF pages without a remote parser', async () => {
    await expect(parsePdfFileLocally(createPdf())).resolves.toContain('Hello PDF')
  })

  it('extracts paragraphs, tabs, line breaks, and CJK text from DOCX', async () => {
    const file = await createDocx(`<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>第一段</w:t></w:r><w:r><w:tab/><w:t>内容</w:t></w:r></w:p>
          <w:p><w:r><w:t xml:space="preserve">Second </w:t><w:br/><w:t>line</w:t></w:r></w:p>
        </w:body>
      </w:document>`)

    await expect(parseDocxFileLocally(file)).resolves.toBe('第一段\t内容\n\nSecond\nline')
  })

  it('rejects DOCX archives without readable Word text', async () => {
    const zip = new JSZip()
    zip.file('other.xml', '<root />')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const buffer = new Uint8Array(bytes).buffer as ArrayBuffer
    const file = new File([buffer], 'empty.docx')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => buffer })

    await expect(parseDocxFileLocally(file)).rejects.toEqual(
      expect.objectContaining<Partial<MobileDocumentParseError>>({ code: 'mobile_docx_text_unavailable' }),
    )
  })
})
