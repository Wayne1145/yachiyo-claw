[CmdletBinding()]
param(
  [switch]$VerifyOnly,
  [switch]$AcceptAndroidLicenses
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($VerifyOnly -and $AcceptAndroidLicenses) {
  throw '-VerifyOnly cannot be combined with -AcceptAndroidLicenses because verification is read-only.'
}

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot '.tools'))
$cacheRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot '.cache'))
$downloadsRoot = [IO.Path]::GetFullPath((Join-Path $toolsRoot 'downloads'))
$bootstrapRoot = [IO.Path]::GetFullPath((Join-Path $toolsRoot '.bootstrap'))
$lockPath = Join-Path $workspaceRoot 'toolchain.lock.json'

if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
  throw "Toolchain lock file is missing: $lockPath"
}

$toolchain = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
$proxyUrl = if ([string]::IsNullOrWhiteSpace($env:YACHIYO_PROXY_URL)) {
  'http://127.0.0.1:7890'
} else {
  $env:YACHIYO_PROXY_URL
}

try {
  $proxyUri = [Uri]$proxyUrl
} catch {
  throw "YACHIYO_PROXY_URL is not a valid URI: $proxyUrl"
}

if (-not $proxyUri.IsAbsoluteUri -or $proxyUri.Scheme -notin @('http', 'https', 'socks', 'socks5')) {
  throw "YACHIYO_PROXY_URL must be an absolute HTTP, HTTPS, SOCKS, or SOCKS5 URI: $proxyUrl"
}

function Get-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [IO.Path]::GetFullPath($Path)
}

function Assert-PathWithin {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot,
    [switch]$AllowRoot
  )

  $fullPath = Get-NormalizedPath $Path
  $fullRoot = Get-NormalizedPath $AllowedRoot
  $rootPrefix = $fullRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $isRoot = $fullPath.Equals($fullRoot, [StringComparison]::OrdinalIgnoreCase)
  $isChild = $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)

  if ((-not $isChild) -and (-not ($AllowRoot -and $isRoot))) {
    throw "Unsafe path outside $fullRoot`: $fullPath"
  }

  return $fullPath
}

function Remove-WorkspacePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )

  $safePath = Assert-PathWithin -Path $Path -AllowedRoot $AllowedRoot
  if (Test-Path -LiteralPath $safePath) {
    Remove-Item -LiteralPath $safePath -Recurse -Force
  }
}

function Assert-LockString {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "toolchain.lock.json is missing '$Name'."
  }
}

function Assert-Digest {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][ValidateSet('SHA256', 'SHA1')][string]$Algorithm,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $length = if ($Algorithm -eq 'SHA256') { 64 } else { 40 }
  if ($Value -notmatch "^[A-Fa-f0-9]{$length}$") {
    throw "toolchain.lock.json contains an invalid $Algorithm digest for '$Name'."
  }
}

function Assert-VersionString {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Pattern = '^\d+(?:\.\d+)+(?:[+_-][A-Za-z0-9.-]+)?$'
  )

  Assert-LockString $Value $Name
  if ($Value -notmatch $Pattern) {
    throw "toolchain.lock.json contains an unsafe or invalid version for '$Name': $Value"
  }
}

function Assert-DownloadUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Name
  )

  Assert-LockString $Value $Name
  try {
    $uri = [Uri]$Value
  } catch {
    throw "toolchain.lock.json contains an invalid URL for '$Name': $Value"
  }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https') {
    throw "toolchain.lock.json download URL '$Name' must use HTTPS: $Value"
  }
}

