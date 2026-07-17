import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve('src/renderer/public/live2d/yachiyo/textures')
const files = ['texture_00.png', 'texture_01.png']

for (const file of files) {
  const target = path.join(root, file)
  const source = await sharp(target).png().toBuffer()
  const metadata = await sharp(source).metadata()
  if ((metadata.width || 0) <= 4096 && (metadata.height || 0) <= 4096) continue

  // 只改变纹理分辨率，不改变画布比例或 UV 布局。
  await sharp(source)
    .resize({ width: 4096, height: 4096, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(`${target}.prepared`)
  await import('node:fs/promises').then((fs) => fs.rename(`${target}.prepared`, target))
}
