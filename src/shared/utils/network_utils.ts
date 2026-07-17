/**
 * 检查 URL 是否指向本地主机
 * @param url 要检查的 URL
 * @returns 如果是本地主机则返回 true
 */
export function isLocalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
    if (hostname.startsWith('127.')) return true
    if (hostname.startsWith('192.168.')) return true
    if (hostname.startsWith('10.')) return true
    // 仅匹配 172.16.0.0 - 172.31.255.255
    const match = hostname.match(/^172\.(\d{1,3})\./)
    if (match) {
      const second = Number(match[1])
      return second >= 16 && second <= 31
    }
  } catch (_) {
    /* ignore malformed URL */
    return false
  }
  return false
}
