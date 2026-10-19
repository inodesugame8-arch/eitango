# アイコンを作る: 黒地に白の太い「英」の 1 文字（Windows PowerShell 5.1 の System.Drawing）
# 実行: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1
# 出力: public/apple-touch-icon.png（180）・pwa-192.png・pwa-512.png・pwa-maskable-512.png
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$publicDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'public'
New-Item -ItemType Directory -Force -Path $publicDir | Out-Null

# 「英」（U+82F1）。ファイルの文字コードに左右されないよう番号で書く
$text = [string][char]0x82F1

# フォントは Yu Gothic UI、無ければ Meiryo
$installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
if ($installed -contains 'Yu Gothic UI') {
  $fontName = 'Yu Gothic UI'
} elseif ($installed -contains 'Meiryo') {
  $fontName = 'Meiryo'
} else {
  throw 'Yu Gothic UI も Meiryo も見つかりません'
}
$family = New-Object System.Drawing.FontFamily($fontName)

# size: 画像の一辺（px）、ratio: 文字の縦横の大きい方が一辺に占める割合
function New-Icon([int]$size, [double]$ratio, [string]$fileName) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Black)

    # 文字の輪郭を作り、実際の外形に合わせて大きさと位置を決める（フォントの余白に左右されない）
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString($text, $family, [int][System.Drawing.FontStyle]::Bold, [single]100, (New-Object System.Drawing.PointF(0, 0)), [System.Drawing.StringFormat]::GenericTypographic)
    $b = $path.GetBounds()
    $scale = ($size * $ratio) / [Math]::Max($b.Width, $b.Height)
    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.Translate([single](($size - $b.Width * $scale) / 2), [single](($size - $b.Height * $scale) / 2))
    $m.Scale([single]$scale, [single]$scale)
    $m.Translate([single](-$b.X), [single](-$b.Y))
    $path.Transform($m)
    $g.FillPath([System.Drawing.Brushes]::White, $path)

    $out = Join-Path $publicDir $fileName
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output ("{0} ({1}x{1}, {2})" -f $out, $size, $fontName)
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}

New-Icon 180 0.62 'apple-touch-icon.png'
New-Icon 192 0.62 'pwa-192.png'
New-Icon 512 0.62 'pwa-512.png'
# maskable は端末が丸などに切り抜くので、文字を小さくして周りに余白をとる（安全な範囲は中央の直径 80% の円）
New-Icon 512 0.42 'pwa-maskable-512.png'
