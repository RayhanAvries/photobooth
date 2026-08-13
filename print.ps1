param(
    [string]$imagePath,
    [string]$printerName
)

$ErrorActionPreference = "Stop"

$logFile = Join-Path $PSScriptRoot "print-log.txt"
function Write-Log($message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $message"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

try {
    Write-Log "Print started"
    Write-Log "ImagePath: $imagePath"
    Write-Log "PrinterName: $printerName"

    if (-not (Test-Path $imagePath)) {
        throw "Image file not found: $imagePath"
    }

    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms

    $img = [System.Drawing.Image]::FromFile($imagePath)
    Write-Log "Image size: $($img.Width) x $($img.Height) px"

    $printDoc = New-Object System.Drawing.Printing.PrintDocument

    if ($printerName -and $printerName -ne "default") {
        $installedPrinters = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters
        if ($installedPrinters -contains $printerName) {
            $printDoc.PrinterSettings.PrinterName = $printerName
            Write-Log "Using printer: $printerName"
        } else {
            Write-Log "Printer '$printerName' not found. Using default printer."
        }
    } else {
        Write-Log "Using default printer"
    }

    $paperSize = New-Object System.Drawing.Printing.PaperSize("Custom", 283, 591)
    $paperSize.RawKind = 0
    $printDoc.DefaultPageSettings.PaperSize = $paperSize
    $printDoc.PrinterSettings.DefaultPageSettings.PaperSize = $paperSize

    $printDoc.DefaultPageSettings.Landscape = $false

    $printDoc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

    $printDoc.OriginAtMargins = $false

    $printDoc.add_PrintPage({
        param($sender, $e)

        $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
        $e.Graphics.DrawImage($img, 0, 0, 72, 150)
    })

    Write-Log "Sending print command..."
    $printDoc.Print()
    Write-Log "Print job sent successfully (80x150mm full page)."
} catch {
    Write-Log "Print failed: $_"
    Write-Error "Print failed: $_"
} finally {
    if ($img) {
        $img.Dispose()
        Write-Log "Image disposed"
    }
    Write-Log "Print finished"
}