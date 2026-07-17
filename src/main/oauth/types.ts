import type { OAuthCredentials } from '../../shared/oauth'

/**
 * OAuth provider that uses a local callback server (OpenAI, Gemini).
 * Single step: open browser → callback server catches redirect → done.
 */
export interface CallbackOAuthProvider {
  kind: 'callback'
  providerId: string
  name: string
  login(options: { openUrl: (url: string) => Promise<void>; signal?: AbortSignal }): Promise<OAuthCredentials>
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>
}

/**
 * OAuth provider that requires user to paste an authorization code (Anthropic).
 * Two steps: startLogin() → get auth URL, exchangeCode() → exchange code for tokens.
 */
export interface CodePasteOAuthProvider {
  kind: 'code-paste'
  providerId: string
  name: string
  codeInputMessage: string
  startLogin(): Promise<{ authUrl: string }>
  exchangeCode(code: string): Promise<OAuthCredentials>
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>
}

/**
 * OAuth provider that uses a device code flow (GitHub Copilot).
 * Two steps: startDeviceFlow() → get user code + verification URL,
 *            waitForToken() → poll until user authorizes.
 */
export interface DeviceCodeOAuthProvider {
  kind: 'device-code'
  providerId: string
  name: string
  startDeviceFlow(): Promise<{ userCode: string; verificationUri: string }>
  waitForToken(signal?: AbortSignal): Promise<OAuthCredentials>
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>
}

export type MainOAuthProvider = CallbackOAuthProvider | CodePasteOAuthProvider | DeviceCodeOAuthProvider
