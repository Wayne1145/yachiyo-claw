param(
  [Parameter(Position = 0)]
  [ValidateSet('doctor', 'pnpm', 'gradle', 'adb', 'sdkmanager')]
  [string]$Action = 'doctor',

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ActionArgs
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolsRoot = Join-Path $workspaceRoot '.tools'
$cacheRoot = Join-Path $workspaceRoot '.cache'
$androidSdk = Join-Path $toolsRoot 'android-sdk'
$proxyUrl = if ($env:YACHIYO_PROXY_URL) { $env:YACHIYO_PROXY_URL } else { 'http://127.0.0.1:7890' }
$toolchainLockPath = Join-Path $workspaceRoot 'toolchain.lock.json'
$toolchainLock = Get-Content -Raw $toolchainLockPath | ConvertFrom-Json
$workspaceNode = Join-Path $workspaceRoot $toolchainLock.node.path
$androidNdk = Join-Path $androidSdk ("ndk\$($toolchainLock.android.ndk)")
$androidCmake = Join-Path $androidSdk ("cmake\$($toolchainLock.android.cmake)")

try {
  $proxyUri = [Uri]$proxyUrl
} catch {
  throw "YACHIYO_PROXY_URL is not a valid URI: $proxyUrl"
}

if (-not $proxyUri.IsAbsoluteUri) {
  throw "YACHIYO_PROXY_URL must be an absolute HTTP or HTTPS URI: $proxyUrl"
}
if ($proxyUri.Scheme -in @('socks', 'socks5')) {
  throw 'YACHIYO_PROXY_URL cannot use SOCKS because Gradle does not support SOCKS proxy configuration.'
}
if ($proxyUri.Scheme -notin @('http', 'https')) {
  throw "YACHIYO_PROXY_URL must use HTTP or HTTPS: $proxyUrl"
}
if ([string]::IsNullOrWhiteSpace($proxyUri.DnsSafeHost)) {
  throw "YACHIYO_PROXY_URL must include a proxy host: $proxyUrl"
}
if (-not [string]::IsNullOrEmpty($proxyUri.UserInfo)) {
  throw 'YACHIYO_PROXY_URL must not contain credentials because Gradle proxy properties are stored on disk.'
}
if ($proxyUri.AbsolutePath -ne '/' -or $proxyUri.Query -or $proxyUri.Fragment) {
  throw "YACHIYO_PROXY_URL must contain only a scheme, host, and optional port: $proxyUrl"
}

$proxyUrl = $proxyUri.GetLeftPart([UriPartial]::Authority)
$proxyHost = $proxyUri.DnsSafeHost
$proxyPort = $proxyUri.Port

if (-not (Test-Path -LiteralPath (Join-Path $workspaceNode 'node.exe'))) {
  throw "Workspace Node.js is missing. Expected $workspaceNode"
}

$workspaceJdk = Join-Path $workspaceRoot $toolchainLock.jdk.path
$workspaceJava = Join-Path $workspaceJdk 'bin\java.exe'
if (-not (Test-Path -LiteralPath $workspaceJava -PathType Leaf)) {
  throw "Workspace JDK is missing. Expected $workspaceJava"
}

# Keep every downloaded toolchain and package cache inside the repository workspace.
$env:HTTP_PROXY = $proxyUrl
$env:HTTPS_PROXY = $proxyUrl
$env:ALL_PROXY = $proxyUrl
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$env:COREPACK_HOME = Join-Path $toolsRoot 'corepack'
$env:PNPM_HOME = Join-Path $toolsRoot 'pnpm-home'
$env:PNPM_STORE_DIR = Join-Path $cacheRoot 'pnpm-store'
$env:npm_config_store_dir = $env:PNPM_STORE_DIR
$env:npm_config_cache = Join-Path $cacheRoot 'npm'
$env:GRADLE_USER_HOME = Join-Path $cacheRoot 'gradle'
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:ANDROID_USER_HOME = Join-Path $cacheRoot 'android-user'
$env:TEMP = Join-Path $cacheRoot 'tmp'
$env:TMP = $env:TEMP
$env:JAVA_HOME = $workspaceJdk

@(
  $toolsRoot,
  $cacheRoot,
  $env:COREPACK_HOME,
  $env:PNPM_HOME,
  $env:PNPM_STORE_DIR,
  $env:npm_config_cache,
  $env:GRADLE_USER_HOME,
  $env:ANDROID_USER_HOME,
  $env:TEMP,
  $androidSdk
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

function Set-GradleProxyProperties {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$NonProxyHosts
  )

  $managedStart = '# Yachiyo Claw managed proxy: begin'
  $managedEnd = '# Yachiyo Claw managed proxy: end'
  $preserved = New-Object 'System.Collections.Generic.List[string]'
  $insideManagedBlock = $false
  $foundManagedBlock = $false

  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $Path) {
      if ($line -eq $managedStart) {
        if ($insideManagedBlock -or $foundManagedBlock) {
          throw "Malformed managed Gradle proxy block in $Path"
        }
        $insideManagedBlock = $true
        $foundManagedBlock = $true
        continue
      }
      if ($line -eq $managedEnd) {
        if (-not $insideManagedBlock) {
          throw "Malformed managed Gradle proxy block in $Path"
        }
        $insideManagedBlock = $false
        continue
      }
      if ($insideManagedBlock) {
        continue
      }

      # Remove the legacy unmanaged proxy keys so stale values cannot override this block.
      if ($line -match '^systemProp\.(?:http|https)\.(?:proxyHost|proxyPort|nonProxyHosts)\s*=') {
        continue
      }
      $preserved.Add($line)
    }
  }

  if ($insideManagedBlock) {
    throw "Unterminated managed Gradle proxy block in $Path"
  }
  while ($preserved.Count -gt 0 -and [string]::IsNullOrWhiteSpace($preserved[$preserved.Count - 1])) {
    $preserved.RemoveAt($preserved.Count - 1)
  }
  if ($preserved.Count -gt 0) {
    $preserved.Add('')
  }

  $preserved.Add($managedStart)
  $preserved.Add("systemProp.http.proxyHost=$HostName")
  $preserved.Add("systemProp.http.proxyPort=$Port")
  $preserved.Add("systemProp.https.proxyHost=$HostName")
  $preserved.Add("systemProp.https.proxyPort=$Port")
  $preserved.Add("systemProp.http.nonProxyHosts=$NonProxyHosts")
  $preserved.Add("systemProp.https.nonProxyHosts=$NonProxyHosts")
  $preserved.Add($managedEnd)

  $temporaryPath = Join-Path (Split-Path -Parent $Path) ('.gradle-properties-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $backupPath = $temporaryPath + '.bak'
  try {
    [IO.File]::WriteAllLines($temporaryPath, $preserved, (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      [IO.File]::Replace($temporaryPath, $Path, $backupPath)
    } else {
      [IO.File]::Move($temporaryPath, $Path)
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
    if (Test-Path -LiteralPath $backupPath) {
      Remove-Item -LiteralPath $backupPath -Force
    }
  }
}

$gradleProperties = Join-Path $env:GRADLE_USER_HOME 'gradle.properties'
$gradleProxyMutex = [Threading.Mutex]::new($false, 'Local\YachiyoClawGradleProxyProperties')
$gradleProxyMutexAcquired = $false
try {
  $gradleProxyMutexAcquired = $gradleProxyMutex.WaitOne([TimeSpan]::FromSeconds(30))
  if (-not $gradleProxyMutexAcquired) {
    throw 'Timed out waiting to configure the workspace Gradle proxy.'
  }
  Set-GradleProxyProperties `
    -Path $gradleProperties `
    -HostName $proxyHost `
    -Port $proxyPort `
    -NonProxyHosts 'localhost|127.*|[::1]'
} finally {
  if ($gradleProxyMutexAcquired) {
    $gradleProxyMutex.ReleaseMutex()
  }
  $gradleProxyMutex.Dispose()
}

$androidPaths = @(
  (Join-Path $androidSdk 'platform-tools'),
  (Join-Path $androidSdk 'cmdline-tools\latest\bin'),
  (Join-Path $androidCmake 'bin')
)
$workspaceJdkBin = Join-Path $workspaceJdk 'bin'
$env:Path = (@($workspaceNode, $workspaceJdkBin, $env:PNPM_HOME) + $androidPaths + @($env:Path)) -join [IO.Path]::PathSeparator

function Invoke-WorkspaceCommand {
  param([string]$Executable, [string[]]$Arguments)
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Get-AndroidPackageStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )

  $properties = Join-Path $Root 'source.properties'
  if (-not (Test-Path -LiteralPath $properties -PathType Leaf)) {
    return "missing (expected $ExpectedVersion at $Root)"
  }

  $revision = Get-Content -LiteralPath $properties |
    ForEach-Object { if ($_ -match '^Pkg\.Revision\s*=\s*(.+?)\s*$') { $Matches[1] } } |
    Select-Object -First 1
  if ($revision -ne $ExpectedVersion) {
    return "version $revision (expected $ExpectedVersion at $Root)"
  }
  return "$revision ($Root)"
}

switch ($Action) {
  'pnpm' {
    Invoke-WorkspaceCommand 'corepack' (@('pnpm') + $ActionArgs)
  }
  'gradle' {
    $gradle = Join-Path $workspaceRoot 'android\gradlew.bat'
    if (-not (Test-Path -LiteralPath $gradle)) {
      throw 'Android Gradle wrapper is not initialized yet.'
    }
    Invoke-WorkspaceCommand $gradle (@('-p', (Join-Path $workspaceRoot 'android')) + $ActionArgs)
  }
  'adb' {
    $adb = Join-Path $androidSdk 'platform-tools\adb.exe'
    if (-not (Test-Path -LiteralPath $adb)) {
      throw 'Workspace Android platform-tools are not installed yet.'
    }
    Invoke-WorkspaceCommand $adb $ActionArgs
  }
  'sdkmanager' {
    $sdkManager = Join-Path $androidSdk 'cmdline-tools\latest\bin\sdkmanager.bat'
    if (-not (Test-Path -LiteralPath $sdkManager)) {
      throw 'Workspace Android command-line tools are not installed yet.'
    }
    Invoke-WorkspaceCommand $sdkManager $ActionArgs
  }
  default {
    [pscustomobject]@{
      Workspace = $workspaceRoot
      Proxy = $proxyUrl
      Node = (node --version)
      Java = (java --version | Select-Object -First 1)
      JavaHome = $env:JAVA_HOME
      CorepackHome = $env:COREPACK_HOME
      PnpmStore = $env:PNPM_STORE_DIR
      GradleHome = $env:GRADLE_USER_HOME
      AndroidSdk = $env:ANDROID_SDK_ROOT
      AndroidNdk = Get-AndroidPackageStatus -Root $androidNdk -ExpectedVersion ([string]$toolchainLock.android.ndk)
      AndroidCmake = Get-AndroidPackageStatus -Root $androidCmake -ExpectedVersion ([string]$toolchainLock.android.cmake)
    } | Format-List
  }
}
