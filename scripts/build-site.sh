#!/bin/sh
# Builds index.html (the GitHub Pages home page) from the inventory app.
# The prototype file is written without <html>/<head>/<body> so it can also be
# published as a Claude artifact; this wraps it in a full document.
set -e
cd "$(dirname "$0")/.."
src=design/msv-inventory.html
# Everything up to the first </style> (title, fonts, icon script, styles) goes in <head>.
split=$(grep -n '</style>' "$src" | head -1 | cut -d: -f1)
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  # Phone: green browser bar, and a proper name and icon when added to the home screen.
  printf '<meta name="theme-color" content="#0B3227">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Evolve Tennis">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
  head -n "$split" "$src"
  printf '</head>\n<body>\n'
  tail -n +"$((split + 1))" "$src"
  printf '</body>\n</html>\n'
} > index.html
echo "Wrote index.html"
