/** In-memory OAuth 2.1 + MCP service used only by automated tests. */
export class TemporaryMcpOAuthTestService {
  readonly resource = 'https://mcp-e2e.example.test/mcp'
  readonly resourceMetadata = 'https://mcp-e2e.example.test/.well-known/oauth-protected-resource'
  readonly issuer = 'https://oauth-e2e.example.test'
  readonly authorizationEndpoint = `${this.issuer}/authorize`
  readonly tokenEndpoint = `${this.issuer}/token`

  readonly observedAuthorizationUrls: URL[] = []
  readonly observedTokenBodies: URLSearchParams[] = []
  readonly observedMcpAuthorization: string[] = []
  readonly observedOAuthRequestInit: RequestInit[] = []
  tokenExchangeCount = 0
  refreshCount = 0

  private nextCode = 1
  private nextToken = 1
  private readonly codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>()
  private readonly refreshTokens = new Set<string>()
  private readonly accessTokens = new Set<string>()

  readonly fetch: typeof fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.toString() === this.resourceMetadata) {
      this.observedOAuthRequestInit.push(init)
      return this.json({
        resource: this.resource,
        authorization_servers: [this.issuer],
        scopes_supported: ['mcp:tools'],
      })
    }
    if (url.toString() === `${this.issuer}/.well-known/oauth-authorization-server`) {
      this.observedOAuthRequestInit.push(init)
      return this.json({
        issuer: this.issuer,
        authorization_endpoint: this.authorizationEndpoint,
        token_endpoint: this.tokenEndpoint,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (url.toString() === this.tokenEndpoint && (init.method || 'GET').toUpperCase() === 'POST') {
      this.observedOAuthRequestInit.push(init)
      const body = new URLSearchParams(String(init.body || ''))
      this.observedTokenBodies.push(body)
      if (body.get('grant_type') === 'authorization_code') return this.exchangeCode(body)
      if (body.get('grant_type') === 'refresh_token') return this.refresh(body)
      return this.oauthError('unsupported_grant_type')
    }
    if (url.toString() === this.resource && (init.method || 'GET').toUpperCase() === 'POST') {
      const authorization = new Headers(init.headers).get('authorization') || ''
      this.observedMcpAuthorization.push(authorization)
      const token = authorization.replace(/^Bearer\s+/i, '')
      if (!this.accessTokens.has(token)) {
        return this.json({ error: 'invalid_token' }, 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${this.resourceMetadata}", scope="mcp:tools"`,
        })
      }
      const request = JSON.parse(String(init.body || '{}')) as { id?: unknown; method?: string }
      return this.json(
        {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: request.method === 'initialize'
            ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'temporary-e2e', version: '1' } }
            : { ok: true },
        },
        200,
        { 'Mcp-Session-Id': 'temporary-session' }
      )
    }
    return this.json({ error: 'not_found', url: url.toString() }, 404)
  }

  async authorize(authorizationUrl: string): Promise<string> {
    const url = new URL(authorizationUrl)
    this.observedAuthorizationUrls.push(url)
    if (url.toString().startsWith(this.authorizationEndpoint) === false) throw new Error('test_authorization_endpoint_mismatch')
    if (url.searchParams.get('response_type') !== 'code') throw new Error('test_response_type_invalid')
    if (url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('test_pkce_method_invalid')
    const state = url.searchParams.get('state') || ''
    const challenge = url.searchParams.get('code_challenge') || ''
    const redirectUri = url.searchParams.get('redirect_uri') || ''
    const clientId = url.searchParams.get('client_id') || ''
    if (!state || !challenge || !redirectUri || !clientId) throw new Error('test_authorization_request_incomplete')
    const code = `code-${this.nextCode++}`
    this.codes.set(code, { challenge, redirectUri, clientId })
    const callback = new URL(redirectUri)
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', state)
    return callback.toString()
  }

  private async exchangeCode(body: URLSearchParams): Promise<Response> {
    const code = body.get('code') || ''
    const record = this.codes.get(code)
    this.codes.delete(code)
    if (!record) return this.oauthError('invalid_grant')
    if (body.get('redirect_uri') !== record.redirectUri || body.get('client_id') !== record.clientId) {
      return this.oauthError('invalid_grant')
    }
    const verifier = body.get('code_verifier') || ''
    if ((await this.pkceChallenge(verifier)) !== record.challenge) return this.oauthError('invalid_grant')
    this.tokenExchangeCount += 1
    return this.issueTokens()
  }

  private refresh(body: URLSearchParams): Response {
    const refreshToken = body.get('refresh_token') || ''
    if (!this.refreshTokens.delete(refreshToken)) return this.oauthError('invalid_grant')
    this.refreshCount += 1
    return this.issueTokens()
  }

  private issueTokens(): Response {
    const accessToken = `access-${this.nextToken}`
    const refreshToken = `refresh-${this.nextToken++}`
    this.accessTokens.add(accessToken)
    this.refreshTokens.add(refreshToken)
    return this.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 60,
      refresh_token: refreshToken,
      scope: 'mcp:tools',
    })
  }

  private async pkceChallenge(verifier: string): Promise<string> {
    const encoded = new TextEncoder().encode(verifier)
    const owned = new Uint8Array(encoded.byteLength)
    owned.set(encoded)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer))
    let binary = ''
    for (const byte of digest) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  private oauthError(error: string): Response {
    return this.json({ error, error_description: `temporary service rejected ${error}` }, 400)
  }

  private json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  }
}
