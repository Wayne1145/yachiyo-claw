import type { MainOAuthProvider } from './types'

const oauthProviderRegistry = new Map<string, MainOAuthProvider>()

export function registerOAuthProvider(provider: MainOAuthProvider): void {
  oauthProviderRegistry.set(provider.providerId, provider)
}

export function getOAuthProvider(providerId: string): MainOAuthProvider | undefined {
  return oauthProviderRegistry.get(providerId)
}

export function getRegisteredOAuthProviders(): MainOAuthProvider[] {
  return Array.from(oauthProviderRegistry.values())
}
