/**
 * 可以判断当前文件是否为常见的文本文件
 */
export function isTextFile(file: File) {
  return (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/xml' ||
    file.type === 'application/x-yaml' ||
    file.type === 'application/x-toml' ||
    file.type === 'application/x-sh' ||
    file.type === 'application/javascript' ||
    file.type === ''
  )
}

export function isPdf(file: File) {
  return file.type === 'application/pdf'
}

export function isWord(file: File) {
  return (
    file.type === 'application/msword' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

export function isPPT(file: File) {
  return (
    file.type === 'application/vnd.ms-powerpoint' ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
}

export function isExcel(file: File) {
  return (
    file.type === 'application/vnd.ms-excel' ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}
