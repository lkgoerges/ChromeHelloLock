[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts' }
$extensionDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension'
& (Join-Path $PSScriptRoot 'validate.ps1') -ExtensionDir $extensionDir
$manifest = Get-Content -LiteralPath (Join-Path $extensionDir 'manifest.json') -Raw | ConvertFrom-Json
# Transform only the upload manifest. Never alter the installed development key.
$uploadManifestJson = (& node (Join-Path $PSScriptRoot 'store-manifest.js') | Out-String).TrimEnd() + "`n"
if ($LASTEXITCODE -ne 0) { throw 'Web Store manifest generation failed.' }
$uploadManifest = $uploadManifestJson | ConvertFrom-Json
if ($uploadManifest.PSObject.Properties.Name -contains 'key') { throw 'Development key leaked into upload manifest.' }
$uploadManifestBytes = [Text.Encoding]::UTF8.GetBytes($uploadManifestJson.Replace("`r`n", "`n"))
function Get-PackageBytes([string]$Name) {
    if ($Name -ceq 'manifest.json') { return ,$uploadManifestBytes }
    return ,[IO.File]::ReadAllBytes((Join-Path $extensionDir $Name))
}
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$archivePath = Join-Path $OutputDirectory "chrome-hello-lock-$($manifest.version)-webstore.zip"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$names = [string[]]@(Get-ChildItem -LiteralPath $extensionDir -Recurse -File | ForEach-Object {
    $_.FullName.Substring($extensionDir.Length + 1).Replace('\', '/')
})
[Array]::Sort($names, [StringComparer]::Ordinal)
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
try {
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($name in $names) {
            $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::NoCompression)
            $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $entry.ExternalAttributes = 0
            $entryStream = $entry.Open()
            try {
                $bytes = Get-PackageBytes $name
                $entryStream.Write($bytes, 0, $bytes.Length)
            } finally { $entryStream.Dispose() }
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }

# Independently read back the actual ZIP, not just the staging directory.
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $names.Count) { throw 'Archive entry count mismatch.' }
    for ($index = 0; $index -lt $names.Count; $index++) {
        $entry = $archive.Entries[$index]
        if ($entry.FullName -cne $names[$index]) { throw 'Archive filename mismatch.' }
        $entryStream = $entry.Open()
        $buffer = [IO.MemoryStream]::new()
        try {
            $entryStream.CopyTo($buffer)
            $actual = [Convert]::ToBase64String($buffer.ToArray())
            $expected = [Convert]::ToBase64String((Get-PackageBytes $names[$index]))
            if ($actual -cne $expected) { throw "Archive content mismatch: $($entry.FullName)" }
        } finally { $buffer.Dispose(); $entryStream.Dispose() }
    }
} finally { $archive.Dispose() }
$hasher = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($archivePath))).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }
[IO.File]::WriteAllText("$archivePath.sha256", "$hash  $([IO.Path]::GetFileName($archivePath))`n", [Text.UTF8Encoding]::new($false))
Write-Host "Packaged and verified $($names.Count) files: $archivePath"
Write-Host "SHA-256: $hash"
