#!/bin/sh
# Asset conversion script for Fallout 1 HTML5 port

set -e

echo "========================================"
echo "Fallout 1 Asset Converter"
echo "========================================"

GAMEFILES_DIR="/gamefiles"
ASSETS_DIR="/assets"

# Check for game files
if [ ! -f "$GAMEFILES_DIR/master.dat" ]; then
    echo "ERROR: master.dat not found in $GAMEFILES_DIR"
    echo "Please place your Fallout 1 game files in the gamefiles directory."
    exit 1
fi

echo "Found game files. Starting conversion..."

# Extract DAT archives
echo ""
echo "Step 1: Extracting master.dat..."
npx ts-node tools/dat-extractor.ts "$GAMEFILES_DIR/master.dat" "$ASSETS_DIR/extracted/"

if [ -f "$GAMEFILES_DIR/critter.dat" ]; then
    echo "Step 2: Extracting critter.dat..."
    npx ts-node tools/dat-extractor.ts "$GAMEFILES_DIR/critter.dat" "$ASSETS_DIR/extracted/"
fi

# Convert FRM sprites
echo ""
echo "Step 3: Converting FRM sprites..."
if [ -d "$ASSETS_DIR/extracted/art" ]; then
    npx ts-node tools/frm-converter.ts "$ASSETS_DIR/extracted/art/" "$ASSETS_DIR/sprites/"
fi

# Copy palette files
echo ""
echo "Step 4: Copying palette files..."
if [ -d "$ASSETS_DIR/extracted/color" ]; then
    cp -r "$ASSETS_DIR/extracted/color/"* "$ASSETS_DIR/" 2>/dev/null || true
fi

# Copy other data files
echo ""
echo "Step 5: Copying data files..."
for dir in data maps proto text; do
    if [ -d "$ASSETS_DIR/extracted/$dir" ]; then
        cp -r "$ASSETS_DIR/extracted/$dir" "$ASSETS_DIR/"
    fi
done

echo ""
echo "========================================"
echo "Conversion complete!"
echo "Assets are available in: $ASSETS_DIR"
echo "========================================"
