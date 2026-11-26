#!/usr/bin/env bash
# seed.sh — пустая песочница: ни coddoc/, ни services/. Меряется Шаг 1 (стартовый вопрос).
set -u
DEST="${1:?куда}"
rm -rf "$DEST"; mkdir -p "$DEST"
echo "песочница: $DEST (пусто)"
