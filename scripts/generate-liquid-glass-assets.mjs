import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDirectory, '..')
const publicRoot = path.join(workspaceRoot, 'src', 'renderer', 'public', 'liquid-glass')
const environmentRoot = path.join(publicRoot, 'environments')
const opticsRoot = path.join(publicRoot, 'optics')

const environmentWidth = 1440
const environmentHeight = 3200
const maxEnvironmentBytes = 250 * 1024
const maxAssetTotalBytes = 3 * 1024 * 1024

const scenes = [
  {
    name: 'chat-light',
    base: ['#f8fbff', '#edf8f6'],
    haze: '#fff8f5',
    ribbons: [
      { color: '#74b9f3', opacity: 0.42, width: 1040, blur: 150 },
      { color: '#72d7c3', opacity: 0.35, width: 900, blur: 135 },
      { color: '#f3a9bc', opacity: 0.28, width: 760, blur: 130 },
      { color: '#f2b77d', opacity: 0.2, width: 680, blur: 120 },
    ],
    paths: [
      'M -420 -320 C 240 420 1160 610 1640 1420 S 650 2510 -360 3510',
      'M 1720 -420 C 920 260 370 920 570 1690 S 1570 2540 850 3540',
      'M -520 840 C 300 430 970 1040 1690 860 S 920 2300 1700 2920',
      'M -500 2620 C 180 2210 930 2500 1660 2180',
    ],
  },
  {
    name: 'chat-dark',
    base: ['#090d13', '#111920'],
    haze: '#17131a',
    ribbons: [
      { color: '#17678b', opacity: 0.42, width: 1080, blur: 160 },
      { color: '#166d63', opacity: 0.36, width: 920, blur: 145 },
      { color: '#713548', opacity: 0.3, width: 780, blur: 135 },
      { color: '#79512f', opacity: 0.24, width: 700, blur: 125 },
    ],
    paths: [
      'M -420 -320 C 240 420 1160 610 1640 1420 S 650 2510 -360 3510',
      'M 1720 -420 C 920 260 370 920 570 1690 S 1570 2540 850 3540',
      'M -520 840 C 300 430 970 1040 1690 860 S 920 2300 1700 2920',
      'M -500 2620 C 180 2210 930 2500 1660 2180',
    ],
  },
  {
    name: 'interactive-light',
    base: ['#f7fcfc', '#eef5ff'],
    haze: '#fff7fb',
    ribbons: [
      { color: '#54c9c9', opacity: 0.4, width: 940, blur: 145 },
      { color: '#6da9ec', opacity: 0.4, width: 980, blur: 150 },
      { color: '#b59ddd', opacity: 0.28, width: 740, blur: 130 },
      { color: '#efa6bb', opacity: 0.23, width: 680, blur: 120 },
    ],
    paths: [
      'M -560 130 C 160 780 1010 120 1710 800 S 1000 1900 -430 1540',
      'M 1660 -380 C 780 190 240 930 780 1640 S 1570 2510 590 3560',
      'M -470 1050 C 330 720 1070 1420 1700 1130 S 1020 2570 -420 2350',
      'M -520 3060 C 250 2510 1100 2760 1720 2230',
    ],
  },
  {
    name: 'interactive-dark',
    base: ['#080f13', '#101724'],
    haze: '#18111a',
    ribbons: [
      { color: '#0d7076', opacity: 0.42, width: 960, blur: 155 },
      { color: '#285d91', opacity: 0.4, width: 1000, blur: 160 },
      { color: '#58406f', opacity: 0.32, width: 760, blur: 140 },
      { color: '#713b4c', opacity: 0.27, width: 700, blur: 130 },
    ],
    paths: [
      'M -560 130 C 160 780 1010 120 1710 800 S 1000 1900 -430 1540',
      'M 1660 -380 C 780 190 240 930 780 1640 S 1570 2510 590 3560',
      'M -470 1050 C 330 720 1070 1420 1700 1130 S 1020 2570 -420 2350',
      'M -520 3060 C 250 2510 1100 2760 1720 2230',
    ],
  },
  {
    name: 'tasks-light',
    base: ['#fffaf5', '#f1f8f7'],
    haze: '#f5f8ff',
    ribbons: [
      { color: '#f3ae70', opacity: 0.42, width: 920, blur: 140 },
      { color: '#ee837f', opacity: 0.3, width: 740, blur: 125 },
      { color: '#67bca7', opacity: 0.34, width: 840, blur: 135 },
      { color: '#79a9dc', opacity: 0.28, width: 760, blur: 130 },
    ],
    paths: [
      'M -510 -220 C 360 250 830 1060 1740 1160',
      'M 1710 90 C 1080 640 1070 1380 310 1850 S -220 2830 590 3490',
      'M -520 940 C 300 1220 780 1740 1680 1650 S 1180 2860 1700 3240',
      'M -430 2870 C 300 2360 1110 2540 1750 2100',
    ],
  },
  {
    name: 'tasks-dark',
    base: ['#110d0b', '#0d1717'],
    haze: '#111724',
    ribbons: [
      { color: '#75411f', opacity: 0.45, width: 940, blur: 150 },
      { color: '#743b3d', opacity: 0.34, width: 760, blur: 135 },
      { color: '#275f52', opacity: 0.38, width: 860, blur: 145 },
      { color: '#2c527b', opacity: 0.32, width: 780, blur: 140 },
    ],
    paths: [
      'M -510 -220 C 360 250 830 1060 1740 1160',
      'M 1710 90 C 1080 640 1070 1380 310 1850 S -220 2830 590 3490',
      'M -520 940 C 300 1220 780 1740 1680 1650 S 1180 2860 1700 3240',
      'M -430 2870 C 300 2360 1110 2540 1750 2100',
    ],
  },
  {
    name: 'settings-light',
    base: ['#fbfbfe', '#f1f7f6'],
    haze: '#fff9f8',
    ribbons: [
      { color: '#91b6df', opacity: 0.34, width: 900, blur: 150 },
      { color: '#aa9bd5', opacity: 0.24, width: 700, blur: 135 },
      { color: '#eba9b5', opacity: 0.24, width: 660, blur: 125 },
      { color: '#7ccbbb', opacity: 0.3, width: 800, blur: 140 },
    ],
    paths: [
      'M -180 -420 C 400 430 220 1210 570 1800 S 1130 2800 640 3560',
      'M 1500 -350 C 950 520 1210 1090 860 1710 S 270 2720 820 3560',
      'M -460 650 C 230 380 970 840 1690 590 S 1050 2010 1680 2380',
      'M -430 2830 C 300 2520 1010 2890 1710 2490',
    ],
  },
  {
    name: 'settings-dark',
    base: ['#0c0d12', '#101818'],
    haze: '#191414',
    ribbons: [
      { color: '#294864', opacity: 0.4, width: 920, blur: 160 },
      { color: '#4c4068', opacity: 0.28, width: 720, blur: 145 },
      { color: '#693b44', opacity: 0.28, width: 680, blur: 135 },
      { color: '#286259', opacity: 0.35, width: 820, blur: 150 },
    ],
    paths: [
      'M -180 -420 C 400 430 220 1210 570 1800 S 1130 2800 640 3560',
      'M 1500 -350 C 950 520 1210 1090 860 1710 S 270 2720 820 3560',
      'M -460 650 C 230 380 970 840 1690 590 S 1050 2010 1680 2380',
      'M -430 2830 C 300 2520 1010 2890 1710 2490',
    ],
  },
]

