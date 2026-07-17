const fs = require('fs')
const path = require('path')

const muslTargetBlock = `  // @neon-rs/load doesn't detect arm musl
  if (target === "linux-arm-gnueabihf" && familySync() == MUSL) {
      target = "linux-arm-musleabihf";
  }
`

const winArm64GuardBlock = `  if (target === "win32-arm64-msvc") {
    console.log("[libsql] Windows ARM64 detected - native module not available");
    return {};
  }
`

const directRequireBlock = `  return require(\`@libsql/\${target}\`);
`

const tryCatchRequireBlock = `  try {
    return require(\`@libsql/\${target}\`);
  } catch (e) {
    const isMissingTarget =
      e?.code === "MODULE_NOT_FOUND" &&
      typeof e?.message === "string" &&
      (e.message.includes(\`@libsql/\${target}\`) || e.message.includes(\`@libsql\\\\\${target}\`));
    if (!isMissingTarget) throw e;
    console.error(\`[libsql] Native module @libsql/\${target} not found\`);
    return {};
  }
`

const oldIncludeLine = '      e.message.includes(`@libsql/${target}`);'
const newIncludeLine =
  '      (e.message.includes(`@libsql/${target}`) || e.message.includes(`@libsql\\${target}`));'

function patchLibsqlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return 'missing'
  }

  const source = fs.readFileSync(filePath, 'utf8')
  let patched = source

  if (patched.includes(oldIncludeLine)) {
    patched = patched.replaceAll(oldIncludeLine, newIncludeLine)
  }

  if (!patched.includes('if (target === "win32-arm64-msvc") {') && patched.includes(muslTargetBlock)) {
    patched = patched.replace(muslTargetBlock, `${muslTargetBlock}${winArm64GuardBlock}`)
  }

  if (patched.includes(directRequireBlock)) {
    patched = patched.replace(directRequireBlock, tryCatchRequireBlock)
  }

  const isFullyPatched =
    patched.includes('if (target === "win32-arm64-msvc") {') &&
    patched.includes('Native module @libsql/${target} not found') &&
    patched.includes('e.message.includes(`@libsql\\\\${target}`)')

  if (!isFullyPatched) {
    return 'skip-unknown'
  }

  if (patched === source) {
    return 'already-patched'
  }

  fs.writeFileSync(filePath, patched, 'utf8')
  return 'patched'
}

function getCandidateLibsqlDirs(context) {
  const candidates = []
  const appDir =
    context.appDir ||
    context.packager?.appDir ||
    (context.packager?.projectDir && path.join(context.packager.projectDir, 'release', 'app'))

  if (appDir) {
    candidates.push(path.join(appDir, 'node_modules', 'libsql'))
  }

  if (context.appOutDir) {
    const productFilename = context.packager?.appInfo?.productFilename
    if (productFilename) {
      candidates.push(
        path.join(
          context.appOutDir,
          `${productFilename}.app`,
          'Contents',
          'Resources',
          'app.asar.unpacked',
          'node_modules',
          'libsql',
        ),
      )
    }
    candidates.push(path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'libsql'))
  }

  return [...new Set(candidates)]
}

exports.default = async function patchLibsql(context) {
  let touched = false

  for (const libsqlDir of getCandidateLibsqlDirs(context)) {
    for (const file of ['index.js', 'promise.js']) {
      const filePath = path.join(libsqlDir, file)
      const state = patchLibsqlFile(filePath)
      if (state === 'patched') {
        touched = true
        console.log(`[patch-libsql] patched ${filePath}`)
      } else if (state === 'already-patched') {
        touched = true
        console.log(`[patch-libsql] already patched ${filePath}`)
      } else if (state === 'skip-unknown') {
        console.warn(`[patch-libsql] skip unknown structure: ${filePath}`)
      }
    }
  }

  if (!touched) {
    console.warn('[patch-libsql] no libsql files patched')
  }
}
