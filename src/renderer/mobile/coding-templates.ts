import type { BuildTargetId } from '@shared/types'

export interface CodingTemplateFile { path: string; content: string }

const html = (name: string) => `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><link rel="stylesheet" href="./style.css"></head>
<body><main><h1>${name}</h1><p>Built on your Android device.</p><button id="action">Get started</button></main><script src="./app.js"></script></body></html>
`

const webFiles = (name: string): CodingTemplateFile[] => [
  { path: 'index.html', content: html(name) },
  { path: 'style.css', content: `:root{font-family:system-ui;color:#171717;background:#fff}body{margin:0}main{max-width:42rem;margin:0 auto;padding:4rem 1.25rem}button{border:0;border-radius:8px;padding:.75rem 1rem;background:#e94971;color:#fff;font:inherit}` },
  { path: 'app.js', content: `document.querySelector('#action').addEventListener('click',()=>{document.querySelector('p').textContent='Your project is ready.'})\n` },
]

const viteFiles = (name: string, pwa: boolean): CodingTemplateFile[] => [
  { path: 'package.json', content: JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), private: true, version: '0.1.0', type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'tsc --noEmit && vite build', check: 'tsc --noEmit' }, dependencies: {}, devDependencies: { typescript: '5.8.3', vite: '7.2.6' } }) },
  { path: 'index.html', content: `${pwa ? '<link rel="manifest" href="/manifest.webmanifest">' : ''}<div id="app"></div><script type="module" src="/src/main.ts"></script>` },
  {
    path: 'src/main.ts',
    content: `import './style.css'\ndocument.querySelector<HTMLDivElement>('#app')!.innerHTML = '<main><h1>${name}</h1><p>Built on Android.</p></main>'\n${pwa ? `if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')\n` : ''}`,
  },
  { path: 'src/style.css', content: `:root{font-family:system-ui;color:#171717}body{margin:0}main{padding:3rem 1.25rem}` },
  { path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, lib: ['ES2022', 'DOM'] }, include: ['src'] }) },
  ...(pwa ? [
    { path: 'public/manifest.webmanifest', content: JSON.stringify({ name, short_name: name.slice(0, 12), start_url: '/', display: 'standalone', theme_color: '#e94971', background_color: '#ffffff' }) },
    { path: 'public/sw.js', content: `const CACHE='app-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))))` },
  ] : []),
]

function capacitorFiles(name: string, packageName: string): CodingTemplateFile[] {
  const files = viteFiles(name, false)
  const packageFile = files.find((file) => file.path === 'package.json')
  if (!packageFile) throw new Error('coding_capacitor_package_missing')
  const packageJson = JSON.parse(packageFile.content) as Record<string, unknown>
  packageJson.dependencies = { '@capacitor/android': '7.4.5', '@capacitor/core': '7.4.5' }
  packageJson.devDependencies = {
    ...(packageJson.devDependencies as Record<string, string>),
    '@capacitor/cli': '7.4.5',
  }
  packageFile.content = JSON.stringify(packageJson)
  return [
    ...files,
    { path: 'capacitor.config.ts', content: `import type { CapacitorConfig } from '@capacitor/cli'\nconst config:CapacitorConfig={appId:'${packageName}',appName:'${name.replace(/'/g, '')}',webDir:'dist'}\nexport default config\n` },
  ]
}

function kotlinFiles(name: string, packageName: string): CodingTemplateFile[] {
  const packagePath = packageName.replace(/\./g, '/')
  return [
    { path: 'settings.gradle.kts', content: `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name = "${name.replace(/"/g, '')}"\ninclude(":app")\n` },
    { path: 'build.gradle.kts', content: `plugins { id("com.android.application") version "8.8.2" apply false; id("org.jetbrains.kotlin.android") version "2.1.10" apply false }\n` },
    { path: 'app/build.gradle.kts', content: `plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }\nandroid { namespace = "${packageName}"; compileSdk = 35\n defaultConfig { applicationId = "${packageName}"; minSdk = 23; targetSdk = 35; versionCode = 1; versionName = "1.0" } }\n` },
    { path: 'app/src/main/AndroidManifest.xml', content: `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:theme="@style/AppTheme" android:label="${name}"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>` },
    { path: `app/src/main/java/${packagePath}/MainActivity.kt`, content: `package ${packageName}\nimport android.app.Activity\nimport android.os.Bundle\nimport android.widget.TextView\nclass MainActivity:Activity(){override fun onCreate(state:Bundle?){super.onCreate(state);setContentView(TextView(this).apply{text="${name}";textSize=28f;setPadding(48,96,48,48)})}}\n` },
    { path: 'app/src/main/res/values/styles.xml', content: `<resources><style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar"><item name="android:fontFamily">sans</item><item name="android:colorAccent">#e94971</item></style></resources>` },
  ]
}

export function codingTemplateFiles(target: BuildTargetId, name: string, packageName: string): CodingTemplateFile[] {
  if (target === 'web-static') return webFiles(name)
  if (target === 'web-vite') return viteFiles(name, false)
  if (target === 'web-pwa') return viteFiles(name, true)
  if (target === 'android-capacitor') return capacitorFiles(name, packageName)
  if (target === 'android-kotlin') return kotlinFiles(name, packageName)
  throw new Error(`coding_template_unavailable:${target}`)
}
