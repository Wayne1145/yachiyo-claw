import { DEFAULT_PLUGIN_MARKETPLACE_URL } from './package-source'

const PLUGIN_MARKETPLACE_URL_STORAGE_KEY = 'yachiyo.plugin-marketplace-url'

export function readPluginMarketplaceUrl(): string {
  try {
    return localStorage.getItem(PLUGIN_MARKETPLACE_URL_STORAGE_KEY)?.trim() || DEFAULT_PLUGIN_MARKETPLACE_URL
  } catch {
    return DEFAULT_PLUGIN_MARKETPLACE_URL
  }
}

export function savePluginMarketplaceUrl(url: string): string {
  const normalized = url.trim() || DEFAULT_PLUGIN_MARKETPLACE_URL
  try {
    localStorage.setItem(PLUGIN_MARKETPLACE_URL_STORAGE_KEY, normalized)
  } catch {
    // The URL remains usable for this session when storage is unavailable.
  }
  return normalized
}

export function resetPluginMarketplaceUrl(): string {
  try {
    localStorage.removeItem(PLUGIN_MARKETPLACE_URL_STORAGE_KEY)
  } catch {
    // Ignore unavailable storage and return the built-in safe default.
  }
  return DEFAULT_PLUGIN_MARKETPLACE_URL
}
