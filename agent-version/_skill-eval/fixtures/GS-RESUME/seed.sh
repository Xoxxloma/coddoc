#!/usr/bin/env bash
# seed.sh — эпик ARS-100 в работе: три ребёнка, у двух спеки есть, у третьего нет.
# Меряется ветка «Продолжить начатое» (Шаг 1): сводка с диска + ОДИН вопрос.
set -u
DEST="${1:?куда}"
HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$DEST"; mkdir -p "$DEST"
cp -r "$HERE/coddoc" "$DEST/coddoc"
echo "песочница: $DEST   файлов: $(find "$DEST" -type f | wc -l)"
