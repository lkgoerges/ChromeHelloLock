[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $repoRoot 'native-host\ChromeHelloLock.NativeHost.csproj'
$toolsDir = Join-Path $repoRoot '.tools'
$localDotnetDir = Join-Path $toolsDir 'dotnet'
$localDotnet = Join-Path $localDotnetDir 'dotnet.exe'
$installDir = Join-Path $env:LOCALAPPDATA 'ChromeHelloLock\NativeHost'
$hostExecutable = Join-Path $installDir 'ChromeHelloLock.NativeHost.exe'
$hostManifest = Join-Path $installDir 'com.lkgsoft.chrome_hello_lock.json'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.lkgsoft.chrome_hello_lock'
$extensionId = 'bodeojcofhnjbhebeapdokhabmimcjmm'

function Find-DotnetSdk {
    $systemDotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    if ($systemDotnet) {
        $sdks = & $systemDotnet.Source --list-sdks
        if ($LASTEXITCODE -eq 0 -and $sdks) {
            return $systemDotnet.Source
        }
    }

    if (Test-Path -LiteralPath $localDotnet) {
        return $localDotnet
    }

    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    $installer = Join-Path $toolsDir 'dotnet-install.ps1'
    Write-Host 'Downloading a local .NET 10 SDK for the build…'
    Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installer
    & $installer -Channel '10.0' -InstallDir $localDotnetDir -NoPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $localDotnet)) {
        throw 'The local .NET SDK installation failed.'
    }

    return $localDotnet
}

if (-not $SkipBuild) {
    $dotnet = Find-DotnetSdk
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null

    Get-CimInstance Win32_Process -Filter "Name = 'ChromeHelloLock.NativeHost.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($hostExecutable) } |
        ForEach-Object {
            Write-Host 'Stopping the previous companion process…'
            Stop-Process -Id $_.ProcessId -Force
            Wait-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        }

    Write-Host 'Publishing the Windows Hello companion…'
    & $dotnet publish $projectPath --configuration Release --runtime win-x64 --self-contained true --output $installDir
    if ($LASTEXITCODE -ne 0) {
        throw 'Publishing the Windows Hello companion failed.'
    }
}

if (-not (Test-Path -LiteralPath $hostExecutable)) {
    throw "Native host executable not found at $hostExecutable"
}

$manifest = [ordered]@{
    name = 'com.lkgsoft.chrome_hello_lock'
    description = 'Windows Hello companion for Chrome Hello Lock'
    path = $hostExecutable
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $hostManifest -Encoding utf8

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifest

Write-Host ''
Write-Host 'Chrome Hello Lock companion installed.' -ForegroundColor Green
Write-Host "Extension ID: $extensionId"
Write-Host "Load this folder in chrome://extensions: $(Join-Path $repoRoot 'extension')"
