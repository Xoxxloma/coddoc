#!/usr/bin/env bash
# seed.sh — переписанная спека на диске. Меряется правило Шага 6: новая редакция → новая приёмка.
set -u
DEST="${1:?куда}"; HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$DEST"; mkdir -p "$DEST"; cp -r "$HERE/out/coddoc" "$DEST/coddoc"
echo "песочница: $DEST   файлов: $(find "$DEST" -type f | wc -l)"