function environmentSvg(scene) {
  const isDark = scene.name.endsWith('-dark')
  const filters = scene.ribbons
    .map(
      (ribbon, index) => `
        <filter id="halo-${index}" filterUnits="userSpaceOnUse" x="-1000" y="-1000" width="3440" height="5200">
          <feGaussianBlur stdDeviation="${Math.round(ribbon.blur * 0.45)}"/>
        </filter>
        <filter id="body-${index}" filterUnits="userSpaceOnUse" x="-1000" y="-1000" width="3440" height="5200">
          <feGaussianBlur stdDeviation="${Math.round(ribbon.blur * 0.2)}"/>
        </filter>
        <filter id="edge-${index}" filterUnits="userSpaceOnUse" x="-1000" y="-1000" width="3440" height="5200">
          <feGaussianBlur stdDeviation="7"/>
        </filter>`,
    )
    .join('')
  const ribbons = scene.ribbons
    .map(
      (ribbon, index) => `
        <path d="${scene.paths[index]}" fill="none" stroke="${ribbon.color}" stroke-width="${ribbon.width}" stroke-linecap="butt" opacity="${(
          ribbon.opacity * 0.5
        ).toFixed(3)}" filter="url(#halo-${index})"/>
        <path d="${scene.paths[index]}" fill="none" stroke="${ribbon.color}" stroke-width="${Math.round(
          ribbon.width * 0.58,
        )}" stroke-linecap="butt" opacity="${Math.min(0.58, ribbon.opacity * 1.18).toFixed(
          3,
        )}" filter="url(#body-${index})"/>
        <path d="${scene.paths[index]}" fill="none" stroke="${isDark ? '#dcecff' : '#ffffff'}" stroke-width="${Math.round(
          ribbon.width * 0.08,
        )}" stroke-linecap="butt" opacity="${isDark ? '0.075' : '0.16'}" filter="url(#edge-${index})"/>`,
    )
    .join('')

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${environmentWidth}" height="${environmentHeight}" viewBox="0 0 ${environmentWidth} ${environmentHeight}">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="0.82" y2="1">
          <stop offset="0" stop-color="${scene.base[0]}"/>
          <stop offset="1" stop-color="${scene.base[1]}"/>
        </linearGradient>
        <linearGradient id="haze" x1="0" y1="0" x2="1" y2="0.72">
          <stop offset="0" stop-color="${scene.haze}" stop-opacity="${isDark ? 0.12 : 0.2}"/>
          <stop offset="0.48" stop-color="${scene.haze}" stop-opacity="0"/>
          <stop offset="1" stop-color="${isDark ? '#071015' : '#ffffff'}" stop-opacity="${isDark ? 0.08 : 0.12}"/>
        </linearGradient>
        ${filters}
      </defs>
      <rect width="100%" height="100%" fill="url(#base)"/>
      ${ribbons}
      <rect width="100%" height="100%" fill="url(#haze)"/>
    </svg>
  `)
}

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

async function textureTile(seed, isDark) {
  const size = 64
  const data = Buffer.alloc(size * size * 4)
  const random = mulberry32(seed)
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const bright = random() > 0.5
    const value = bright ? 255 : 0
    const offset = pixel * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = isDark ? 3 : 2
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
}

async function renderEnvironment(scene, index) {
  const source = sharp(environmentSvg(scene)).resize(environmentWidth, environmentHeight, {
    fit: 'fill',
    kernel: sharp.kernel.lanczos3,
  })
  const texture = await textureTile(0x59414348 + index * 977, scene.name.endsWith('-dark'))
  const pipeline = source.composite([{ input: texture, tile: true, blend: 'over' }]).removeAlpha()

  let quality = 82
  let output
  do {
    output = await pipeline
      .clone()
      .webp({ quality, effort: 6, smartSubsample: true, nearLossless: false })
      .toBuffer()
    quality -= 4
  } while (output.length > maxEnvironmentBytes && quality >= 58)

  if (output.length > maxEnvironmentBytes) {
    throw new Error(`${scene.name}.webp is ${(output.length / 1024).toFixed(1)} KiB; expected at most 250 KiB`)
  }

  const outputPath = path.join(environmentRoot, `${scene.name}.webp`)
  await writeFile(outputPath, output)
  const metadata = await sharp(output).metadata()
  if (metadata.width !== environmentWidth || metadata.height !== environmentHeight || metadata.format !== 'webp') {
    throw new Error(`${scene.name}.webp failed dimension or format validation`)
  }
  return { name: scene.name, bytes: output.length, quality: quality + 4 }
}

function roundedRectangleDistance(x, y, width, height, radius) {
  const qx = Math.abs(x - width / 2) - (width / 2 - radius)
  const qy = Math.abs(y - height / 2) - (height / 2 - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

function createOpticFields(width, height, radius) {
  const heights = new Float32Array(width * height)
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const distance = roundedRectangleDistance(x + 0.5, y + 0.5, width, height, radius)
      const interior = Math.max(0, Math.min(1, -distance / Math.max(1, radius * 0.82)))
      heights[pixel] = Math.sin((interior * Math.PI) / 2) ** 0.72
      alpha[pixel] = Math.round(Math.max(0, Math.min(1, 0.5 - distance / 3)) * 255)
    }
  }
  return { heights, alpha }
}

async function renderOpticMap(name, width, height, radius) {
  const { heights, alpha } = createOpticFields(width, height, radius)
  const normal = Buffer.alloc(width * height * 4)
  const displacement = Buffer.alloc(width * height * 4)
  const at = (x, y) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const offset = pixel * 4
      const dx = (at(x + 1, y) - at(x - 1, y)) * 10
      const dy = (at(x, y + 1) - at(x, y - 1)) * 10
      const inverseLength = 1 / Math.hypot(dx, dy, 1)
      const nx = -dx * inverseLength
      const ny = -dy * inverseLength
      const nz = inverseLength
      const edgeWeight = (1 - heights[pixel]) ** 1.7 * (alpha[pixel] / 255)

      normal[offset] = Math.round((nx * 0.5 + 0.5) * 255)
      normal[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      normal[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      normal[offset + 3] = alpha[pixel]

      displacement[offset] = Math.round((nx * edgeWeight * 0.5 + 0.5) * 255)
      displacement[offset + 1] = Math.round((ny * edgeWeight * 0.5 + 0.5) * 255)
      displacement[offset + 2] = Math.round(heights[pixel] * 255)
      displacement[offset + 3] = alpha[pixel]
    }
  }

  const normalPath = path.join(opticsRoot, `${name}-normal.png`)
  const displacementPath = path.join(opticsRoot, `${name}-displacement.png`)
  await Promise.all([
    sharp(normal, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(normalPath),
    sharp(displacement, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(displacementPath),
  ])
  return [normalPath, displacementPath]
}

await Promise.all([mkdir(environmentRoot, { recursive: true }), mkdir(opticsRoot, { recursive: true })])

const environmentResults = []
for (const [index, scene] of scenes.entries()) {
  environmentResults.push(await renderEnvironment(scene, index))
}

const environmentTotalBytes = environmentResults.reduce((total, result) => total + result.bytes, 0)
const opticalPaths = (
  await Promise.all([
  renderOpticMap('compact-circle', 256, 256, 128),
  renderOpticMap('compact-capsule', 512, 256, 128),
  renderOpticMap('compact-rounded-rect', 512, 320, 80),
  ])
).flat()
const opticalBytes = (
  await Promise.all(opticalPaths.map(async (outputPath) => (await stat(outputPath)).size))
).reduce((total, bytes) => total + bytes, 0)
const totalAssetBytes = environmentTotalBytes + opticalBytes

if (totalAssetBytes > maxAssetTotalBytes) {
  throw new Error(`Flow Glass assets total ${(totalAssetBytes / 1024).toFixed(1)} KiB; expected at most 3 MiB`)
}

for (const result of environmentResults) {
  console.log(`${result.name}.webp: ${(result.bytes / 1024).toFixed(1)} KiB (quality ${result.quality})`)
}
console.log(`Environment total: ${(environmentTotalBytes / 1024).toFixed(1)} KiB`)
console.log(`Optical maps: ${(opticalBytes / 1024).toFixed(1)} KiB`)
console.log(`Flow Glass total: ${(totalAssetBytes / 1024).toFixed(1)} KiB`)
