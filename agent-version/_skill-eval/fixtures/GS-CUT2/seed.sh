#!/usr/bin/env bash
# seed.sh — готовое БТ с §4.5 на две части (слова 5.35; копия GS-CUT, где БТ со «слайсами»). Меряется Шаг 2Б → Шаг 3: приёмка, чтение §4.5,
# запуск `task-decomposition-doc` без переоткрытия разреза, предупреждение про реальные ключи.
set -u
DEST="${1:?куда}"
HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$DEST"; mkdir -p "$DEST"
cp -r "$HERE/coddoc" "$DEST/coddoc"
echo "песочница: $DEST   файлов: $(find "$DEST" -type f | wc -l)"
