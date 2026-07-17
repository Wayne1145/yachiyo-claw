export interface CacheItem<T> {
  value: T
  expireAt: number
}

// In-memory cache store
const memoryCache = new Map<string, CacheItem<any>>()

export async function cache<T>(
  key: string,
  getter: () => Promise<T>,
  options: {
    ttl: number // 缓存过期时间，单位为毫秒
    refreshFallbackToCache?: boolean // 如果刷新时获取新值失败，是否从缓存中继续使用过期的旧值
  }
): Promise<T> {
  let cache = memoryCache.get(key) as CacheItem<T> | undefined

  if (cache && cache.expireAt > Date.now()) {
    return cache.value
  }

  try {
    const newValue = await getter()
    cache = {
      value: newValue,
      expireAt: Date.now() + options.ttl,
    }
    memoryCache.set(key, cache)
    return newValue
  } catch (e) {
    if (options.refreshFallbackToCache && cache) {
      return cache.value
    }
    throw e
  }
}
