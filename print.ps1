param(
    [string]$imagePath,
    [string]$printerName
)

$ErrorActionPreference = "Stop"

# Log file
$logFile = Join-Path $PSScriptRoot "print-log.txt"
function Write-Log($message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $message"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

try {
    Write-Log "=== Print dimulai ==="
    Write-Log "ImagePath: $imagePath"
    Write-Log "PrinterName: $printerName"

    if (-not (Test-Path $imagePath)) {
        throw "File gambar tidak ditemukan: $imagePath"
    }

    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms

    $img = [System.Drawing.Image]::FromFile($imagePath)
    Write-Log "Ukuran gambar: $($img.Width) x $($img.Height) px"

    $printDoc = New-Object System.Drawing.Printing.PrintDocument

    # Tentukan printer
    if ($printerName -and $printerName -ne "default") {
        $installedPrinters = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters
        if ($installedPrinters -contains $printerName) {
            $printDoc.PrinterSettings.PrinterName = $printerName
            Write-Log "Menggunakan printer: $printerName"
        } else {
            Write-Log "Printer '$printerName' tidak ditemukan. Menggunakan printer default."
        }
    } else {
        Write-Log "Menggunakan printer default."
    }

    # Paper size: 72mm x 150mm (dalam 1/100 inch)
    $paperSize = New-Object System.Drawing.Printing.PaperSize("Custom", 283, 591)
    $paperSize.RawKind = 0
    $printDoc.DefaultPageSettings.PaperSize = $paperSize
    $printDoc.PrinterSettings.DefaultPageSettings.PaperSize = $paperSize

    # Orientation: Portrait
    $printDoc.DefaultPageSettings.Landscape = $false

    # Margin nol
    $printDoc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

    # Origin at margins = false
    $printDoc.OriginAtMargins = $false

    # Event handler untuk print
    $printDoc.add_PrintPage({
        param($sender, $e)
        $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
        $e.Graphics.DrawImage($img, 0, 0, 72, 150)
    })

    Write-Log "Mengirim perintah print..."
    $printDoc.Print()
    Write-Log "✅ Print job berhasil dikirim ke printer."
} catch {
    Write-Log "❌ Print gagal: $_"
    Write-Error "❌ Print gagal: $_"
} finally {
    if ($img) {
        $img.Dispose()
        Write-Log "Gambar di-dispose."
    }
    Write-Log "=== Print selesai ==="
}