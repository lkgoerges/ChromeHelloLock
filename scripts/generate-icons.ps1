[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing.Common

$repoRoot = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $repoRoot 'extension\icons'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null

function New-RoundedRectanglePath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $diameter = $Radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

foreach ($size in @(16, 32, 48, 128)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $scale = $size / 128.0
    $background = New-RoundedRectanglePath -X (5 * $scale) -Y (5 * $scale) -Width (118 * $scale) -Height (118 * $scale) -Radius (29 * $scale)
    $backgroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#17181c'))
    $graphics.FillPath($backgroundBrush, $background)

    $haloBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(25, 215, 255, 100))
    $graphics.FillEllipse($haloBrush, 25 * $scale, 24 * $scale, 78 * $scale, 78 * $scale)

    $lime = [System.Drawing.ColorTranslator]::FromHtml('#d7ff64')
    $shacklePen = [System.Drawing.Pen]::new($lime, [Math]::Max(1.6, 8 * $scale))
    $shacklePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $shacklePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawArc($shacklePen, 39 * $scale, 27 * $scale, 50 * $scale, 55 * $scale, 180, 180)

    $body = New-RoundedRectanglePath -X (30 * $scale) -Y (58 * $scale) -Width (68 * $scale) -Height (47 * $scale) -Radius (13 * $scale)
    $bodyBrush = [System.Drawing.SolidBrush]::new($lime)
    $graphics.FillPath($bodyBrush, $body)

    $keyBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#17181c'))
    $graphics.FillEllipse($keyBrush, 58 * $scale, 72 * $scale, 12 * $scale, 12 * $scale)
    $graphics.FillRectangle($keyBrush, 61 * $scale, 79 * $scale, 6 * $scale, 12 * $scale)

    $outputPath = Join-Path $iconDirectory "icon-$size.png"
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $keyBrush.Dispose()
    $bodyBrush.Dispose()
    $body.Dispose()
    $shacklePen.Dispose()
    $haloBrush.Dispose()
    $backgroundBrush.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Host "Generated Chrome extension icons in $iconDirectory" -ForegroundColor Green
