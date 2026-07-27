param(
    [string]$imagePath,
    [string]$printerName
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$img = [System.Drawing.Image]::FromFile($imagePath)
$printDoc = New-Object System.Drawing.Printing.PrintDocument

if ($printerName) {
    $printDoc.PrinterSettings.PrinterName = $printerName
}

# === PAPER SIZE: 80mm x 150mm ===
$paperSize = New-Object System.Drawing.Printing.PaperSize("Custom", 283, 591)
$paperSize.RawKind = 0
$printDoc.DefaultPageSettings.PaperSize = $paperSize
$printDoc.PrinterSettings.DefaultPageSettings.PaperSize = $paperSize

# === ORIENTATION: PORTRAIT ===
$printDoc.DefaultPageSettings.Landscape = $false

# === MARGIN NOL ===
$printDoc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

# === ORIGIN AT MARGINS = FALSE ===
$printDoc.OriginAtMargins = $false

$printDoc.add_PrintPage({
    param($sender, $e)

    # === Gambar FULL PAGE (80mm x 150mm) ===
    $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
    $e.Graphics.DrawImage($img, 0, 0, 72, 150)
})

try {
    $printDoc.Print()
    Write-Host "✅ Print job sent successfully (80x150mm full page)."
} catch {
    Write-Error "❌ Print failed: $_"
} finally {
    $img.Dispose()
}