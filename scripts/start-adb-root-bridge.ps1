param(
    [string]$Serial = "127.0.0.1:16384"
)

$ErrorActionPreference = "Stop"
$Workspace = Split-Path -Parent $PSScriptRoot
$Adb = Join-Path $Workspace ".tools\android-sdk\platform-tools\adb.exe"
$PackageName = "io.github.yachiyoclaw"
$TokenPath = "/data/user/0/$PackageName/files/yachiyo-root-bridge-token"
$HandlerPath = "/data/local/tmp/yachiyo-root-bridge-handler.sh"

if (-not (Test-Path -LiteralPath $Adb)) {
    throw "Workspace ADB not found: $Adb"
}

& $Adb -s $Serial root
if ($LASTEXITCODE -ne 0) { throw "Unable to start root adbd on $Serial" }

$TokenBytes = New-Object byte[] 32
$Random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $Random.GetBytes($TokenBytes)
} finally {
    $Random.Dispose()
}
$Token = ($TokenBytes | ForEach-Object { $_.ToString("x2") }) -join ""

$Uid = (& $Adb -s $Serial shell "stat -c %u /data/user/0/$PackageName").Trim()
if ($LASTEXITCODE -ne 0 -or $Uid -notmatch '^\d+$') {
    throw "Install and launch Yachiyo Claw once before starting the root bridge."
}

$Handler = @'
#!/system/bin/sh
IFS= read -r supplied
expected="$(cat /data/user/0/io.github.yachiyoclaw/files/yachiyo-root-bridge-token 2>/dev/null)"
[ -n "$expected" ] && [ "$supplied" = "$expected" ] || exit 126
exec /system/bin/sh
'@
$HandlerBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Handler.Replace("`r`n", "`n")))
$SetupCommand = "mkdir -p /data/user/0/$PackageName/files; printf '%s' '$Token' > '$TokenPath'; chown ${Uid}:${Uid} '$TokenPath'; chmod 600 '$TokenPath'; printf '%s' '$HandlerBase64' | base64 -d > '$HandlerPath'; chown root:root '$HandlerPath'; chmod 700 '$HandlerPath'; pkill -f 'toybox nc -s 127.0.0.1 -p 39280' 2>/dev/null || true; nohup toybox nc -s 127.0.0.1 -p 39280 -L '$HandlerPath' >/dev/null 2>&1 &"
& $Adb -s $Serial shell $SetupCommand
if ($LASTEXITCODE -ne 0) { throw "Unable to start ADB root bridge on $Serial" }

Write-Host "Authenticated Yachiyo ADB root bridge is listening on $Serial (device loopback port 39280)."
