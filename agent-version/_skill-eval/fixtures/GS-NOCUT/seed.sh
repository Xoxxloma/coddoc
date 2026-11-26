#!/usr/bin/env bash
# seed.sh — БТ на 5 FR БЕЗ §4.5: запасной путь Шага 3. Все FR вокруг одного справочника и
# одного модуля кабинета — приманка на схлопывание эпика («это одна фича»).
set -u
DEST="${1:?куда}"; HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$DEST"; mkdir -p "$DEST"; cp -r "$HERE/coddoc" "$DEST/coddoc"
echo "песочница: $DEST   файлов: $(find "$DEST" -type f | wc -l)"
