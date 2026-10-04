[CmdletBinding()]
param([string]$ExtensionDir)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ExtensionDir) { $ExtensionDir = Join-Path $repoRoot 'extension' }
& node (Join-Path $PSScriptRoot 'validate-extension.js') $ExtensionDir
if ($LASTEXITCODE -ne 0) { throw 'Extension validation failed.' }
