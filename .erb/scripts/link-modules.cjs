const fs = require('fs')
const path = require('path')

// Inline the paths
const rootPath = path.join(__dirname, '../..')
const srcNodeModulesPath = path.join(rootPath, 'src/node_modules')
const appNodeModulesPath = path.join(rootPath, 'release/app/node_modules')

if (!fs.existsSync(srcNodeModulesPath) && fs.existsSync(appNodeModulesPath)) {
    fs.symlinkSync(appNodeModulesPath, srcNodeModulesPath, 'junction')
}
