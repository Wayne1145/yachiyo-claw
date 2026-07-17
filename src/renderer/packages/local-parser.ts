import { v4 as uuidv4 } from 'uuid'
import platform from '@/platform'
import * as remote from './remote'

export async function parseTextFile(file: File, options: { maxLength?: number } = {}) {
  let text = await file.text()
  if (options.maxLength) {
    text = text.trim().slice(0, options.maxLength)
  }
  const key = `parseFile-` + uuidv4()
  await platform.setStoreBlob(key, text)
  return { key }
}

export async function parseUrl(url: string) {
  const result = await remote.parseUserLinkFree({ url })
  const key = `parseUrl-` + uuidv4()
  await platform.setStoreBlob(key, result.text)
  return { key, title: result.title }
}
