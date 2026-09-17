Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::new((Join-Path $PSScriptRoot 'public\legacy\raw26\raw26_3.png'))
$w = $img.Width
$h = $img.Height
Write-Host "Image: $w x $h"

# Scan for white regions (R>240, G>240, B>240)
# Find horizontal runs of white pixels row by row, then group into rectangles
$threshold = 240
$whiteRows = @()

for ($y = 0; $y -lt $h; $y++) {
    $leftMost = -1
    $rightMost = -1
    for ($x = 0; $x -lt $w; $x++) {
        $pixel = $img.GetPixel($x, $y)
        if ($pixel.R -gt $threshold -and $pixel.G -gt $threshold -and $pixel.B -gt $threshold) {
            if ($leftMost -eq -1) { $leftMost = $x }
            $rightMost = $x
        }
    }
    if ($leftMost -ne -1 -and ($rightMost - $leftMost) -gt ($w * 0.5)) {
        $whiteRows += [PSCustomObject]@{ Y=$y; Left=$leftMost; Right=$rightMost }
    }
}

# Group consecutive white rows into blocks
$blocks = @()
$blockStart = -1
$blockLeft = 9999
$blockRight = 0

for ($i = 0; $i -lt $whiteRows.Count; $i++) {
    $row = $whiteRows[$i]
    if ($blockStart -eq -1) {
        $blockStart = $row.Y
        $blockLeft = $row.Left
        $blockRight = $row.Right
    } else {
        $prevY = $whiteRows[$i-1].Y
        if ($row.Y - $prevY -gt 2) {
            # Gap found - close current block
            $bw = $blockRight - $blockLeft + 1
            $bh = $prevY - $blockStart + 1
            if ($bh -gt 50) {
                $blocks += [PSCustomObject]@{ X=$blockLeft; Y=$blockStart; W=$bw; H=$bh }
            }
            $blockStart = $row.Y
            $blockLeft = $row.Left
            $blockRight = $row.Right
        } else {
            if ($row.Left -lt $blockLeft) { $blockLeft = $row.Left }
            if ($row.Right -gt $blockRight) { $blockRight = $row.Right }
        }
    }
}
# Close last block
if ($blockStart -ne -1) {
    $lastY = $whiteRows[$whiteRows.Count - 1].Y
    $bw = $blockRight - $blockLeft + 1
    $bh = $lastY - $blockStart + 1
    if ($bh -gt 50) {
        $blocks += [PSCustomObject]@{ X=$blockLeft; Y=$blockStart; W=$bw; H=$bh }
    }
}

Write-Host "`nDetected white blocks:"
foreach ($b in $blocks) {
    Write-Host "  x: $($b.X), y: $($b.Y), w: $($b.W), h: $($b.H)"
}

$img.Dispose()