Assert-VersionString ([string]$toolchain.node.version) 'node.version'
Assert-LockString ([string]$toolchain.node.path) 'node.path'
Assert-LockString ([string]$toolchain.node.archive) 'node.archive'
Assert-DownloadUrl ([string]$toolchain.node.url) 'node.url'
Assert-Digest ([string]$toolchain.node.sha256) 'SHA256' 'node.sha256'
Assert-VersionString ([string]$toolchain.jdk.version) 'jdk.version'
Assert-LockString ([string]$toolchain.jdk.path) 'jdk.path'
Assert-LockString ([string]$toolchain.jdk.archive) 'jdk.archive'
Assert-DownloadUrl ([string]$toolchain.jdk.url) 'jdk.url'
Assert-Digest ([string]$toolchain.jdk.sha256) 'SHA256' 'jdk.sha256'
Assert-LockString ([string]$toolchain.android.sdkPath) 'android.sdkPath'
Assert-VersionString ([string]$toolchain.android.commandLineTools.version) 'android.commandLineTools.version'
Assert-LockString ([string]$toolchain.android.commandLineTools.archive) 'android.commandLineTools.archive'
Assert-DownloadUrl ([string]$toolchain.android.commandLineTools.url) 'android.commandLineTools.url'
Assert-Digest ([string]$toolchain.android.commandLineTools.sha256) 'SHA256' 'android.commandLineTools.sha256'
if (-not [string]::IsNullOrWhiteSpace([string]$toolchain.android.commandLineTools.sha1)) {
  Assert-Digest ([string]$toolchain.android.commandLineTools.sha1) 'SHA1' 'android.commandLineTools.sha1'
}
Assert-VersionString ([string]$toolchain.android.platformTools) 'android.platformTools'
Assert-VersionString ([string]$toolchain.android.compileSdk) 'android.compileSdk' '^\d{1,3}$'
Assert-VersionString ([string]$toolchain.android.platformRevision) 'android.platformRevision' '^\d+(?:\.\d+)*$'
if (@($toolchain.android.buildTools).Count -eq 0) {
  throw "toolchain.lock.json must contain at least one 'android.buildTools' version."
}
foreach ($buildToolsVersion in @($toolchain.android.buildTools)) {
  Assert-VersionString ([string]$buildToolsVersion) 'android.buildTools'
}

$nodeRoot = Assert-PathWithin -Path (Join-Path $workspaceRoot ([string]$toolchain.node.path)) -AllowedRoot $toolsRoot
$jdkRoot = Assert-PathWithin -Path (Join-Path $workspaceRoot ([string]$toolchain.jdk.path)) -AllowedRoot $toolsRoot
$androidSdkRoot = Assert-PathWithin -Path (Join-Path $workspaceRoot ([string]$toolchain.android.sdkPath)) -AllowedRoot $toolsRoot
$commandLineToolsRoot = Assert-PathWithin -Path (Join-Path $androidSdkRoot 'cmdline-tools\latest') -AllowedRoot $toolsRoot

function Test-PathOverlap {
  param(
    [Parameter(Mandatory = $true)][string]$First,
    [Parameter(Mandatory = $true)][string]$Second
  )

  $firstPath = Get-NormalizedPath $First
  $secondPath = Get-NormalizedPath $Second
  $firstPrefix = $firstPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $secondPrefix = $secondPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  return $firstPath.Equals($secondPath, [StringComparison]::OrdinalIgnoreCase) -or
    $firstPath.StartsWith($secondPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $secondPath.StartsWith($firstPrefix, [StringComparison]::OrdinalIgnoreCase)
}

$installRoots = @($nodeRoot, $jdkRoot, $androidSdkRoot)
for ($i = 0; $i -lt $installRoots.Count; $i++) {
  foreach ($reservedRoot in @($downloadsRoot, $bootstrapRoot)) {
    if (Test-PathOverlap -First $installRoots[$i] -Second $reservedRoot) {
      throw "Tool installation path overlaps reserved bootstrap storage: $($installRoots[$i])"
    }
  }
  for ($j = $i + 1; $j -lt $installRoots.Count; $j++) {
    if (Test-PathOverlap -First $installRoots[$i] -Second $installRoots[$j]) {
      throw "Tool installation paths overlap: $($installRoots[$i]) and $($installRoots[$j])"
    }
  }
}

foreach ($archiveName in @(
  [string]$toolchain.node.archive,
  [string]$toolchain.jdk.archive,
  [string]$toolchain.android.commandLineTools.archive
)) {
  if ([IO.Path]::GetFileName($archiveName) -ne $archiveName) {
    throw "Archive names in toolchain.lock.json must not contain a path: $archiveName"
  }
}

$env:HTTP_PROXY = $proxyUrl
$env:HTTPS_PROXY = $proxyUrl
$env:ALL_PROXY = $proxyUrl
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $androidSdkRoot
$env:ANDROID_SDK_ROOT = $androidSdkRoot
$env:REPO_OS_OVERRIDE = 'windows'
$env:GRADLE_USER_HOME = Join-Path $cacheRoot 'gradle'
$env:ANDROID_USER_HOME = Join-Path $cacheRoot 'android-user'
$env:TEMP = Join-Path $downloadsRoot '.tmp'
$env:TMP = $env:TEMP

function Get-NativeResult {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [string[]]$Arguments = @()
  )

  # Windows PowerShell 5.1 wraps native stderr (including `java -version`) as
  # non-terminating ErrorRecord objects when the caller uses Stop semantics.
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $Executable @Arguments 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = $output.Trim()
  }
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Executable @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0) {
    throw "$FailureMessage (exit code $exitCode)"
  }
}

