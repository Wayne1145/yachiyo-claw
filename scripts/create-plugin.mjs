import { createHash } from 'node:crypto'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const CAPABILITIES = new Set(['storage', 'ui', 'tools', 'sandbox', 'network', 'device'])
const REQUIRED_EXAMPLE_CAPABILITIES = ['storage', 'ui', 'tools']

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    if (name === 'force') {
      result.force = true
      continue
    }
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    result[name] = value
  }
  return result
}

function validateId(value) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value ?? '')) {
    throw new Error('Plugin id must use lowercase letters, digits, and single hyphens.')
  }
  return value
}

function parseCapabilities(value) {
  const requested = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const merged = [...new Set([...REQUIRED_EXAMPLE_CAPABILITIES, ...requested])]
  for (const capability of merged) {
    if (!CAPABILITIES.has(capability)) throw new Error(`Unknown plugin capability: ${capability}`)
  }
  return merged
}

function capabilityRequest(name, domains) {
  const reasons = {
    storage: 'Store the example counter inside this plugin isolated data namespace.',
    ui: 'Show the example controls on a host-rendered Yachiyo Claw plugin page.',
    tools: 'Expose the example echo tool and page action handlers to the host.',
    sandbox: 'Run user-approved commands inside this plugin private Linux workspace.',
    network: 'Call the explicitly listed HTTPS services through the host network proxy.',
    device: 'Request separately approved semantic screen reading and phone control actions.',
  }
  return { name, reason: reasons[name], ...(name === 'network' ? { domains } : {}) }
}

function mainSource(id) {
  return `function renderView(count) {
  return {
    schemaVersion: 1,
    title: 'Plugin example',
    children: [
      { type: 'heading', key: 'title', content: 'Hello from ${id}', level: 2 },
      { type: 'text', key: 'count', content: 'Stored count: ' + count },
      { type: 'button', key: 'increment', label: 'Increment', action: { type: 'invoke', handler: 'increment' } }
    ]
  }
}

yachiyo.registerTool('render', async function () {
  var stored = await yachiyo.host.call('storage.get', { key: 'count' })
  return renderView(Number(stored || 0))
})

yachiyo.registerTool('increment', async function () {
  var stored = await yachiyo.host.call('storage.get', { key: 'count' })
  var next = Number(stored || 0) + 1
  await yachiyo.host.call('storage.set', { key: 'count', value: String(next) })
  return renderView(next)
})

yachiyo.registerTool('${id}_echo', function (args) {
  return { echoed: args }
})
`
}

function initialView(id) {
  return {
    schemaVersion: 1,
    title: 'Plugin example',
    children: [
      { type: 'heading', key: 'title', content: `Hello from ${id}`, level: 2 },
      { type: 'text', key: 'count', content: 'Stored count: 0' },
      {
        type: 'button',
        key: 'increment',
        label: 'Increment',
        action: { type: 'invoke', handler: 'increment' },
      },
    ],
  }
}

function declarationSource() {
  return `type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type HostMethod =
  | 'storage.get' | 'storage.set' | 'storage.remove' | 'storage.keys'
  | 'network.fetch' | 'sandbox.exec' | 'sandbox.readFile' | 'sandbox.writeFile'
  | 'device.observe' | 'device.find' | 'device.click' | 'device.setText'
  | 'device.scroll' | 'device.launch' | 'device.keyevent'
declare const yachiyo: {
  registerTool(name: string, handler: (args: JsonValue) => JsonValue | Promise<JsonValue>): void
  log(level: 'log' | 'warn' | 'error', message: string): void
  host: { call(method: HostMethod, args: JsonValue): Promise<any> }
}
`
}

