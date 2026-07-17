/**
 * beforePack hook for electron-builder.
 *
 * With pnpm's node-linker=hoisted, dependencies declared in
 * release/app/package.json get hoisted to the workspace root
 * node_modules/ instead of release/app/node_modules/.
 * electron-builder only packages release/app/node_modules/,
 * so transitive deps like detect-libc, node-fetch, zod end up
 * missing from the asar.
 *
 * This script runs `npm install --production` in release/app/
 * to create a complete, flat node_modules/ before packaging,
 * then removes dev-only artifacts that shouldn't ship.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function ensureAppDeps(context) {
  const appDir = path.join(__dirname, '..', '..', 'release', 'app')
  const nodeModulesDir = path.join(appDir, 'node_modules')

  // Remove pnpm's incomplete hoisted node_modules if it exists
  if (fs.existsSync(nodeModulesDir)) {
    fs.rmSync(nodeModulesDir, { recursive: true, force: true })
  }

  console.log('[ensure-app-deps] Installing production dependencies in release/app/ ...')
  execSync('npm install --production --ignore-scripts', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_registry: 'https://registry.npmmirror.com' },
  })

  // Remove type-only packages that are not needed at runtime.
  // @anthropic-ai/sandbox-runtime incorrectly lists @types/lodash-es
  // in production dependencies, pulling in @types/* and undici-types.
  const packagesToRemove = ['@types', 'undici-types']
  for (const pkg of packagesToRemove) {
    const pkgPath = path.join(nodeModulesDir, pkg)
    if (fs.existsSync(pkgPath)) {
      fs.rmSync(pkgPath, { recursive: true, force: true })
      console.log(`[ensure-app-deps] Removed dev-only package: ${pkg}`)
    }
  }

  console.log('[ensure-app-deps] Done.')
}
