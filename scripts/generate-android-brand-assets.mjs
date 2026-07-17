import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDirectory, '..')
const sourceMark = path.join(workspaceRoot, 'assets', 'brand', 'yachiyo-source.png')
const avatarOutput = path.join(workspaceRoot, 'assets', 'brand', 'yachiyo-avatar.png')
const providerIconOutput = path.join(workspaceRoot, 'src', 'renderer', 'static', 'icons', 'providers', 'yachiyo.png')
const resourceRoot = path.join(workspaceRoot, 'android', 'app', 'src', 'main', 'res')
const background = '#F8FAFC'
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

const splashTargets = [
  ['drawable/splash.png', 480, 320],
  ['drawable-land-hdpi/splash.png', 800, 480],
  ['drawable-land-mdpi/splash.png', 480, 320],
  ['drawable-land-xhdpi/splash.png', 1280, 720],
  ['drawable-land-xxhdpi/splash.png', 1600, 960],
  ['drawable-land-xxxhdpi/splash.png', 1920, 1280],
  ['drawable-port-hdpi/splash.png', 480, 800],
  ['drawable-port-mdpi/splash.png', 320, 480],
  ['drawable-port-xhdpi/splash.png', 720, 1280],
  ['drawable-port-xxhdpi/splash.png', 960, 1600],
  ['drawable-port-xxxhdpi/splash.png', 1280, 1920],
]

const launcherTargets = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

async function removeConnectedWhiteBackground(inputPath) {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixelCount = info.width * info.height
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 0

  const isBackground = (pixel) => {
    const offset = pixel * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    return Math.min(red, green, blue) >= 235 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 24
  }
  const enqueue = (pixel) => {
    if (visited[pixel] || !isBackground(pixel)) return
    visited[pixel] = 1
    queue[tail++] = pixel
  }

  for (let x = 0; x < info.width; x++) {
    enqueue(x)
    enqueue((info.height - 1) * info.width + x)
  }
  for (let y = 0; y < info.height; y++) {
    enqueue(y * info.width)
    enqueue(y * info.width + info.width - 1)
  }

  while (head < tail) {
    const pixel = queue[head++]
    const x = pixel % info.width
    const y = Math.floor(pixel / info.width)
    data[pixel * 4 + 3] = 0
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < info.width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - info.width)
    if (y + 1 < info.height) enqueue(pixel + info.width)
  }

  let left = info.width
  let top = info.height
  let right = 0
  let bottom = 0
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (data[pixel * 4 + 3] === 0) continue
    const x = pixel % info.width
    const y = Math.floor(pixel / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }

  return sharp(data, { raw: info })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer()
}

const cutout = await removeConnectedWhiteBackground(sourceMark)

async function renderMark(size, paddingRatio = 0.05) {
  const innerSize = Math.round(size * (1 - paddingRatio * 2))
  const resized = await sharp(cutout)
    .resize(innerSize, innerSize, { fit: 'contain', background: transparent })
    .png()
    .toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: transparent } })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toBuffer()
}

await mkdir(path.dirname(avatarOutput), { recursive: true })
await sharp(await renderMark(1024, 0.035)).png({ compressionLevel: 9 }).toFile(avatarOutput)
await mkdir(path.dirname(providerIconOutput), { recursive: true })
await sharp(await renderMark(256, 0.06)).png({ compressionLevel: 9 }).toFile(providerIconOutput)

async function writePng(relativePath, pipeline) {
  const outputPath = path.join(resourceRoot, relativePath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await pipeline.png({ compressionLevel: 9 }).toFile(outputPath)
}

for (const [relativePath, width, height] of splashTargets) {
  const markSize = Math.round(Math.min(width, height) * 0.31)
  const mark = await renderMark(markSize, 0.02)

  await writePng(
    relativePath,
    sharp({
      create: {
        width,
        height,
        channels: 4,
        background,
      },
    }).composite([{ input: mark, gravity: 'center' }])
  )
}

for (const [density, legacySize, foregroundSize] of launcherTargets) {
  const legacyMark = await renderMark(Math.round(legacySize * 0.84), 0.02)
  const foregroundMark = await renderMark(Math.round(foregroundSize * 0.62), 0.01)
  const circleBackground = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${legacySize}" height="${legacySize}"><circle cx="50%" cy="50%" r="50%" fill="${background}"/></svg>`
  )
  const legacyCanvas = {
    create: {
      width: legacySize,
      height: legacySize,
      channels: 4,
      background,
    },
  }

  await writePng(
    `mipmap-${density}/ic_launcher.png`,
    sharp(legacyCanvas).composite([{ input: legacyMark, gravity: 'center' }])
  )
  await writePng(
    `mipmap-${density}/ic_launcher_round.png`,
    sharp({ create: { ...legacyCanvas.create, background: transparent } }).composite([
      { input: circleBackground, gravity: 'center' },
      { input: legacyMark, gravity: 'center' },
    ])
  )

  // The visible mark stays inside the adaptive icon's 66dp guaranteed safe zone.
  await writePng(
    `mipmap-${density}/ic_launcher_foreground.png`,
    sharp({
      create: {
        width: foregroundSize,
        height: foregroundSize,
        channels: 4,
        background: transparent,
      },
    }).composite([{ input: foregroundMark, gravity: 'center' }])
  )
}

const generatedCount = splashTargets.length + launcherTargets.length * 3
console.log(
  `Generated avatar, provider icon, and ${generatedCount} Android assets from ${path.relative(workspaceRoot, sourceMark)}.`
)
