param(
    [string]$Serial = "127.0.0.1:16384"
)

$ErrorActionPreference = "Stop"
$Workspace = Split-Path -Parent $PSScriptRoot
$Adb = Join-Path $Workspace ".tools\android-sdk\platform-tools\adb.exe"

if (-not (Test-Path -LiteralPath $Adb)) {
    throw "Workspace ADB not found: $Adb"
}

& $Adb -s $Serial root
if ($LASTEXITCODE -ne 0) { throw "Unable to start root adbd on $Serial" }

$Command = "netstat -ltn 2>/dev/null | grep -q ':39280 ' || nohup toybox nc -s 127.0.0.1 -p 39280 -L sh >/dev/null 2>&1 &"
& $Adb -s $Serial shell $Command
if ($LASTEXITCODE -ne 0) { throw "Unable to start ADB root bridge on $Serial" }

Write-Host "Yachiyo ADB root bridge is listening on $Serial (device loopback port 39280)."
