import chalk from 'chalk'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { dependencies } from '../../package.json'

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
    
    console.debug(chalk.blue(`Found native dependencies: ${allNativeDeps.join(', ')}`))
    console.debug(chalk.gray(`- With binding.gyp: ${nativeDepsByBindingGyp.join(', ') || 'none'}`))
    console.debug(chalk.gray(`- With .node files: ${nativeDepsByNodeFiles.join(', ') || 'none'}`))
    
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
 ${chalk.whiteBright.bgYellow.bold('Webpack does not work with native dependencies.')}
${chalk.bold(filteredRootDependencies.join(', '))} ${
                plural ? 'are native dependencies' : 'is a native dependency'
            } and should be installed inside of the "./release/app" folder.
 First, uninstall the packages from "./package.json":
${chalk.whiteBright.bgGreen.bold('pnpm remove your-package')}
 ${chalk.bold('Then, instead of installing the package to the root "./package.json":')}
${chalk.whiteBright.bgRed.bold('pnpm add your-package')}
 ${chalk.bold('Install the package to "./release/app/package.json"')}
${chalk.whiteBright.bgGreen.bold('cd ./release/app && pnpm add your-package')}
 Read more about native dependencies at:
${chalk.bold('https://electron-react-boilerplate.js.org/docs/adding-dependencies/#module-structure')}
 `)
            process.exit(1)
        }
    } catch (e) {
        console.log('Native dependencies could not be checked:', e.message)
    }
}
