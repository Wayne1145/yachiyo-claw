const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Inline the paths instead of importing from webpack.paths.ts
const rootPath = path.join(__dirname, '../..')
const appPath = path.join(rootPath, 'release/app')
const appNodeModulesPath = path.join(appPath, 'node_modules')

// Read dependencies from release/app/package.json
const appPackageJson = require('../../release/app/package.json')
const dependencies = appPackageJson.dependencies || {}

if (Object.keys(dependencies).length > 0 && fs.existsSync(appNodeModulesPath)) {
    const electronRebuildCmd =
        '../../node_modules/.bin/electron-rebuild --force --types prod,dev,optional --module-dir .'
    const cmd = process.platform === 'win32' ? electronRebuildCmd.replace(/\//g, '\\') : electronRebuildCmd
    execSync(cmd, {
        cwd: appPath,
        stdio: 'inherit',
    })
}
