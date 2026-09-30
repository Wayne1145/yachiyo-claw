import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('bundled Live2D asset integrity', () => {
  it('retains the verified original MOC bytes across Git checkouts', () => {
    // Recovered from the working v0.0.19 APK. Text normalization removed 36 CRs
    // from this binary in v0.0.20, while its MOC header still appeared valid.
    const bytes = fs.readFileSync(path.join(__dirname, '../public/live2d/yachiyo/model.moc3'))
    expect(bytes.length).toBe(7427136)
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')).toBe(
      '5b669ba90aa97ed9fe7132253f537510b72d27a26c39983d8b0146c6b0320459'
    )
  })
})
