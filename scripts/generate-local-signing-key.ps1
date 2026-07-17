param(
    [string]$StorePassword = "android",
    [string]$KeyPassword = "android"
)

$ErrorActionPreference = "Stop"
$Workspace = Split-Path -Parent $PSScriptRoot
$Keytool = Join-Path $Workspace ".tools\jdk-21\bin\keytool.exe"
$KeyDirectory = Join-Path $Workspace ".keys"
$Keystore = Join-Path $KeyDirectory "newdreamstudio.keystore"

if (-not (Test-Path -LiteralPath $Keytool)) {
    throw "Workspace keytool not found: $Keytool"
}
if (Test-Path -LiteralPath $Keystore) {
    Write-Host "NewDreamStudio signing key already exists: $Keystore"
    exit 0
}

New-Item -ItemType Directory -Force -Path $KeyDirectory | Out-Null
& $Keytool -genkeypair -v `
    -keystore $Keystore `
    -storepass $StorePassword `
    -alias NewDreamStudio `
    -keypass $KeyPassword `
    -keyalg RSA `
    -keysize 3072 `
    -validity 10000 `
    -dname "CN=NewDreamStudio, OU=Yachiyo Claw, O=NewDreamStudio, C=CN"
if ($LASTEXITCODE -ne 0) {
    throw "Unable to create NewDreamStudio signing key"
}

Write-Host "Created local NewDreamStudio signing key: $Keystore"