function Get-SourceProperty {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $File) {
    if ($line -match ('^' + [regex]::Escape($Name) + '\s*=\s*(.+?)\s*$')) {
      return $Matches[1]
    }
  }

  return $null
}

function Test-NodeInstallation {
  param([Parameter(Mandatory = $true)][string]$Root)

  $node = Join-Path $Root 'node.exe'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    return $false
  }

  if ($VerifyOnly) {
    return (Get-Item -LiteralPath $node).VersionInfo.ProductVersion -eq [string]$toolchain.node.version
  }

  $result = Get-NativeResult -Executable $node -Arguments @('--version')
  return $result.ExitCode -eq 0 -and $result.Output.TrimStart('v') -eq [string]$toolchain.node.version
}

function Test-JdkInstallation {
  param([Parameter(Mandatory = $true)][string]$Root)

  $java = Join-Path $Root 'bin\java.exe'
  $release = Join-Path $Root 'release'
  if (-not (Test-Path -LiteralPath $java -PathType Leaf) -or -not (Test-Path -LiteralPath $release -PathType Leaf)) {
    return $false
  }

  $fullVersion = $null
  foreach ($line in Get-Content -LiteralPath $release) {
    if ($line -match '^FULL_VERSION="(.+)"$') {
      $fullVersion = $Matches[1] -replace '-LTS$', ''
      break
    }
  }

  if ($fullVersion -ne [string]$toolchain.jdk.version) {
    return $false
  }

  if ($VerifyOnly) {
    return $true
  }

  $result = Get-NativeResult -Executable $java -Arguments @('-version')
  return $result.ExitCode -eq 0
}

function Test-CommandLineToolsInstallation {
  param([Parameter(Mandatory = $true)][string]$Root)

  $sdkManager = Join-Path $Root 'bin\sdkmanager.bat'
  $revision = Get-SourceProperty -File (Join-Path $Root 'source.properties') -Name 'Pkg.Revision'
  if (-not (Test-Path -LiteralPath $sdkManager -PathType Leaf) -or $revision -ne [string]$toolchain.android.commandLineTools.version) {
    return $false
  }

  if ($VerifyOnly) {
    return $true
  }

  if (-not (Test-JdkInstallation -Root $jdkRoot)) {
    return $false
  }

  $result = Get-NativeResult -Executable $sdkManager -Arguments @('--version')
  return $result.ExitCode -eq 0 -and (($result.Output -split "`r?`n") -contains [string]$toolchain.android.commandLineTools.version)
}

function Assert-ArchiveHash {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$Sha256,
    [string]$Sha1
  )

  $safeArchive = Assert-PathWithin -Path $ArchivePath -AllowedRoot $downloadsRoot
  $actualSha256 = (Get-FileHash -LiteralPath $safeArchive -Algorithm SHA256).Hash
  if (-not $actualSha256.Equals($Sha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw "SHA256 mismatch for $safeArchive. Expected $Sha256, got $actualSha256."
  }

  if (-not [string]::IsNullOrWhiteSpace($Sha1)) {
    $actualSha1 = (Get-FileHash -LiteralPath $safeArchive -Algorithm SHA1).Hash
    if (-not $actualSha1.Equals($Sha1, [StringComparison]::OrdinalIgnoreCase)) {
      throw "SHA1 mismatch for $safeArchive. Expected $Sha1, got $actualSha1."
    }
  }
}