function buildScriptSource() {
  return `import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const paths = ['main.js', 'ui/main.json']
const files = await Promise.all(paths.map(async (path) => {
  const bytes = await readFile(new URL(path, import.meta.url))
  return { path, bytes, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
}))
const manifest = JSON.parse(await readFile(new URL('manifest.template.json', import.meta.url), 'utf8'))
manifest.entrySha256 = files.find((file) => file.path === manifest.entry).sha256
manifest.files = files.map(({ path, size, sha256 }) => ({ path, size, sha256 }))
await writeFile(new URL('yachiyo-plugin.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\\n')
const zip = new JSZip()
zip.file('yachiyo-plugin.json', JSON.stringify(manifest, null, 2))
for (const file of files) zip.file(file.path, file.bytes)
await writeFile(new URL(manifest.id + '.zip', import.meta.url), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log('Built ' + manifest.id + '.zip')
`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function createPluginProject(options) {
  const id = validateId(options.id)
  const name = String(options.name ?? '').trim()
  if (!name || name.length > 80) throw new Error('Plugin name must contain 1-80 characters.')
  const capabilities = parseCapabilities(options.capabilities)
  const domains = String(options.domains ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (capabilities.includes('network') && domains.length === 0) {
    throw new Error('--domains is required when the network capability is selected.')
  }

  const cwd = resolve(options.cwd ?? process.cwd())
  const output = resolve(cwd, options.output ?? `plugins/${id}`)
  const pathFromWorkspace = relative(cwd, output)
  if (!pathFromWorkspace || pathFromWorkspace === '.' || pathFromWorkspace.startsWith('..') || pathFromWorkspace.includes(':')) {
    throw new Error('Plugin output must stay inside the current workspace.')
  }
  if (await exists(output)) {
    if (!options.force) throw new Error(`Output already exists: ${output}`)
    await rm(output, { recursive: true, force: true })
  }
  await mkdir(resolve(output, 'ui'), { recursive: true })

  const main = Buffer.from(mainSource(id))
  const view = Buffer.from(`${JSON.stringify(initialView(id), null, 2)}\n`)
  const manifest = {
    schemaVersion: 1,
    id,
    version: '1.0.0',
    displayName: name,
    description: 'A Yachiyo Claw plugin generated by the official scaffold.',
    author: { name: 'Plugin Author' },
    license: 'GPL-3.0-only',
    mode: 'script-enabled',
    entry: 'main.js',
    entrySha256: sha256(main),
    capabilities: capabilities.map((capability) => capabilityRequest(capability, domains)),
    contributions: {
      view: 'ui/main.json',
      settingsEntries: [
        {
          group: 'app',
          label: name,
          detail: 'Open the generated plugin example.',
          route: `/plugin/${id}`,
          order: 900,
        },
      ],
      tools: [
        {
          name: `${id}_echo`,
          description: 'Echo JSON data from the plugin isolated execution environment.',
        },
      ],
    },
    files: [
      { path: 'main.js', size: main.byteLength, sha256: sha256(main) },
      { path: 'ui/main.json', size: view.byteLength, sha256: sha256(view) },
    ],
  }

  const writes = [
    ['main.js', main],
    ['ui/main.json', view],
    ['manifest.template.json', `${JSON.stringify({ ...manifest, entrySha256: undefined, files: undefined }, null, 2)}\n`],
    ['yachiyo-plugin.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['yachiyo-plugin.d.ts', declarationSource()],
    ['build.mjs', buildScriptSource()],
    [
      'package.json',
      `${JSON.stringify({ private: true, type: 'module', scripts: { build: 'node build.mjs' }, devDependencies: { jszip: '3.10.1' } }, null, 2)}\n`,
    ],
    [
      'README.md',
      `# ${name}\n\nRun \`pnpm install && pnpm build\`, then install \`${id}.zip\` from Yachiyo Claw Settings > Plugins. Editing code changes its digest and requires fresh capability consent.\n`,
    ],
  ]
  for (const [path, content] of writes) {
    const target = resolve(output, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  const zip = new JSZip()
  zip.file('yachiyo-plugin.json', JSON.stringify(manifest, null, 2))
  zip.file('main.js', main)
  zip.file('ui/main.json', view)
  const archive = resolve(output, `${id}.zip`)
  await writeFile(archive, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return { output, archive, manifest }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const created = await createPluginProject({
      id: args.id,
      name: args.name,
      capabilities: args.capabilities,
      domains: args.domains,
      output: args.output,
      force: Boolean(args.force),
    })
    process.stdout.write(`${created.archive}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
