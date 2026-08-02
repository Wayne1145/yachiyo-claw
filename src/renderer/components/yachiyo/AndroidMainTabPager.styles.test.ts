import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = fs.readFileSync(path.join(__dirname, 'android-app-shell.css'), 'utf8')

describe('AndroidMainTabPager touch-action contract', () => {
  it('keeps nested route scroll roots from cancelling horizontal pointer tracking', () => {
    expect(styles).toMatch(
      /\.yachiyo-main-tab-page,\s*\.yachiyo-main-tab-page :where\(\*\)\s*\{[^}]*touch-action:\s*pan-y pinch-zoom;/s
    )
    expect(styles).toMatch(
      /\[data-yachiyo-tab-swipe=['"]block['"]\][\s\S]*?\{\s*touch-action:\s*auto;/
    )
  })
})