function Get-VerifiedArchive {
  param(
    [Parameter(Mandatory = $true)][string]$ArchiveName,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Sha256,
    [string]$Sha1
  )

  $destination = Assert-PathWithin -Path (Join-Path $downloadsRoot $ArchiveName) -AllowedRoot $downloadsRoot
  if (Test-Path -LiteralPath $destination -PathType Leaf) {
    try {
      Assert-ArchiveHash -ArchivePath $destination -Sha256 $Sha256 -Sha1 $Sha1
      Write-Host "[cache] $ArchiveName"
      return $destination
    } catch {
      Write-Warning "Removing corrupt cached archive: $destination"
      Remove-Item -LiteralPath $destination -Force
    }
  }

  $partial = Assert-PathWithin -Path (Join-Path $downloadsRoot ('.partial-' + [guid]::NewGuid().ToString('N') + '-' + $ArchiveName)) -AllowedRoot $downloadsRoot
  try {
    Write-Host "[download] $Url"
    $request = @{
      Uri = $Url
      OutFile = $partial
      Proxy = $proxyUrl
      UseBasicParsing = $true
      UserAgent = 'Yachiyo-Claw-Toolchain-Bootstrap/1'
    }
    Invoke-WebRequest @request
    Assert-ArchiveHash -ArchivePath $partial -Sha256 $Sha256 -Sha1 $Sha1
    Move-Item -LiteralPath $partial -Destination $destination
    return $destination
  } finally {
    if (Test-Path -LiteralPath $partial) {
      Remove-Item -LiteralPath $partial -Force
    }
  }
}

function Expand-ArchiveSafely {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $safeArchive = Assert-PathWithin -Path $ArchivePath -AllowedRoot $downloadsRoot
  $safeDestination = Assert-PathWithin -Path $Destination -AllowedRoot $toolsRoot
  New-Item -ItemType Directory -Force -Path $safeDestination | Out-Null

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($safeArchive)
  try {
    foreach ($entry in $zip.Entries) {
      $entryPath = $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)
      $expandedPath = [IO.Path]::GetFullPath((Join-Path $safeDestination $entryPath))
      Assert-PathWithin -Path $expandedPath -AllowedRoot $safeDestination -AllowRoot | Out-Null
    }
  } finally {
    $zip.Dispose()
  }

  Expand-Archive -LiteralPath $safeArchive -DestinationPath $safeDestination
}

function Set-DirectoryFromStage {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$SessionRoot
  )

  $safeSource = Assert-PathWithin -Path $Source -AllowedRoot $toolsRoot
  $safeDestination = Assert-PathWithin -Path $Destination -AllowedRoot $toolsRoot
  $safeSession = Assert-PathWithin -Path $SessionRoot -AllowedRoot $toolsRoot
  if (-not (Test-Path -LiteralPath $safeSource -PathType Container)) {
    throw "Staged tool directory is missing: $safeSource"
  }

  $parent = Assert-PathWithin -Path (Split-Path -Parent $safeDestination) -AllowedRoot $toolsRoot -AllowRoot
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $backup = Join-Path $safeSession ('previous-' + [guid]::NewGuid().ToString('N'))
  $hadPrevious = Test-Path -LiteralPath $safeDestination

  try {
    if ($hadPrevious) {
      Move-Item -LiteralPath $safeDestination -Destination $backup
    }
    Move-Item -LiteralPath $safeSource -Destination $safeDestination
  } catch {
    if ((-not (Test-Path -LiteralPath $safeDestination)) -and (Test-Path -LiteralPath $backup)) {
      Move-Item -LiteralPath $backup -Destination $safeDestination
    }
    throw
  }

  if (Test-Path -LiteralPath $backup) {
    Remove-WorkspacePath -Path $backup -AllowedRoot $safeSession
  }
}

