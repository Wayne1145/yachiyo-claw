import { Base64 } from 'js-base64'

export function decodeBase64(str: string) {
  return Base64.decode(str.replaceAll(' ', '+'))
}
