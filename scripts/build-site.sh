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
  head -n "$split" "$src"
  printf '</head>\n<body>\n'
  tail -n +"$((split + 1))" "$src"
  printf '</body>\n</html>\n'
} > index.html
echo "Wrote index.html"