function Find-SingleToolRoot {
  param(
    [Parameter(Mandatory = $true)][string]$ExtractionRoot,
    [Parameter(Mandatory = $true)][string]$RelativeMarker
  )

  $matches = @(
    Get-ChildItem -LiteralPath $ExtractionRoot -Directory |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $RelativeMarker) -PathType Leaf }
  )
  if ($matches.Count -ne 1) {
    throw "Expected one directory containing '$RelativeMarker' in $ExtractionRoot; found $($matches.Count)."
  }
  return $matches[0].FullName
}

function Ensure-Node {
  param([Parameter(Mandatory = $true)][string]$SessionRoot)

  if (Test-NodeInstallation -Root $nodeRoot) {
    Write-Host "[ok] Node.js $($toolchain.node.version)"
    return
  }

  $archive = Get-VerifiedArchive -ArchiveName ([string]$toolchain.node.archive) -Url ([string]$toolchain.node.url) -Sha256 ([string]$toolchain.node.sha256)
  $extractRoot = Join-Path $SessionRoot 'node'
  Expand-ArchiveSafely -ArchivePath $archive -Destination $extractRoot
  $stagedRoot = Find-SingleToolRoot -ExtractionRoot $extractRoot -RelativeMarker 'node.exe'
  if (-not (Test-NodeInstallation -Root $stagedRoot)) {
    throw 'The staged Node.js version does not match toolchain.lock.json.'
  }
  Set-DirectoryFromStage -Source $stagedRoot -Destination $nodeRoot -SessionRoot $SessionRoot
  Write-Host "[installed] Node.js $($toolchain.node.version)"
}

function Ensure-Jdk {
  param([Parameter(Mandatory = $true)][string]$SessionRoot)

  if (Test-JdkInstallation -Root $jdkRoot) {
    Write-Host "[ok] JDK $($toolchain.jdk.version)"
    return
  }

  $archive = Get-VerifiedArchive -ArchiveName ([string]$toolchain.jdk.archive) -Url ([string]$toolchain.jdk.url) -Sha256 ([string]$toolchain.jdk.sha256)
  $extractRoot = Join-Path $SessionRoot 'jdk'
  Expand-ArchiveSafely -ArchivePath $archive -Destination $extractRoot
  $stagedRoot = Find-SingleToolRoot -ExtractionRoot $extractRoot -RelativeMarker 'bin\java.exe'
  if (-not (Test-JdkInstallation -Root $stagedRoot)) {
    throw 'The staged JDK version does not match toolchain.lock.json.'
  }
  Set-DirectoryFromStage -Source $stagedRoot -Destination $jdkRoot -SessionRoot $SessionRoot
  Write-Host "[installed] JDK $($toolchain.jdk.version)"
}

function Ensure-CommandLineTools {
  param([Parameter(Mandatory = $true)][string]$SessionRoot)

  if (Test-CommandLineToolsInstallation -Root $commandLineToolsRoot) {
    Write-Host "[ok] Android command-line tools $($toolchain.android.commandLineTools.version)"
    return
  }

  $archive = Get-VerifiedArchive `
    -ArchiveName ([string]$toolchain.android.commandLineTools.archive) `
    -Url ([string]$toolchain.android.commandLineTools.url) `
    -Sha256 ([string]$toolchain.android.commandLineTools.sha256) `
    -Sha1 ([string]$toolchain.android.commandLineTools.sha1)
  $extractRoot = Join-Path $SessionRoot 'android-command-line-tools'
  Expand-ArchiveSafely -ArchivePath $archive -Destination $extractRoot
  $stagedRoot = Find-SingleToolRoot -ExtractionRoot $extractRoot -RelativeMarker 'bin\sdkmanager.bat'
  if (-not (Test-CommandLineToolsInstallation -Root $stagedRoot)) {
    throw 'The staged Android command-line tools version does not match toolchain.lock.json.'
  }
  Set-DirectoryFromStage -Source $stagedRoot -Destination $commandLineToolsRoot -SessionRoot $SessionRoot
  Write-Host "[installed] Android command-line tools $($toolchain.android.commandLineTools.version)"
}

