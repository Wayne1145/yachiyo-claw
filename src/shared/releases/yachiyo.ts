import { compareVersions, validate } from 'compare-versions'

export const YACHIYO_GITHUB_OWNER = 'Wayne1145'
export const YACHIYO_GITHUB_REPO = 'yachiyo-claw'
export const YACHIYO_GITHUB_URL = `https://github.com/${YACHIYO_GITHUB_OWNER}/${YACHIYO_GITHUB_REPO}`
export const YACHIYO_RELEASES_URL = `${YACHIYO_GITHUB_URL}/releases`
export const YACHIYO_LATEST_RELEASE_URL = `${YACHIYO_RELEASES_URL}/latest`
export const YACHIYO_LATEST_RELEASE_API = `https://api.github.com/repos/${YACHIYO_GITHUB_OWNER}/${YACHIYO_GITHUB_REPO}/releases/latest`

interface GitHubRelease {
  draft?: boolean
  prerelease?: boolean
  tag_name?: string
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

export function isNewerYachiyoVersion(currentVersion: string, releaseTag: string): boolean {
  const current = normalizeVersion(currentVersion)
  const release = normalizeVersion(releaseTag)
  if (!validate(current) || !validate(release)) return false
  return compareVersions(release, current) === 1
}

export async function checkYachiyoGitHubUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<boolean> {
  const response = await fetchImpl(YACHIYO_LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  // A new repository legitimately has no Releases yet.
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`github_release_http_${response.status}`)
  const release = (await response.json()) as GitHubRelease
  if (release.draft || release.prerelease || !release.tag_name) return false
  return isNewerYachiyoVersion(currentVersion, release.tag_name)
}
