$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $root "src-tauri\icons"
$iconPath = Join-Path $iconDirectory "icon.ico"
$size = 32

New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null

function Add-UInt16([System.Collections.Generic.List[byte]] $buffer, [int] $value) {
    $buffer.Add([byte]($value -band 0xff))
    $buffer.Add([byte](($value -shr 8) -band 0xff))
}

function Add-UInt32([System.Collections.Generic.List[byte]] $buffer, [int64] $value) {
    for ($shift = 0; $shift -lt 32; $shift += 8) {
        $buffer.Add([byte](($value -shr $shift) -band 0xff))
    }
}

$pixelBytes = New-Object System.Collections.Generic.List[byte]
for ($y = 0; $y -lt $size; $y++) {
    for ($x = 0; $x -lt $size; $x++) {
        $isMark = ($x -ge 7 -and $x -le 24 -and $y -ge 6 -and $y -le 25 -and (($x -eq 9) -or ($x -eq 22) -or ($y -eq 7) -or ($y -eq 24) -or ($x -eq $y - 1)))
        if ($isMark) {
            $pixelBytes.Add(255)
            $pixelBytes.Add(255)
            $pixelBytes.Add(255)
            $pixelBytes.Add(255)
        } else {
            $pixelBytes.Add(163)
            $pixelBytes.Add(100)
            $pixelBytes.Add(18)
            $pixelBytes.Add(255)
        }
    }
}

$maskBytes = New-Object byte[] ($size * 4)
$dibBytes = New-Object System.Collections.Generic.List[byte]
Add-UInt32 $dibBytes 40
Add-UInt32 $dibBytes $size
Add-UInt32 $dibBytes ($size * 2)
Add-UInt16 $dibBytes 1
Add-UInt16 $dibBytes 32
Add-UInt32 $dibBytes 0
Add-UInt32 $dibBytes ($pixelBytes.Count)
Add-UInt32 $dibBytes 0
Add-UInt32 $dibBytes 0
Add-UInt32 $dibBytes 0
Add-UInt32 $dibBytes 0
foreach ($byte in $pixelBytes) { $dibBytes.Add($byte) }
foreach ($byte in $maskBytes) { $dibBytes.Add($byte) }

$icoBytes = New-Object System.Collections.Generic.List[byte]
Add-UInt16 $icoBytes 0
Add-UInt16 $icoBytes 1
Add-UInt16 $icoBytes 1
$icoBytes.Add([byte]$size)
$icoBytes.Add([byte]$size)
$icoBytes.Add([byte]0)
$icoBytes.Add([byte]0)
Add-UInt16 $icoBytes 1
Add-UInt16 $icoBytes 32
Add-UInt32 $icoBytes $dibBytes.Count
Add-UInt32 $icoBytes 22
foreach ($byte in $dibBytes) { $icoBytes.Add($byte) }

[System.IO.File]::WriteAllBytes($iconPath, $icoBytes.ToArray())
Write-Host "Generated $iconPath"
