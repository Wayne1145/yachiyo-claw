import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/** Emit one worker script while sharing the status presenter with hosts upgrading from 1.0.0. */
export async function bundleUbuntuPlugin() {
  const result = await build({
    configFile: false,
    envDir: false,
    publicDir: false,
    logLevel: 'silent',
    build: {
      target: 'es2020',
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('../examples/plugins/ubuntu-runtime/main.js', import.meta.url)),
        formats: ['iife'],
        name: 'UbuntuRuntimePlugin',
      },
    },
  })
  const [{ output }] = Array.isArray(result) ? result : [result]
  if (output.length !== 1 || output[0].type !== 'chunk') throw new Error('Expected one standalone Ubuntu plugin worker.')
  return output[0].code
}
