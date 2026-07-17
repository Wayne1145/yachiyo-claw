const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { dependencies } = require('../../package.json')

// Simple color helpers (chalk is ESM-only in newer versions)
const colors = {
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    gray: (text) => `\x1b[90m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`,
    bgYellow: (text) => `\x1b[43m\x1b[97m${text}\x1b[0m`,
    bgGreen: (text) => `\x1b[42m\x1b[97m${text}\x1b[0m`,
    bgRed: (text) => `\x1b[41m\x1b[97m${text}\x1b[0m`,
}

// Helper function to recursively find .node files in a directory
function findNodeFiles(dir) {
    const nodeFiles = []
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                // Only search in common subdirectories to avoid performance issues
                if (['build', 'prebuilds', 'lib', 'bin'].includes(entry.name)) {
                    nodeFiles.push(...findNodeFiles(fullPath))
                }
            } else if (entry.isFile() && entry.name.endsWith('.node')) {
                nodeFiles.push(fullPath)
            }
        }
    } catch (e) {
        // Ignore permission errors or missing directories
    }
    return nodeFiles
}

// Helper function to get all packages including scoped ones (@scope/pkg)
function getAllPackages(nodeModulesDir) {
    const packages = []
    try {
        const entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true })
        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            if (entry.name.startsWith('@')) {
                // Scoped package - read children
                const scopePath = path.join(nodeModulesDir, entry.name)
                try {
                    const scopedEntries = fs.readdirSync(scopePath, { withFileTypes: true })
                    for (const scopedEntry of scopedEntries) {
                        if (scopedEntry.isDirectory()) {
                            packages.push(`${entry.name}/${scopedEntry.name}`)
                        }
                    }
                } catch (e) {
                    // Ignore errors reading scoped directory
                }
            } else {
                packages.push(entry.name)
            }
        }
    } catch (e) {
        // Ignore errors reading node_modules
    }
    return packages
}

if (dependencies) {
    const dependenciesKeys = Object.keys(dependencies)
    
    // Packages to exclude from native dependency check:
    // These packages have transitive native dependencies but are correctly handled by
    // electron-vite (externalized for main process) and electron-builder (bundled from
    // release/app/node_modules). This check is designed for webpack bundling issues
    // which don't apply to electron-vite's architecture.
    //
    // - capacitor-stream-http: Capacitor plugin, not an Electron native dep
    // - epub: Optional zipfile dep, used in renderer for parsing
    // - @libsql/client, @mastra/libsql: Native bindings for SQLite, externalized by electron-vite
    // - @mastra/core, @mastra/rag: Type imports in shared + runtime in main, externalized
    // - officeparser: Uses pdfjs-dist with native canvas, externalized by electron-vite
    const excludePackages = [
        'capacitor-stream-http',
        'epub',
        '@libsql/client',
        '@mastra/libsql',
        '@mastra/core',
        '@mastra/rag',
        'officeparser',
    ]
    
    // Get all packages including scoped ones (@scope/pkg)
    const allPackages = getAllPackages('node_modules')
    
    // Check for packages with binding.gyp (source-based native modules)
    const nativeDepsByBindingGyp = allPackages.filter((pkg) => {
        if (excludePackages.includes(pkg)) return false
        return fs.existsSync(`node_modules/${pkg}/binding.gyp`)
    })
    
    // Check for packages with .node files (precompiled native modules)
    const nativeDepsByNodeFiles = allPackages.filter((pkg) => {
        if (excludePackages.includes(pkg)) return false
        const nodeFiles = findNodeFiles(`node_modules/${pkg}`)
        return nodeFiles.length > 0
    })
    
    // Combine both types of native dependencies
    const allNativeDeps = [...new Set([...nativeDepsByBindingGyp, ...nativeDepsByNodeFiles])]
    
    if (allNativeDeps.length === 0) {
        process.exit(0)
    }
    
    console.debug(colors.blue(`Found native dependencies: ${allNativeDeps.join(', ')}`))
    console.debug(colors.gray(`- With binding.gyp: ${nativeDepsByBindingGyp.join(', ') || 'none'}`))
    console.debug(colors.gray(`- With .node files: ${nativeDepsByNodeFiles.join(', ') || 'none'}`))
    
    try {
        // Find the reason for why the dependency is installed. If it is installed
        // because of a devDependency then that is okay. Warn when it is installed
        // because of a dependency
        // Note: pnpm ls --json returns an array (one entry per workspace package)
        const lsResult = JSON.parse(
            execSync(`pnpm ls ${allNativeDeps.join(' ')} --json`).toString()
        )
        const rootResult = Array.isArray(lsResult)
            ? lsResult.find((item) => item.path === process.cwd()) ?? lsResult[0]
            : lsResult
        const dependenciesObject = rootResult?.dependencies ?? {}
        const rootDependencies = Object.keys(dependenciesObject)
        const filteredRootDependencies = rootDependencies.filter((rootDependency) =>
            dependenciesKeys.includes(rootDependency) && !excludePackages.includes(rootDependency)
        )
        if (filteredRootDependencies.length > 0) {
            const plural = filteredRootDependencies.length > 1
            console.log(`
 ${colors.bgYellow(colors.bold('Webpack does not work with native dependencies.'))}
${colors.bold(filteredRootDependencies.join(', '))} ${
                plural ? 'are native dependencies' : 'is a native dependency'
            } and should be installed inside of the "./release/app" folder.
 First, uninstall the packages from "./package.json":
${colors.bgGreen(colors.bold('pnpm remove your-package'))}
 ${colors.bold('Then, instead of installing the package to the root "./package.json":')}
${colors.bgRed(colors.bold('pnpm add your-package'))}
 ${colors.bold('Install the package to "./release/app/package.json"')}
${colors.bgGreen(colors.bold('cd ./release/app && pnpm add your-package'))}
 Read more about native dependencies at:
${colors.bold('https://electron-react-boilerplate.js.org/docs/adding-dependencies/#module-structure')}
 `)
            process.exit(1)
        }
    } catch (e) {
        console.log('Native dependencies could not be checked:', e.message)
    }
}