function Test-AndroidLicenseMarker {
  param([Parameter(Mandatory = $true)][string]$SdkRoot)

  $licenseFile = Join-Path $SdkRoot 'licenses\android-sdk-license'
  if (-not (Test-Path -LiteralPath $licenseFile -PathType Leaf)) {
    return $false
  }

  $acceptedHashes = @(Get-Content -LiteralPath $licenseFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  return $acceptedHashes.Count -gt 0
}

function Get-SdkManagerArguments {
  param([Parameter(Mandatory = $true)][string]$SdkRoot)

  $proxyType = if ($proxyUri.Scheme -in @('socks', 'socks5')) { 'socks' } else { 'http' }
  return @(
    "--sdk_root=$SdkRoot",
    "--proxy=$proxyType",
    "--proxy_host=$($proxyUri.DnsSafeHost)",
    "--proxy_port=$($proxyUri.Port)"
  )
}

function Copy-AndroidLicenses {
  param(
    [Parameter(Mandatory = $true)][string]$SourceSdk,
    [Parameter(Mandatory = $true)][string]$DestinationSdk
  )

  $source = Join-Path $SourceSdk 'licenses'
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    return
  }

  $destination = Join-Path $DestinationSdk 'licenses'
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Get-ChildItem -LiteralPath $source -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination $_.Name) -Force
  }
}

function Test-PlatformTools {
  param([Parameter(Mandatory = $true)][string]$SdkRoot)

  $root = Join-Path $SdkRoot 'platform-tools'
  $revision = Get-SourceProperty -File (Join-Path $root 'source.properties') -Name 'Pkg.Revision'
  if ($revision -ne [string]$toolchain.android.platformTools) {
    return $false
  }

  $adb = Join-Path $root 'adb.exe'
  if (-not (Test-Path -LiteralPath $adb -PathType Leaf)) {
    return $false
  }
  if ($VerifyOnly) {
    return $true
  }
  $result = Get-NativeResult -Executable $adb -Arguments @('version')
  return $result.ExitCode -eq 0
}

function Test-AndroidPlatform {
  param([Parameter(Mandatory = $true)][string]$SdkRoot)

  $root = Join-Path $SdkRoot ("platforms\android-$($toolchain.android.compileSdk)")
  $revision = Get-SourceProperty -File (Join-Path $root 'source.properties') -Name 'Pkg.Revision'
  return $revision -eq [string]$toolchain.android.platformRevision -and (Test-Path -LiteralPath (Join-Path $root 'android.jar') -PathType Leaf)
}

function Test-BuildTools {
  param(
    [Parameter(Mandatory = $true)][string]$SdkRoot,
    [Parameter(Mandatory = $true)][string]$Version
  )

  $root = Join-Path $SdkRoot ("build-tools\$Version")
  $revision = Get-SourceProperty -File (Join-Path $root 'source.properties') -Name 'Pkg.Revision'
  if ($revision -ne $Version) {
    return $false
  }

  $aapt2 = Join-Path $root 'aapt2.exe'
  if (-not (Test-Path -LiteralPath $aapt2 -PathType Leaf)) {
    return $false
  }
  if ($VerifyOnly) {
    return $true
  }
  $result = Get-NativeResult -Executable $aapt2 -Arguments @('version')
  return $result.ExitCode -eq 0
}

function Get-MissingAndroidPackages {
  param([Parameter(Mandatory = $true)][string]$SdkRoot)

  $missing = @()
  if (-not (Test-PlatformTools -SdkRoot $SdkRoot)) {
    $missing += 'platform-tools'
  }
  if (-not (Test-AndroidPlatform -SdkRoot $SdkRoot)) {
    $missing += "platforms;android-$($toolchain.android.compileSdk)"
  }
  foreach ($version in @($toolchain.android.buildTools)) {
    if (-not (Test-BuildTools -SdkRoot $SdkRoot -Version ([string]$version))) {
      $missing += "build-tools;$version"
    }
  }
  return $missing
}

