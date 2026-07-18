const BLOCKED_ELEMENTS = 'script,foreignObject,iframe,object,embed'
const SCRIPTABLE_URL = /^\s*(?:javascript|data\s*:\s*text\/html)/i

export function sanitizeSvgMarkup(svg: string): string {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
    throw new Error('invalid_svg')
  }

  document.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove())
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name.endsWith(':href')) && SCRIPTABLE_URL.test(attribute.value))) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return new XMLSerializer().serializeToString(document.documentElement)
}
