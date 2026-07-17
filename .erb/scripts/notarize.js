module.exports = async function notarizeMacos(context) {
    const { notarize } = await import('@electron/notarize')
    const { electronPlatformName, appOutDir } = context
    if (electronPlatformName !== 'darwin') {
        return
    }

    if (!('APPLE_ID' in process.env && 'APPLE_ID_PASS' in process.env && 'APPLE_TEAM_ID' in process.env)) {
        console.warn('Skipping notarizing step. APPLE_ID, APPLE_ID_PASS and APPLE_TEAM_ID env variables must be set')
        return
    }

    const appName = context.packager.appInfo.productFilename

    console.log('[Notarize] start macOS notarization: notarize.js running with notarytool')

    await notarize({
        tool: 'notarytool',
        appBundleId: 'xyz.chatboxapp.app',
        appPath: `${appOutDir}/${appName}.app`,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASS,
        teamId: process.env.APPLE_TEAM_ID,
    })
}