function Install-AndroidPackages {
  param(
    [Parameter(Mandatory = $true)][string[]]$PackageIds,
    [Parameter(Mandatory = $true)][string]$SdkStage,
    [Parameter(Mandatory = $true)][string]$SessionRoot
  )

  if ($PackageIds.Count -eq 0) {
    return
  }

  $sdkManager = Join-Path $commandLineToolsRoot 'bin\sdkmanager.bat'
  Copy-AndroidLicenses -SourceSdk $androidSdkRoot -DestinationSdk $SdkStage
  $arguments = @(Get-SdkManagerArguments -SdkRoot $SdkStage) + @('--install') + $PackageIds
  Write-Host "[install] Android SDK packages: $($PackageIds -join ', ')"
  Invoke-NativeChecked -Executable $sdkManager -Arguments $arguments -FailureMessage 'Android SDK package installation failed. If a license was declined, rerun with -AcceptAndroidLicenses and accept it interactively.'

  foreach ($packageId in $PackageIds) {
    if ($packageId -eq 'platform-tools') {
      if (-not (Test-PlatformTools -SdkRoot $SdkStage)) {
        throw "sdkmanager did not install locked platform-tools $($toolchain.android.platformTools)."
      }
      Set-DirectoryFromStage -Source (Join-Path $SdkStage 'platform-tools') -Destination (Join-Path $androidSdkRoot 'platform-tools') -SessionRoot $SessionRoot
    } elseif ($packageId -like 'platforms;android-*') {
      if (-not (Test-AndroidPlatform -SdkRoot $SdkStage)) {
        throw "sdkmanager did not install locked Android platform $($toolchain.android.compileSdk), revision $($toolchain.android.platformRevision)."
      }
      $relative = "platforms\android-$($toolchain.android.compileSdk)"
      Set-DirectoryFromStage -Source (Join-Path $SdkStage $relative) -Destination (Join-Path $androidSdkRoot $relative) -SessionRoot $SessionRoot
    } elseif ($packageId -like 'build-tools;*') {
      $version = $packageId.Substring('build-tools;'.Length)
      if (-not (Test-BuildTools -SdkRoot $SdkStage -Version $version)) {
        throw "sdkmanager did not install locked Android build-tools $version."
      }
      $relative = "build-tools\$version"
      Set-DirectoryFromStage -Source (Join-Path $SdkStage $relative) -Destination (Join-Path $androidSdkRoot $relative) -SessionRoot $SessionRoot
    }
  }
}

function Assert-CachedArchives {
  $archives = @(
    [pscustomobject]@{ Name = [string]$toolchain.node.archive; Sha256 = [string]$toolchain.node.sha256; Sha1 = $null },
    [pscustomobject]@{ Name = [string]$toolchain.jdk.archive; Sha256 = [string]$toolchain.jdk.sha256; Sha1 = $null },
    [pscustomobject]@{ Name = [string]$toolchain.android.commandLineTools.archive; Sha256 = [string]$toolchain.android.commandLineTools.sha256; Sha1 = [string]$toolchain.android.commandLineTools.sha1 }
  )
  foreach ($archive in $archives) {
    $path = Join-Path $downloadsRoot $archive.Name
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Assert-ArchiveHash -ArchivePath $path -Sha256 $archive.Sha256 -Sha1 $archive.Sha1
    }
  }
}

