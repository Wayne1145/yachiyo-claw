export function parseImage(base64: string) {
  // data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAChA...
  base64 = base64.replace(/^data:/, '')
  const markIndex = base64.indexOf(';')
  if (markIndex < 0) {
    return { type: '', data: '' }
  }
  const type = base64.slice(0, markIndex)
  base64 = base64.slice(markIndex + 1)
  base64 = base64.replace(/^base64,/, '')
  const data = base64
  return { type, data }
}
