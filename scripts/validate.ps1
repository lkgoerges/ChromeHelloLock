[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionDir = Join-Path $repoRoot 'extension'
$manifestPath = Join-Path $extensionDir 'manifest.json'

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) {
    throw 'The extension manifest must use Manifest V3.'
}

if ($manifest.key -eq $null -or $manifest.key.Length -lt 100) {
    throw 'The extension manifest must contain its stable public key.'
}

$expectedPermissions = @('alarms', 'storage', 'tabs')
$unexpectedPermissions = @($manifest.permissions | Where-Object { $_ -notin $expectedPermissions })
if ($unexpectedPermissions.Count -gt 0) {
    throw "Unexpected extension permissions: $($unexpectedPermissions -join ', ')"
}

if ($manifest.PSObject.Properties.Name -contains 'host_permissions') {
    throw 'Chrome Hello Lock must not request host permissions.'
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node) {
    Get-ChildItem -LiteralPath $extensionDir -Filter '*.js' | ForEach-Object {
        & $node.Source --check $_.FullName
        if ($LASTEXITCODE -ne 0) {
            throw "JavaScript validation failed: $($_.Name)"
        }
    }
} else {
    Write-Warning 'Node.js is not installed; JavaScript syntax validation was skipped.'
}

$htmlFiles = Get-ChildItem -LiteralPath $extensionDir -Filter '*.html'
foreach ($htmlFile in $htmlFiles) {
    $html = Get-Content -LiteralPath $htmlFile.FullName -Raw
    if ($html -match '<script[^>]+src=["'']https?://') {
        throw "Remote script found in $($htmlFile.Name); Manifest V3 requires bundled code."
    }
}

Write-Host 'Extension validation passed.' -ForegroundColor Green
