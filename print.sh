#!/bin/bash

# =============================================
# Photo Booth Printer Script for Linux (CUPS)
# Usage: ./print.sh <imagePath> [printerName]
# =============================================

imagePath="$1"
printerName="$2"

if [ -z "$imagePath" ]; then
    echo "❌ Error: No image path provided"
    exit 1
fi

if [ ! -f "$imagePath" ]; then
    echo "❌ Error: Image file not found: $imagePath"
    exit 1
fi

# Default paper size: 72mm x 150mm (dalam points: 1mm = 2.83464567 points)
# 72mm * 2.83464567 = 204.09 points
# 150mm * 2.83464567 = 425.20 points
PAPER_WIDTH=72
PAPER_HEIGHT=150

# Buat temporary PPD file untuk custom paper size jika diperlukan
PPD_FILE="/tmp/custom_paper_$$.ppd"

# Fungsi untuk print menggunakan CUPS dengan custom size
print_with_cups() {
    local img="$1"
    local printer="$2"
    
    # Konversi gambar ke format yang tepat untuk printing
    # Menggunakan ImageMagick jika tersedia, atau langsung print dengan lp
    if command -v convert &> /dev/null; then
        # Optimalkan gambar untuk print dengan ImageMagick
        TEMP_IMG="/tmp/print_$$.png"
        convert "$img" -resize "${PAPER_WIDTH}x${PAPER_HEIGHT}mm!" -density 300 "$TEMP_IMG"
        
        if [ -n "$printer" ] && [ "$printer" != "default" ]; then
            lp -d "$printer" \
               -o media=Custom.${PAPER_WIDTH}x${PAPER_HEIGHT}mm \
               -o fit-to-page \
               -o scaling=100 \
               -o natural-scaling=100 \
               "$TEMP_IMG" 2>&1
        else
            lp -o media=Custom.${PAPER_WIDTH}x${PAPER_HEIGHT}mm \
               -o fit-to-page \
               -o scaling=100 \
               -o natural-scaling=100 \
               "$TEMP_IMG" 2>&1
        fi
        
        PRINT_EXIT_CODE=$?
        rm -f "$TEMP_IMG"
    else
        # Tanpa ImageMagick, langsung print dengan lp
        if [ -n "$printer" ] && [ "$printer" != "default" ]; then
            lp -d "$printer" \
               -o media=Custom.${PAPER_WIDTH}x${PAPER_HEIGHT}mm \
               -o fit-to-page \
               -o scaling=100 \
               "$img" 2>&1
        else
            lp -o media=Custom.${PAPER_WIDTH}x${PAPER_HEIGHT}mm \
               -o fit-to-page \
               -o scaling=100 \
               "$img" 2>&1
        fi
        
        PRINT_EXIT_CODE=$?
    fi
    
    return $PRINT_EXIT_CODE
}

# Eksekusi print
OUTPUT=$(print_with_cups "$imagePath" "$printerName" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Print job sent successfully (${PAPER_WIDTH}x${PAPER_HEIGHT}mm full page)."
    exit 0
else
    echo "❌ Print failed: $OUTPUT"
    exit 1
fi