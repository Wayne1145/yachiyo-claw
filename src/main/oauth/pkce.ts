import { createHash, randomBytes } from 'node:crypto'

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifierBuffer = randomBytes(32)
  const verifier = base64urlEncode(verifierBuffer)
  const challengeBuffer = createHash('sha256').update(verifier).digest()
  const challenge = base64urlEncode(challengeBuffer)
  return { verifier, challenge }
}

export function generateState(): string {
  return base64urlEncode(randomBytes(16))
}
