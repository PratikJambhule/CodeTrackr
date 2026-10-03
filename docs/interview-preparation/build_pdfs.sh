#!/usr/bin/env bash
# Rebuild the interview-guide PDFs from their Markdown (run from this folder).
# Needs pandoc and Google Chrome. Markdown -> standalone HTML (pdf-print.css) -> headless Chrome PDF.
set -euo pipefail
CHROME="${CHROME:-C:/Program Files/Google/Chrome/Application/chrome.exe}"
TMP="$(mktemp -d)"
for n in CodeTrackr_Interview_Preparation CodeTrackr_Interview_Guide_Condensed; do
  pandoc "$n.md" -f gfm -t html5 --standalone --embed-resources \
    --resource-path=".:..:../images" --css pdf-print.css --metadata pagetitle="$n" -o "$TMP/$n.html"
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$PWD/$n.pdf" "file:///$TMP/$n.html"
  echo "built $n.pdf"
done
