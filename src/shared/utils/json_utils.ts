/**
 * 解析 JSON 字符串，如果解析失败则返回空对象
 * @param json 要解析的 JSON 字符串
 * @returns 解析后的对象，解析失败时返回空对象
 */
export function parseJsonOrEmpty(json: string): any {
  try {
    return JSON.parse(json)
  } catch (e) {
    return {}
  }
}
