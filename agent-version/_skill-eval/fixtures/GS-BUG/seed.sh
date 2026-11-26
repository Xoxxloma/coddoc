#!/usr/bin/env bash
# seed.sh — готовый баг-репорт как документ сверху. Меряется ветка дефекта в Шаге 2Б:
# §4.5 у него нет и не нужна, разрез не обсуждается, спека зовётся с флагом багфикса.
set -u
DEST="${1:?куда}"; HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$DEST"; mkdir -p "$DEST"; cp -r "$HERE/coddoc" "$DEST/coddoc"
echo "песочница: $DEST   файлов: $(find "$DEST" -type f | wc -l)"
