[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $resolvedExecutable
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$process = [System.Diagnostics.Process]::Start($startInfo)

function Send-NativeMessage {
    param([string]$RequestId)

    $json = @{ requestId = $RequestId; action = 'status' } | ConvertTo-Json -Compress
    $payload = [System.Text.Encoding]::UTF8.GetBytes($json)
    $length = [System.BitConverter]::GetBytes([int]$payload.Length)
    $process.StandardInput.BaseStream.Write($length, 0, $length.Length)
    $process.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
    $process.StandardInput.BaseStream.Flush()

    $lengthBuffer = [byte[]]::new(4)
    if ($process.StandardOutput.BaseStream.Read($lengthBuffer, 0, 4) -ne 4) {
        throw 'Native host did not return a complete message length.'
    }

    $responseLength = [System.BitConverter]::ToInt32($lengthBuffer, 0)
    $responseBuffer = [byte[]]::new($responseLength)
    $offset = 0
    while ($offset -lt $responseLength) {
        $read = $process.StandardOutput.BaseStream.Read($responseBuffer, $offset, $responseLength - $offset)
        if ($read -eq 0) { throw 'Native host response ended early.' }
        $offset += $read
    }

    return [System.Text.Encoding]::UTF8.GetString($responseBuffer) | ConvertFrom-Json
}

try {
    $first = Send-NativeMessage -RequestId 'status-1'
    if (-not $first.ok -or $first.requestId -ne 'status-1' -or $first.availability -ne 'HostReady') {
        throw 'The first native host response was invalid.'
    }
    if ($process.HasExited) { throw 'The native host exited after the first message.' }

    $second = Send-NativeMessage -RequestId 'status-2'
    if (-not $second.ok -or $second.requestId -ne 'status-2' -or $second.availability -ne 'HostReady') {
        throw 'The second native host response was invalid.'
    }
    if ($process.HasExited) { throw 'The native host exited before the port was closed.' }

    $process.StandardInput.Close()
    if (-not $process.WaitForExit(5000)) { throw 'The native host did not exit after its input port closed.' }
    if ($process.ExitCode -ne 0) { throw "The native host exited with code $($process.ExitCode)." }

    Write-Host 'Persistent native host protocol test passed.' -ForegroundColor Green
}
finally {
    if (-not $process.HasExited) {
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(2000)) {
            Stop-Process -Id $process.Id -Force
        }
    }
    $process.Dispose()
}
