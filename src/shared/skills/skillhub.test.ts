import { describe, expect, it, vi } from 'vitest'
import { inspectSkillArchive, sha256Hex, SkillHubAdapter, SkillHubError, verifyEd25519Signature } from './skillhub'

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('SkillHub adapter', () => {
  it('normalizes search metadata', async () => {
    const request = vi.fn(async () => json({ data: { items: [{ id: 'reader', slug: 'reader', title: 'Reader', revision: 'abc' }] } }))
    const result = await new SkillHubAdapter({ fetch: request }).search({ query: 'reader' })
    expect(result.items[0]).toMatchObject({ skillId: 'reader', name: 'Reader', revision: 'abc' })
  })

  it('can be disabled', async () => {
    await expect(new SkillHubAdapter({ enabled: false, fetch: vi.fn() }).search()).rejects.toMatchObject({ code: 'disabled' })
  })

  it('rejects unsafe or executable archives', () => {
    expect(() => inspectSkillArchive([{ path: '../SKILL.md', size: 1 }])).toThrow(SkillHubError)
    expect(() => inspectSkillArchive([{ path: 'SKILL.md', size: 1 }, { path: 'scripts/run.sh', size: 1 }])).toThrow('disabled')
  })

  it('computes hashes and rejects malformed signatures', async () => {
    await expect(sha256Hex('hello')).resolves.toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    await expect(verifyEd25519Signature('data', 'bad', 'bad')).resolves.toBe(false)
  })
})
