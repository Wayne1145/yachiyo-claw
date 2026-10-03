import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.yachiyoclaw',
  appName: 'Yachiyo Claw',
  webDir: 'dist/renderer',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Capacitor otherwise logs bridge metadata and plugin errors in debug builds.
    loggingBehavior: 'none',
  },
  plugins: {
    Keyboard: {
      // Android edge-to-edge windows do not reliably honor adjustResize alone.
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#F8FAFC',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
}

export default config
