[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.lkgsoft.chrome_hello_lock'
$installDir = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ChromeHelloLock\NativeHost'))
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ChromeHelloLock'))

if (-not $installDir.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected path: $installDir"
}

if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Recurse
}

if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse
}

Write-Host 'Chrome Hello Lock companion removed.' -ForegroundColor Green