function Assert-Toolchain {
  if (-not (Test-NodeInstallation -Root $nodeRoot)) {
    throw "Node.js $($toolchain.node.version) is missing or invalid at $nodeRoot. Run scripts\bootstrap-toolchain.ps1."
  }
  if (-not (Test-JdkInstallation -Root $jdkRoot)) {
    throw "JDK $($toolchain.jdk.version) is missing or invalid at $jdkRoot. Run scripts\bootstrap-toolchain.ps1."
  }
  if (-not (Test-CommandLineToolsInstallation -Root $commandLineToolsRoot)) {
    throw "Android command-line tools $($toolchain.android.commandLineTools.version) are missing or invalid at $commandLineToolsRoot. Run scripts\bootstrap-toolchain.ps1."
  }
  if (-not (Test-AndroidLicenseMarker -SdkRoot $androidSdkRoot)) {
    throw "Android SDK licenses have not been accepted in $androidSdkRoot. Rerun scripts\bootstrap-toolchain.ps1 -AcceptAndroidLicenses and answer the sdkmanager prompts interactively."
  }

  $missing = @(Get-MissingAndroidPackages -SdkRoot $androidSdkRoot)
  if ($missing.Count -gt 0) {
    throw "Android SDK packages are missing or do not match toolchain.lock.json: $($missing -join ', '). Run scripts\bootstrap-toolchain.ps1."
  }

  Assert-CachedArchives
  Write-Host '[verified] Workspace toolchain matches toolchain.lock.json.'
  Write-Host "  Node.js: $($toolchain.node.version)"
  Write-Host "  JDK: $($toolchain.jdk.version)"
  Write-Host "  Android command-line tools: $($toolchain.android.commandLineTools.version)"
  Write-Host "  Android SDK: platform-tools $($toolchain.android.platformTools), platform android-$($toolchain.android.compileSdk), build-tools $(@($toolchain.android.buildTools) -join ', ')"
}

if ($VerifyOnly) {
  Assert-Toolchain
  exit 0
}

New-Item -ItemType Directory -Force -Path $toolsRoot, $downloadsRoot, $bootstrapRoot, $env:GRADLE_USER_HOME, $env:ANDROID_USER_HOME, $env:TEMP | Out-Null
$sessionRoot = Assert-PathWithin -Path (Join-Path $bootstrapRoot ('bootstrap-' + [guid]::NewGuid().ToString('N'))) -AllowedRoot $bootstrapRoot
$sdkStage = Assert-PathWithin -Path (Join-Path $downloadsRoot ('.sdkmanager-' + [guid]::NewGuid().ToString('N'))) -AllowedRoot $downloadsRoot

try {
  New-Item -ItemType Directory -Path $sessionRoot | Out-Null
  Ensure-Node -SessionRoot $sessionRoot
  Ensure-Jdk -SessionRoot $sessionRoot
  Ensure-CommandLineTools -SessionRoot $sessionRoot

  $missingPackages = @(Get-MissingAndroidPackages -SdkRoot $androidSdkRoot)
  if ($AcceptAndroidLicenses -or $missingPackages.Count -gt 0) {
    New-Item -ItemType Directory -Path $sdkStage | Out-Null
    Copy-AndroidLicenses -SourceSdk $androidSdkRoot -DestinationSdk $sdkStage
  }

  if ($AcceptAndroidLicenses) {
    $sdkManager = Join-Path $commandLineToolsRoot 'bin\sdkmanager.bat'
    Write-Host '[licenses] sdkmanager will prompt interactively; review each license before accepting.'
    $licenseArguments = @(Get-SdkManagerArguments -SdkRoot $sdkStage) + @('--licenses')
    Invoke-NativeChecked -Executable $sdkManager -Arguments $licenseArguments -FailureMessage 'Android SDK license review failed.'
    Copy-AndroidLicenses -SourceSdk $sdkStage -DestinationSdk $androidSdkRoot
  }

  if (-not (Test-AndroidLicenseMarker -SdkRoot $androidSdkRoot)) {
    throw 'Android SDK licenses are required before package installation. Rerun scripts\bootstrap-toolchain.ps1 -AcceptAndroidLicenses and answer the sdkmanager prompts interactively.'
  }

  if ($missingPackages.Count -gt 0) {
    Install-AndroidPackages -PackageIds $missingPackages -SdkStage $sdkStage -SessionRoot $sessionRoot
  }
  Assert-Toolchain
} finally {
  if (Test-Path -LiteralPath $sdkStage) {
    Remove-WorkspacePath -Path $sdkStage -AllowedRoot $downloadsRoot
  }
  if (Test-Path -LiteralPath $sessionRoot) {
    Remove-WorkspacePath -Path $sessionRoot -AllowedRoot $bootstrapRoot
  }
}
