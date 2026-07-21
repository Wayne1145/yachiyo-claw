import { compareVersions, validate } from 'compare-versions'

export const YACHIYO_GITHUB_OWNER = 'Wayne1145'
export const YACHIYO_GITHUB_REPO = 'yachiyo-claw'
export const YACHIYO_GITHUB_URL = `https://github.com/${YACHIYO_GITHUB_OWNER}/${YACHIYO_GITHUB_REPO}`
export const YACHIYO_RELEASES_URL = `${YACHIYO_GITHUB_URL}/releases`
export const YACHIYO_LATEST_RELEASE_URL = `${YACHIYO_RELEASES_URL}/latest`
export const YACHIYO_LATEST_RELEASE_API = `https://api.github.com/repos/${YACHIYO_GITHUB_OWNER}/${YACHIYO_GITHUB_REPO}/releases/latest`

interface GitHubReleaseAsset {
  name?: string
  browser_download_url?: string
  digest?: string | null
  size?: number
  content_type?: string
}

interface GitHubRelease {
  draft?: boolean
  prerelease?: boolean
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  assets?: GitHubReleaseAsset[]
}

export interface YachiyoAndroidRelease {
  version: string
  tag: string
  title: string
  notes: string
  releaseUrl: string
  apk: {
    name: string
    url: string
    size: number
    sha256?: string
    sha256SidecarUrl?: string
  }
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

export function normalizeYachiyoSha256(value?: string | null): string | undefined {
  if (!value) return undefined
  const normalized = value
    .trim()
    .replace(/^sha256:/i, '')
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined
}

export function isAllowedYachiyoReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port) return false
    const expectedPrefix = `/${YACHIYO_GITHUB_OWNER}/${YACHIYO_GITHUB_REPO}/releases/download/`.toLowerCase()
    return url.pathname.toLowerCase().startsWith(expectedPrefix)
  } catch {
    return false
  }
}

function apkPreference(asset: GitHubReleaseAsset): number {
  const name = asset.name?.toLowerCase() ?? ''
  if (!name.endsWith('.apk') || name.includes('debug')) return -1
  let score = 0
  if (name.includes('yachiyo')) score += 8
  if (name.includes('release')) score += 4
  if (name.includes('universal')) score += 2
  if (name.includes('arm64')) score += 1
  return score
}

function findSha256Sidecar(assets: GitHubReleaseAsset[], apkName: string): GitHubReleaseAsset | undefined {
  const exactName = `${apkName}.sha256`.toLowerCase()
  const stemName = apkName.replace(/\.apk$/i, '.sha256').toLowerCase()
  return (
    assets.find((asset) => asset.name?.toLowerCase() === exactName) ??
    assets.find((asset) => asset.name?.toLowerCase() === stemName)
  )
}

export async function getLatestYachiyoAndroidRelease(
  currentVersion: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<YachiyoAndroidRelease | null> {
  const response = await fetchImpl(YACHIYO_LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`github_release_http_${response.status}`)

  const release = (await response.json()) as GitHubRelease
  if (release.draft || release.prerelease || !release.tag_name) return null
  if (!isNewerYachiyoVersion(currentVersion, release.tag_name)) return null

  const assets = release.assets ?? []
  const selected = assets
    .map((asset) => {
      const sidecar = asset.name ? findSha256Sidecar(assets, asset.name) : undefined
      const sidecarUrl = sidecar?.browser_download_url
      return {
        asset,
        score: apkPreference(asset),
        sha256: normalizeYachiyoSha256(asset.digest),
        sha256SidecarUrl: sidecarUrl && isAllowedYachiyoReleaseAssetUrl(sidecarUrl) ? sidecarUrl : undefined,
      }
    })
    .filter(({ asset, score }) => score >= 0 && Boolean(asset.name && asset.browser_download_url))
    .filter(
      ({ asset }) =>
        typeof asset.browser_download_url === 'string' && isAllowedYachiyoReleaseAssetUrl(asset.browser_download_url)
    )
    // Never advertise an APK that the native downloader cannot authenticate.
    .filter(({ sha256, sha256SidecarUrl }) => Boolean(sha256 || sha256SidecarUrl))
    .sort((left, right) => right.score - left.score || (right.asset.size ?? 0) - (left.asset.size ?? 0))[0]
  const apk = selected?.asset
  if (!apk?.name || !apk.browser_download_url) return null

  return {
    version: normalizeVersion(release.tag_name),
    tag: release.tag_name,
    title: release.name?.trim() || release.tag_name,
    notes: release.body?.trim() || '',
    releaseUrl: release.html_url || YACHIYO_LATEST_RELEASE_URL,
    apk: {
      name: apk.name,
      url: apk.browser_download_url,
      size: Math.max(0, apk.size ?? 0),
      sha256: selected.sha256,
      sha256SidecarUrl: selected.sha256SidecarUrl,
    },
  }
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
